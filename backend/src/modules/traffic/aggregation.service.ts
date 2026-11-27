import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { classify, trafficConfidence } from './traffic-logic';

@Injectable()
export class AggregationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: DatabaseService, private readonly params: ParametersService) {}

  // Sera confié à un worker BullMQ au Lot 7.
  onModuleInit() {
    this.timer = setInterval(() => this.aggregate().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  /**
   * Agrège par segment, sens et fenêtre ; ne publie que si le nombre de contributeurs distincts et
   * d'échantillons atteint les seuils (TRF-008, TRF-012). Une absence de données n'est jamais « fluide ».
   */
  async aggregate(): Promise<number> {
    const p = await this.params.get();
    const win = p['traffic.windowMinutes'];
    const { rows } = await this.db.query(
      `SELECT o.segment_id, o.direction,
              date_bin(make_interval(mins => $1), o.observed_at, TIMESTAMPTZ '2000-01-01') AS window_start,
              avg(o.speed_kph)::float8 AS mean,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY o.speed_kph)::float8 AS median,
              count(*)::int AS samples, count(DISTINCT o.installation_id)::int AS contributors, s.free_flow_kph
       FROM gps_observations o JOIN road_segments s ON s.id = o.segment_id
       WHERE o.observed_at >= now() - make_interval(mins => $2)
       GROUP BY o.segment_id, o.direction, window_start, s.free_flow_kph
       HAVING count(DISTINCT o.installation_id) >= $3 AND count(*) >= $4`,
      [win, win * 3, p['traffic.minContributors'], p['traffic.minSamples']]);

    for (const r of rows) {
      await this.db.query(
        `INSERT INTO traffic_statistics
           (segment_id, direction, window_start, window_end, mean_speed_kph, median_speed_kph, sample_count,
            contributor_count, confidence, state, computed_at, valid_until)
         VALUES ($1,$2,$3, $3::timestamptz + make_interval(mins => $4), $5,$6,$7,$8,$9,$10, now(),
                 $3::timestamptz + make_interval(mins => $4 + $11))
         ON CONFLICT (segment_id, direction, window_start) DO UPDATE SET
           mean_speed_kph=EXCLUDED.mean_speed_kph, median_speed_kph=EXCLUDED.median_speed_kph,
           sample_count=EXCLUDED.sample_count, contributor_count=EXCLUDED.contributor_count,
           confidence=EXCLUDED.confidence, state=EXCLUDED.state, computed_at=now()`,
        [r.segment_id, r.direction, r.window_start, win, r.mean, r.median, r.samples, r.contributors,
         trafficConfidence(r.contributors, r.samples, p), classify(r.mean, r.free_flow_kph, p), p['traffic.validityMinutes']]);
    }
    await this.purge(p['traffic.rawRetentionHours'], p['traffic.statsRetentionDays']);
    return rows.length;
  }

  private async purge(rawHours: number, statsDays: number) {
    await this.db.query(`DELETE FROM gps_observations WHERE observed_at < now() - make_interval(hours => $1)`, [rawHours]);
    await this.db.query(`DELETE FROM traffic_statistics WHERE window_end < now() - make_interval(days => $1)`, [statsDays]);
  }
}
