import {
  BadGatewayException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { ErasureRegistry } from '../privacy/erasure';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { ProviderUnavailableError, ROUTING_PROVIDER, RouteResult, RoutingProvider } from '../navigation/providers/types';
import { EvaluateDto } from './dto/recommendations.dto';
import { overlapFraction, Pt, routeHash } from './geo';
import {
  decide, directionMatches, Evidence, formatMotif, MinIntervalLimiter, trafficDelaySeconds,
} from './reco-logic';

const TYPE_FR: Record<string, string> = {
  ACCIDENT: 'Accident', EMBOUTEILLAGE: 'Embouteillage', ROUTE_BLOQUEE: 'Route bloquée', TRAVAUX: 'Travaux', DANGER: 'Danger', AUTRE: 'Incident',
};

const view = (r: any) => ({
  id: r.id, sessionId: r.session_id, createdAt: r.created_at, expiresAt: r.expires_at, decision: r.decision,
  gainSeconds: r.gain_s, confidence: r.confidence, motif: r.motif, reasons: r.reasons,
  currentRoute: { durationSeconds: r.current_duration_s, adjustedDurationSeconds: r.current_adjusted_s },
  proposedRoute: { durationSeconds: r.proposed_duration_s, adjustedDurationSeconds: r.proposed_adjusted_s },
});

@Injectable()
export class RecommendationsService implements OnModuleInit {
  private limiter = new MinIntervalLimiter();
  constructor(
    private readonly db: DatabaseService,
    private readonly params: ParametersService,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    private readonly registry: ErasureRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('RECOMMENDATIONS', async (installationId) =>
      (await this.db.query('DELETE FROM route_recommendations WHERE installation_id=$1', [installationId])).rowCount ?? 0);
  }

  /** Retards estimés sur un itinéraire à partir du trafic communautaire frais et des incidents fiables (REC-001). */
  private async evidenceFor(route: RouteResult, userPos: Pt, p: Awaited<ReturnType<ParametersService['get']>>): Promise<Evidence[]> {
    const geojson = JSON.stringify(route.geometry);
    const routeAvgKph = route.durationSeconds > 0 ? (route.distanceMeters / route.durationSeconds) * 3.6 : 30;
    const evidence: Evidence[] = [];

    const traffic = await this.db.query(
      `WITH r AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
            latest AS (SELECT DISTINCT ON (segment_id, direction) * FROM traffic_statistics
                       WHERE valid_until > now() AND confidence >= $2
                       ORDER BY segment_id, direction, window_start DESC)
       SELECT t.direction, t.mean_speed_kph, t.confidence, s.free_flow_kph,
              ST_Length(s.geom::geography) AS seg_len,
              degrees(ST_Azimuth(ST_StartPoint(s.geom), ST_EndPoint(s.geom))) AS seg_az,
              degrees(ST_Azimuth(ST_LineInterpolatePoint(r.g, GREATEST(l.f - 0.002, 0)),
                                 ST_LineInterpolatePoint(r.g, LEAST(l.f + 0.002, 1)))) AS route_az
       FROM r, latest t JOIN road_segments s ON s.id = t.segment_id
       CROSS JOIN LATERAL (SELECT ST_LineLocatePoint(r.g, ST_LineInterpolatePoint(s.geom, 0.5)) AS f) l
       WHERE ST_DWithin(s.geom::geography, r.g::geography, 12)
         AND ST_DWithin(ST_StartPoint(s.geom)::geography, r.g::geography, 20)
         AND ST_DWithin(ST_EndPoint(s.geom)::geography, r.g::geography, 20)`,
      [geojson, p['reco.minTrafficConfidence']]);

    let delay = 0, lenKm = 0, wConf = 0, wSpeed = 0;
    for (const row of traffic.rows) {
      if (!directionMatches(row.direction, row.seg_az, row.route_az)) continue;
      const d = trafficDelaySeconds(row, routeAvgKph);
      if (d <= 0) continue;
      delay += d; lenKm += row.seg_len / 1000; wConf += d * row.confidence; wSpeed += d * row.mean_speed_kph;
    }
    if (delay > 0) {
      evidence.push({
        kind: 'TRAFFIC', delaySeconds: delay, confidence: wConf / delay,
        label: `Ralentissements mesurés par d’autres conducteurs sur ${lenKm.toFixed(1)} km (environ ${Math.round(wSpeed / delay)} km/h)`,
      });
    }

    const inc = await this.db.query(
      `WITH r AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g)
       SELECT i.type, i.status, i.confidence,
              ST_LineLocatePoint(r.g, i.geom) * ST_Length(r.g::geography) AS ahead_m
       FROM r, incidents i
       WHERE i.status IN ('DETECTE','CONFIRME','EN_COURS') AND i.expires_at > now() AND i.confidence >= $2
         AND ST_DWithin(i.geom::geography, r.g::geography, 40)`,
      [geojson, p['reco.minIncidentConfidence']]);
    for (const i of inc.rows) {
      const pen = p[`reco.penalty.${i.type}` as keyof typeof p] as number | undefined;
      if (!pen) continue;
      evidence.push({
        kind: 'INCIDENT', delaySeconds: pen, confidence: i.confidence, distanceAheadMeters: Math.round(i.ahead_m),
        label: `${TYPE_FR[i.type] ?? 'Incident'} ${i.status === 'CONFIRME' ? 'confirmé' : 'signalé'} à ${Math.round(i.ahead_m)} m devant vous`,
      });
    }
    return evidence;
  }

  /** REC-001..005, REC-008 : calcule d'abord l'alternative, compare avec la même méthode, n'émet rien si les données manquent. */
  async evaluate(installationId: string, dto: EvaluateDto) {
    const p = await this.params.get();
    if (!this.limiter.allow(installationId, p['reco.minIntervalSeconds'] * 1000)) {
      throw new HttpException({ code: 'RECOMMENDATION_RATE_LIMITED', message: 'Évaluations trop rapprochées.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.expireDue();

    // Recommandation encore valable pour cette session : on la renvoie (idempotence).
    const pending = await this.db.query(
      `SELECT * FROM route_recommendations WHERE installation_id=$1 AND session_id=$2 AND decision='EN_ATTENTE' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [installationId, dto.sessionId]);
    if (pending.rows.length) return { recommendation: view(pending.rows[0]), reason: null };

    let candidates: RouteResult[];
    try {
      candidates = await this.routing.calculateRoutes(dto.position, dto.destination);
    } catch (e) {
      if (e instanceof ProviderUnavailableError) {
        throw new BadGatewayException({ code: 'ROUTING_PROVIDER_UNAVAILABLE', message: 'Le service cartographique est momentanément indisponible.' });
      }
      throw e;
    }
    if (candidates.length < 2) return { recommendation: null, reason: 'NO_ALTERNATIVE' };

    // Identifie l'itinéraire courant parmi les candidats : sans correspondance, aucune comparaison fiable.
    const tol = p['reco.matchToleranceMeters'];
    const scored = candidates.map((c) => ({ c, f: overlapFraction(dto.currentRoute, c.geometry.coordinates, tol) }));
    const best = scored.reduce((a, b) => (b.f > a.f ? b : a));
    if (best.f < p['reco.minRouteMatch']) return { recommendation: null, reason: 'CURRENT_ROUTE_UNMATCHED' };
    const current = best.c;
    const alternatives = candidates.filter((c) => c !== current);

    const userPos: Pt = [dto.position.lon, dto.position.lat];
    const curEv = await this.evidenceFor(current, userPos, p);
    const curAdj = current.durationSeconds + curEv.reduce((s, e) => s + e.delaySeconds, 0);
    let bestAlt: { r: RouteResult; adj: number } | null = null;
    for (const alt of alternatives) {
      const ev = await this.evidenceFor(alt, userPos, p);
      const adj = alt.durationSeconds + ev.reduce((s, e) => s + e.delaySeconds, 0);
      if (!bestAlt || adj < bestAlt.adj) bestAlt = { r: alt, adj };
    }
    const verdict = decide(curAdj, bestAlt!.adj, curEv, p);
    if (!verdict.ok) return { recommendation: null, reason: verdict.reason };

    const hash = routeHash(bestAlt!.r.geometry.coordinates);
    const ignored = await this.db.query(
      `SELECT 1 FROM route_recommendations WHERE installation_id=$1 AND session_id=$2 AND proposed_hash=$3
         AND decision='IGNOREE' AND decided_at > now() - make_interval(secs => $4) LIMIT 1`,
      [installationId, dto.sessionId, hash, p['reco.ignoreCooldownSeconds']]);
    if (ignored.rowCount) return { recommendation: null, reason: 'RECENTLY_IGNORED' };

    const motif = formatMotif(verdict.gain, curEv);
    const ins = await this.db.query(
      `INSERT INTO route_recommendations
         (installation_id, session_id, expires_at, current_duration_s, current_adjusted_s, proposed_duration_s,
          proposed_adjusted_s, gain_s, confidence, motif, reasons, proposed_hash)
       VALUES ($1,$2, now() + make_interval(secs => $3), $4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [installationId, dto.sessionId, p['reco.ttlSeconds'], Math.round(current.durationSeconds), Math.round(curAdj),
       Math.round(bestAlt!.r.durationSeconds), Math.round(bestAlt!.adj), verdict.gain, verdict.confidence, motif,
       JSON.stringify(curEv.map((e) => ({ kind: e.kind, label: e.label, delaySeconds: Math.round(e.delaySeconds) }))), hash]);

    const rec = view(ins.rows[0]);
    return {
      reason: null,
      recommendation: {
        ...rec,
        estimationSource: 'DUREE_REFERENCE_AJUSTEE', // durée fournisseur + retards estimés (trafic communautaire, incidents)
        proposedRoute: { ...rec.proposedRoute, id: bestAlt!.r.id, distanceMeters: bestAlt!.r.distanceMeters, geometry: bestAlt!.r.geometry, steps: bestAlt!.r.steps },
      },
    };
  }

  private async expireDue() {
    await this.db.query(`UPDATE route_recommendations SET decision='EXPIREE' WHERE decision='EN_ATTENTE' AND expires_at <= now()`);
    const hours = (await this.params.get())['reco.retentionHours'];
    await this.db.query(`DELETE FROM route_recommendations WHERE created_at < now() - make_interval(hours => $1)`, [hours]);
  }

  async list(installationId: string, sessionId?: string) {
    await this.expireDue();
    const { rows } = await this.db.query(
      `SELECT * FROM route_recommendations WHERE installation_id=$1 AND ($2::text IS NULL OR session_id=$2)
       ORDER BY created_at DESC LIMIT 20`, [installationId, sessionId ?? null]);
    return { recommendations: rows.map(view) };
  }

  /** REC-006/007 : accepter ou ignorer ; une recommandation expirée ne peut plus être acceptée. */
  async decide(installationId: string, id: string, decision: 'ACCEPTEE' | 'IGNOREE') {
    await this.expireDue();
    const { rows } = await this.db.query(`SELECT * FROM route_recommendations WHERE id=$1 AND installation_id=$2`, [id, installationId]);
    if (!rows.length) throw new NotFoundException({ code: 'RECOMMENDATION_NOT_FOUND', message: 'Recommandation introuvable.' });
    const r = rows[0];
    if (r.decision === decision) return { recommendation: view(r) }; // rejouable
    if (r.decision === 'EXPIREE') throw new ConflictException({ code: 'RECOMMENDATION_EXPIRED', message: 'Cette recommandation a expiré.' });
    if (r.decision !== 'EN_ATTENTE') throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'Une décision a déjà été enregistrée.' });
    const upd = await this.db.query(
      `UPDATE route_recommendations SET decision=$2, decided_at=now() WHERE id=$1 AND decision='EN_ATTENTE' AND expires_at > now() RETURNING *`,
      [id, decision]);
    if (!upd.rows.length) throw new ConflictException({ code: 'RECOMMENDATION_EXPIRED', message: 'Cette recommandation a expiré.' });
    return { recommendation: view(upd.rows[0]) };
  }
}
