import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException,
  OnModuleDestroy, OnModuleInit, UnprocessableEntityException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { ErasureRegistry } from '../privacy/erasure';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { computeConfidence, computeScore, Evidence, IncidentStatus, nextStatus } from './confidence';
import { CreateReportDto } from './dto/incidents.dto';

const ACTIVE = `('DETECTE','CONFIRME','EN_COURS')`;
const VIEW_COLS = `i.id, i.type, i.description, i.status, ST_Y(i.geom) AS latitude, ST_X(i.geom) AS longitude,
  i.confidence, i.reporter_count, i.confirmation_count, i.contestation_count, i.started_at, i.expires_at, i.updated_at`;

const toView = (r: any) => ({
  id: r.id, type: r.type, description: r.description, status: r.status,
  latitude: r.latitude, longitude: r.longitude, confidence: r.confidence,
  reporterCount: r.reporter_count, confirmationCount: r.confirmation_count, contestationCount: r.contestation_count,
  startedAt: r.started_at, expiresAt: r.expires_at, updatedAt: r.updated_at,
  ...(r.distance_m !== undefined ? { distanceMeters: Math.round(r.distance_m) } : {}),
  ...(r.my_response !== undefined ? { myResponse: r.my_response } : {}), // null | 'REPORTER' | 'CONFIRMATION' | 'CONTESTATION'
});

@Injectable()
export class IncidentsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly db: DatabaseService,
    private readonly params: ParametersService,
    private readonly registry: ErasureRegistry,
  ) {}

  // Expiration périodique (sera confiée à BullMQ au Lot 7).
  onModuleInit() {
    this.registry.register('INCIDENT_CONTRIBUTIONS', (id) => this.eraseContributions(id));
    this.timer = setInterval(() => this.expireDue().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  async expireDue() {
    await this.db.query(`UPDATE incidents SET status='EXPIRE', ended_at=now(), updated_at=now()
                         WHERE status IN ${ACTIVE} AND expires_at <= now()`);
    await this.db.query(`UPDATE reports SET status='EXPIRE' WHERE status='VALIDE' AND expires_at <= now()`);
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** Recalcule preuves, confiance, statut ; prolonge la durée de vie si `refresh`. */
  private async recompute(c: PoolClient, incidentId: string, refresh: boolean) {
    const p = await this.params.get();
    const ev = (await c.query(
      `SELECT
         (SELECT COUNT(DISTINCT installation_id) FROM reports WHERE incident_id=$1 AND status='VALIDE')::int AS reporters,
         COUNT(*) FILTER (WHERE kind='CONFIRMATION')::int AS confirmations,
         COUNT(*) FILTER (WHERE kind='CONTESTATION')::int AS contestations
       FROM incident_confirmations WHERE incident_id=$1`, [incidentId])).rows[0] as Evidence;
    const cur = (await c.query('SELECT status FROM incidents WHERE id=$1', [incidentId])).rows[0].status as IncidentStatus;
    const status = nextStatus(cur, ev, p);
    const confidence = computeConfidence(computeScore(ev, p), p);
    await c.query(
      `UPDATE incidents SET status=$2, confidence=$3, reporter_count=$4, confirmation_count=$5, contestation_count=$6,
         expires_at = CASE WHEN $7 AND $2 IN ('DETECTE','CONFIRME','EN_COURS') THEN now() + make_interval(mins => $8) ELSE expires_at END,
         ended_at = CASE WHEN $2 = 'EXPIRE' THEN COALESCE(ended_at, now()) ELSE ended_at END,
         updated_at = now()
       WHERE id=$1`,
      [incidentId, status, confidence, ev.reporters, ev.confirmations, ev.contestations, refresh, p['incident.ttlMinutes']],
    );
  }

  private async getView(c: { query: DatabaseService['query'] } | PoolClient, id: string, installationId?: string) {
    const { rows } = await (c as any).query(
      `SELECT ${VIEW_COLS},
         CASE WHEN $2::uuid IS NULL THEN NULL
              WHEN EXISTS (SELECT 1 FROM reports r WHERE r.incident_id=i.id AND r.installation_id=$2::uuid) THEN 'REPORTER'
              ELSE (SELECT kind FROM incident_confirmations x WHERE x.incident_id=i.id AND x.installation_id=$2::uuid) END AS my_response
       FROM incidents i WHERE i.id=$1`, [id, installationId ?? null]);
    if (!rows.length) throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'Incident introuvable.' });
    return toView(rows[0]);
  }

  /** INC-001..005, INC-010 */
  private async replay(installationId: string, clientReportId: string) {
    const ex = (await this.db.query(
      `SELECT id, incident_id FROM reports WHERE installation_id=$1 AND client_report_id=$2`, [installationId, clientReportId])).rows[0];
    if (!ex) return null;
    return {
      report: { id: ex.id, status: 'VALIDE', incidentId: ex.incident_id, mergedIntoExisting: false, replayed: true },
      incident: ex.incident_id ? await this.getView(this.db, ex.incident_id, installationId) : null,
    };
  }

  async createReport(installationId: string, dto: CreateReportDto) {
    if (dto.clientReportId) {
      const again = await this.replay(installationId, dto.clientReportId);
      if (again) return again; // rejeu : aucun nouveau signalement
    }
    try {
      return await this.createReportOnce(installationId, dto);
    } catch (e: any) {
      if (e.code === '23505' && dto.clientReportId) {
        const again = await this.replay(installationId, dto.clientReportId); // rejeu concurrent
        if (again) return again;
      }
      throw e;
    }
  }

  private async createReportOnce(installationId: string, dto: CreateReportDto) {
    const p = await this.params.get();

    if (dto.observedAt) {
      const age = (Date.now() - new Date(dto.observedAt).getTime()) / 1000;
      if (age > p['report.maxAgeSeconds'] || age < -120) {
        throw new UnprocessableEntityException({ code: 'REPORT_TIMESTAMP_INVALID', message: 'L’horodatage du signalement est incohérent ou trop ancien.' });
      }
    }
    const recent = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM reports WHERE installation_id=$1 AND created_at > now() - make_interval(mins => $2)`,
      [installationId, p['report.windowMinutes']]);
    if (recent.rows[0].n >= p['report.maxPerWindow']) {
      throw new HttpException({ code: 'REPORT_RATE_LIMITED', message: 'Trop de signalements récents. Réessayez plus tard.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    return this.tx(async (c) => {
      const point = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`;
      const match = await c.query(
        `SELECT id FROM incidents
         WHERE type=$3 AND status IN ${ACTIVE} AND expires_at > now()
           AND ST_DWithin(geom::geography, ${point}::geography, $4)
         ORDER BY ST_Distance(geom::geography, ${point}::geography) LIMIT 1 FOR UPDATE`,
        [dto.lon, dto.lat, dto.type, p['incident.matchRadiusMeters']]);

      let incidentId: string;
      if (match.rows.length) {
        incidentId = match.rows[0].id;
      } else {
        incidentId = (await c.query(
          `INSERT INTO incidents (type, description, geom, expires_at)
           VALUES ($3, $5, ${point}, now() + make_interval(mins => $4)) RETURNING id`,
          [dto.lon, dto.lat, dto.type, p['incident.ttlMinutes'], dto.description ?? null])).rows[0].id;
      }
      const report = (await c.query(
        `INSERT INTO reports (installation_id, type, description, geom, status, incident_id, expires_at, client_report_id)
         VALUES ($3, $4, $5, ${point}, 'VALIDE', $6, now() + make_interval(mins => $7), $8) RETURNING id, status`,
        [dto.lon, dto.lat, installationId, dto.type, dto.description ?? null, incidentId, p['incident.ttlMinutes'], dto.clientReportId ?? null])).rows[0];
      await this.recompute(c, incidentId, true);
      return {
        report: { id: report.id, status: report.status, incidentId, mergedIntoExisting: match.rows.length > 0 },
        incident: await this.getView(c, incidentId, installationId),
      };
    });
  }

  async list(lat: number, lon: number, radius = 5000, installationId?: string) {
    const { rows } = await this.db.query(
      `SELECT ${VIEW_COLS},
         ST_Distance(i.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m,
         CASE WHEN $4::uuid IS NULL THEN NULL
              WHEN EXISTS (SELECT 1 FROM reports r WHERE r.incident_id=i.id AND r.installation_id=$4::uuid) THEN 'REPORTER'
              ELSE (SELECT kind FROM incident_confirmations x WHERE x.incident_id=i.id AND x.installation_id=$4::uuid) END AS my_response
       FROM incidents i
       WHERE i.status IN ${ACTIVE} AND i.expires_at > now()
         AND ST_DWithin(i.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
       ORDER BY distance_m LIMIT 100`, [lat, lon, radius, installationId ?? null]);
    return { incidents: rows.map(toView) };
  }

  get(id: string, installationId?: string) {
    return this.getView(this.db, id, installationId);
  }

  /** INC-006 : une seule réponse par installation et par incident ; le déclarant a déjà répondu. */
  async respond(installationId: string, incidentId: string, kind: 'CONFIRMATION' | 'CONTESTATION') {
    return this.tx(async (c) => {
      const inc = (await c.query(`SELECT status FROM incidents WHERE id=$1 FOR UPDATE`, [incidentId])).rows[0];
      if (!inc) throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'Incident introuvable.' });
      if (!['DETECTE', 'CONFIRME', 'EN_COURS'].includes(inc.status)) {
        throw new ConflictException({ code: 'INCIDENT_NOT_ACTIVE', message: 'Cet incident n’est plus actif.' });
      }
      const already = await c.query(`SELECT 1 FROM reports WHERE incident_id=$1 AND installation_id=$2 LIMIT 1`, [incidentId, installationId]);
      if (already.rowCount) {
        throw new ConflictException({ code: 'ALREADY_RESPONDED', message: 'Vous avez déjà signalé cet incident.' });
      }
      try {
        await c.query(`INSERT INTO incident_confirmations (incident_id, installation_id, kind) VALUES ($1,$2,$3)`,
          [incidentId, installationId, kind]);
      } catch (e: any) {
        if (e.code === '23505') {
          throw new ConflictException({ code: 'ALREADY_RESPONDED', message: 'Vous avez déjà répondu pour cet incident.' });
        }
        throw e;
      }
      await this.recompute(c, incidentId, kind === 'CONFIRMATION');
      return { incident: await this.getView(c, incidentId, installationId) };
    });
  }

  /**
   * Efface signalements et réponses d'une installation puis recalcule les incidents touchés ; un incident
   * qui ne repose plus sur aucun déclarant ni confirmation expire. Rejouable sans effet secondaire.
   */
  async eraseContributions(installationId: string): Promise<number> {
    return this.tx(async (c) => {
      const affected = (await c.query(
        `SELECT incident_id FROM reports WHERE installation_id=$1 AND incident_id IS NOT NULL
         UNION SELECT incident_id FROM incident_confirmations WHERE installation_id=$1`, [installationId])).rows.map((r) => r.incident_id);
      const reports = await c.query('DELETE FROM reports WHERE installation_id=$1', [installationId]);
      const answers = await c.query('DELETE FROM incident_confirmations WHERE installation_id=$1', [installationId]);
      for (const id of affected) {
        await c.query('SELECT 1 FROM incidents WHERE id=$1 FOR UPDATE', [id]);
        await this.recompute(c, id, false);
        await c.query(
          `UPDATE incidents SET status='EXPIRE', ended_at=COALESCE(ended_at, now()), updated_at=now()
           WHERE id=$1 AND reporter_count=0 AND confirmation_count=0 AND status IN ('DETECTE','CONFIRME','EN_COURS')`, [id]);
      }
      return (reports.rowCount ?? 0) + (answers.rowCount ?? 0);
    });
  }
}
