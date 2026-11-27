import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { ConsentsService } from '../privacy/consents.service';
import { ErasureRegistry } from '../privacy/erasure';
import { ObservationDto } from './dto/traffic.dto';
import { directionFor } from './traffic-logic';

export type RejectReason =
  | 'INVALID_ACCURACY' | 'SPEED_OUT_OF_RANGE' | 'TIMESTAMP_INVALID' | 'NO_ROAD_MATCH' | 'WRONG_DIRECTION';

@Injectable()
export class TrafficService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly params: ParametersService,
    private readonly consents: ConsentsService,
    private readonly registry: ErasureRegistry,
  ) {}

  onModuleInit() {
    // TRF-009 : le retrait du consentement supprime les observations brutes côté serveur.
    this.registry.register('GPS_OBSERVATIONS', async (installationId) => {
      const r = await this.db.query('DELETE FROM gps_observations WHERE installation_id=$1', [installationId]);
      return r.rowCount ?? 0;
    });
  }

  /** TRF-003..007, TRF-010 : consentement vérifié côté serveur, validation, appariement, déduplication. */
  async ingest(installationId: string, observations: ObservationDto[], appVersion?: string) {
    const consent = await this.consents.statistics(installationId);
    if (consent.granted !== true) {
      throw new ForbiddenException({ code: 'CONSENT_REQUIRED', message: 'Le consentement statistique n’est pas actif.' });
    }
    const p = await this.params.get();
    const now = Date.now();
    const rejected: { clientObsId: string; reason: RejectReason }[] = [];
    const valid: ObservationDto[] = [];

    for (const o of observations) {
      const age = (now - new Date(o.observedAt).getTime()) / 1000;
      if (age > p['traffic.maxObservationAgeSeconds'] || age < -30) rejected.push({ clientObsId: o.clientObsId, reason: 'TIMESTAMP_INVALID' });
      else if (o.accuracyMeters > p['traffic.maxAccuracyMeters']) rejected.push({ clientObsId: o.clientObsId, reason: 'INVALID_ACCURACY' });
      else if (o.speedMps > p['traffic.maxSpeedMps']) rejected.push({ clientObsId: o.clientObsId, reason: 'SPEED_OUT_OF_RANGE' });
      else valid.push(o);
    }

    let accepted = 0, duplicates = 0;
    if (valid.length) {
      // Appariement en une requête : segment le plus proche de chaque position, dans la distance max.
      const { rows } = await this.db.query(
        `SELECT o.idx::int AS idx, s.id AS segment_id, s.oneway, s.az
         FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS o(lon, lat, idx)
         CROSS JOIN LATERAL (
           SELECT id, oneway, degrees(ST_Azimuth(ST_StartPoint(geom), ST_EndPoint(geom))) AS az
           FROM road_segments
           WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(o.lon, o.lat), 4326)::geography, $3)
           ORDER BY ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(o.lon, o.lat), 4326)::geography)
           LIMIT 1) s`,
        [valid.map((o) => o.lon), valid.map((o) => o.lat), p['traffic.matchMaxDistanceMeters']]);
      const match = new Map<number, any>(rows.map((r) => [r.idx, r]));

      for (let i = 0; i < valid.length; i++) {
        const o = valid[i], m = match.get(i + 1);
        if (!m) { rejected.push({ clientObsId: o.clientObsId, reason: 'NO_ROAD_MATCH' }); continue; }
        let direction = directionFor(o.headingDeg, m.az);
        if (m.oneway) {
          if (direction === -1) { rejected.push({ clientObsId: o.clientObsId, reason: 'WRONG_DIRECTION' }); continue; }
          direction = 1;
        }
        const ins = await this.db.query(
          `INSERT INTO gps_observations (installation_id, client_obs_id, observed_at, segment_id, direction, speed_kph, consent_policy_version, app_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (installation_id, client_obs_id) DO NOTHING RETURNING id`,
          [installationId, o.clientObsId, o.observedAt, m.segment_id, direction, o.speedMps * 3.6, consent.policyVersion, appVersion ?? null]);
        if (ins.rowCount) accepted++; else duplicates++;
      }
    }
    return { accepted, duplicates, rejected };
  }

  /** TRF-001/002/012 : seulement des agrégats frais, avec source, fraîcheur et confiance. */
  async getTraffic(lat: number, lon: number, radius = 3000) {
    const { rows } = await this.db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (t.segment_id, t.direction)
           t.segment_id, t.direction, s.name, ST_AsGeoJSON(s.geom)::json AS geometry,
           t.mean_speed_kph, t.sample_count, t.confidence, t.state, t.source, t.window_end, t.computed_at, t.valid_until
         FROM traffic_statistics t JOIN road_segments s ON s.id = t.segment_id
         WHERE t.valid_until > now()
           AND ST_DWithin(s.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
         ORDER BY t.segment_id, t.direction, t.window_start DESC) x`, [lat, lon, radius]);
    return {
      status: rows.length ? 'OK' : 'DONNEES_INSUFFISANTES', // jamais « fluide » par défaut
      segments: rows.map((r) => ({
        segmentId: r.segment_id, direction: r.direction, name: r.name, geometry: r.geometry,
        state: r.state, meanSpeedKph: Math.round(r.mean_speed_kph), sampleCount: r.sample_count,
        confidence: r.confidence, source: r.source,
        observedAt: r.window_end, computedAt: r.computed_at, validUntil: r.valid_until,
      })),
    };
  }
}
