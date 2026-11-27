import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { AdminPrincipal } from './admin-auth.service';
import { AuditService } from './audit.service';

@Injectable()
export class AdminOpsService {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  /** Incidents communautaires : contenu public (aucune donnée personnelle, pas d'identifiant de déclarant). */
  async listCommunityIncidents(status?: string, limit = 100) {
    const { rows } = await this.db.query(
      `SELECT id, type, description, status, ST_Y(geom) AS latitude, ST_X(geom) AS longitude, confidence,
              reporter_count, confirmation_count, contestation_count, started_at, ended_at, expires_at, updated_at
       FROM incidents WHERE ($1::text IS NULL OR status = $1) ORDER BY updated_at DESC LIMIT $2`, [status ?? null, limit]);
    return { incidents: rows.map((r) => ({
      id: r.id, type: r.type, description: r.description, status: r.status, latitude: r.latitude, longitude: r.longitude,
      confidence: r.confidence, reporterCount: r.reporter_count, confirmationCount: r.confirmation_count,
      contestationCount: r.contestation_count, startedAt: r.started_at, endedAt: r.ended_at, expiresAt: r.expires_at, updatedAt: r.updated_at,
    })) };
  }

  async moderateIncident(by: AdminPrincipal, ip: string | undefined, id: string, action: 'RESOLVE' | 'EXPIRE') {
    const cur = (await this.db.query('SELECT status FROM incidents WHERE id=$1', [id])).rows[0];
    if (!cur) throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'Incident introuvable.' });
    if (['RESOLU', 'EXPIRE'].includes(cur.status)) throw new ConflictException({ code: 'INCIDENT_NOT_ACTIVE', message: 'Cet incident est déjà clos.' });
    const next = action === 'RESOLVE' ? 'RESOLU' : 'EXPIRE';
    await this.db.query(`UPDATE incidents SET status=$2, ended_at=now(), updated_at=now() WHERE id=$1`, [id, next]);
    await this.audit.log({ adminId: by.adminId, username: by.username, ip }, 'COMMUNITY_INCIDENT_MODERATED', `incident:${id}`, { from: cur.status, to: next });
    return { id, status: next };
  }

  /** Vue agrégée uniquement : jamais de position individuelle (spec §14.2). */
  async trafficSummary() {
    const states = await this.db.query(
      `SELECT state, count(*)::int AS n FROM (
         SELECT DISTINCT ON (segment_id, direction) state FROM traffic_statistics WHERE valid_until > now()
         ORDER BY segment_id, direction, window_start DESC) x GROUP BY state`);
    const misc = (await this.db.query(
      `SELECT (SELECT count(*)::int FROM road_segments) AS segments,
              (SELECT max(computed_at) FROM traffic_statistics) AS last_computed,
              (SELECT count(*)::int FROM gps_observations WHERE received_at > now() - interval '1 hour') AS observations_last_hour,
              (SELECT count(DISTINCT installation_id)::int FROM gps_observations WHERE received_at > now() - interval '1 hour') AS contributors_last_hour`)).rows[0];
    return {
      freshSegmentsByState: Object.fromEntries(states.rows.map((r) => [r.state, r.n])),
      networkSegments: misc.segments, lastComputedAt: misc.last_computed,
      observationsLastHour: misc.observations_last_hour, contributorsLastHour: misc.contributors_last_hour,
    };
  }

  /** Suppressions : comptes par statut + demandes bloquées (installation tronquée, pseudonyme). */
  async deletionsSummary(stuckHours: number) {
    const counts = await this.db.query('SELECT status, count(*)::int AS n FROM deletion_requests GROUP BY status');
    const stuck = await this.db.query(
      `SELECT id, left(installation_id::text, 8) AS installation, types, status, attempts, created_at
       FROM deletion_requests WHERE status <> 'CONFIRMEE' AND created_at < now() - make_interval(hours => $1)
       ORDER BY created_at LIMIT 50`, [stuckHours]);
    return {
      byStatus: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      stuck: stuck.rows.map((r) => ({ id: r.id, installation: r.installation, types: r.types, status: r.status, attempts: r.attempts, createdAt: r.created_at })),
    };
  }
}
