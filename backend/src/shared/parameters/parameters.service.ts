import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export const PARAM_DEFAULTS = {
  'incident.matchRadiusMeters': 150, 'incident.ttlMinutes': 60, 'incident.scoreForFullConfidence': 4,
  'incident.confirmThreshold': 0.5, 'incident.contestationWeight': 1.5, 'incident.minContestationsToReject': 2,
  'incident.rejectScore': 0, 'report.maxPerWindow': 5, 'report.windowMinutes': 10, 'report.maxAgeSeconds': 600,
  'traffic.matchMaxDistanceMeters': 25, 'traffic.maxAccuracyMeters': 30, 'traffic.maxSpeedMps': 45,
  'traffic.maxObservationAgeSeconds': 600, 'traffic.windowMinutes': 5, 'traffic.minContributors': 3,
  'traffic.minSamples': 6, 'traffic.validityMinutes': 15, 'traffic.fullContributors': 8, 'traffic.fullSamples': 40,
  'reco.ttlSeconds': 120, 'reco.minGainSeconds': 120, 'reco.minGainRatio': 0.1, 'reco.minConfidence': 0.5,
  'reco.minRouteMatch': 0.8, 'reco.matchToleranceMeters': 40, 'reco.minTrafficConfidence': 0.3,
  'reco.minIncidentConfidence': 0.5, 'reco.penalty.ACCIDENT': 600, 'reco.penalty.EMBOUTEILLAGE': 420,
  'reco.penalty.ROUTE_BLOQUEE': 1800, 'reco.penalty.TRAVAUX': 240, 'reco.penalty.DANGER': 60, 'reco.penalty.AUTRE': 0,
  'reco.ignoreCooldownSeconds': 600, 'reco.minIntervalSeconds': 30, 'reco.retentionHours': 24,
  'monitor.redisEnabled': 0, 'monitor.errorRate': 0.05, 'monitor.latencyP95Ms': 2000, 'monitor.minRequests': 20,
  'monitor.aggregationStaleMinutes': 10, 'monitor.deletionStuckHours': 1, 'monitor.metricsRetentionDays': 14,
  'traffic.fluidRatio': 0.7, 'traffic.slowRatio': 0.4, 'traffic.rawRetentionHours': 24, 'traffic.statsRetentionDays': 30,
};
export type AppParams = typeof PARAM_DEFAULTS;
export type IncidentParams = AppParams; // alias historique

/** Paramètres métier lus en base (modifiables par l'administration), avec cache court. */
@Injectable()
export class ParametersService {
  private cache: { at: number; values: AppParams } | null = null;
  constructor(private readonly db: DatabaseService) {}

  /** Appelé après une modification par l'administration : prise en compte immédiate sur cette instance. */
  invalidate() { this.cache = null; }

  async get(): Promise<AppParams> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.values;
    const { rows } = await this.db.query<{ key: string; value: unknown }>('SELECT key, value FROM system_parameters');
    const values: any = { ...PARAM_DEFAULTS };
    for (const r of rows) if (r.key in values && typeof r.value === 'number') values[r.key] = r.value;
    this.cache = { at: Date.now(), values };
    return values;
  }
}
