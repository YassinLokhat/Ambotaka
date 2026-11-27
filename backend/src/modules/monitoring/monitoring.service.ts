import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { RedisService } from '../../shared/redis/redis.service';
import { evaluateRules, Sample, serviceStates, Violation } from './monitor-rules';
import { PromService } from './prom.service';
import { RequestStatsService } from './request-stats.service';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Monitoring');
  private timer?: NodeJS.Timeout;
  private ticks = 0;
  private dbDownSince: Date | null = null;
  last: { sample: Sample; services: ReturnType<typeof serviceStates>; at: Date } | null = null;

  constructor(
    private readonly db: DatabaseService, private readonly redis: RedisService, private readonly params: ParametersService,
    private readonly stats: RequestStatsService, private readonly prom: PromService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e.message)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  async collect(): Promise<Sample> {
    const t0 = Date.now();
    const dbUp = await this.db.ping();
    const dbLatencyMs = dbUp ? Date.now() - t0 : null;
    const redisUp = await this.redis.ping();
    const w = this.stats.window(5);
    const base: Sample = {
      dbUp, redisUp, dbLatencyMs, requests: w.requests, errors5xx: w.errors5xx, p95Ms: w.p95Ms,
      recentObservations: 0, aggregationLagSeconds: null, stuckDeletions: 0, activeCommunityIncidents: 0, freshTrafficSegments: 0,
    };
    if (!dbUp) return base;
    const p = await this.params.get();
    const r = (await this.db.query(
      `SELECT (SELECT count(*)::int FROM gps_observations WHERE received_at > now() - interval '10 minutes') AS recent_obs,
              (SELECT extract(epoch FROM now() - max(computed_at)) FROM traffic_statistics) AS agg_lag,
              (SELECT count(*)::int FROM deletion_requests WHERE status <> 'CONFIRMEE' AND created_at < now() - make_interval(hours => $1)) AS stuck,
              (SELECT count(*)::int FROM incidents WHERE status IN ('DETECTE','CONFIRME','EN_COURS') AND expires_at > now()) AS active_inc,
              (SELECT count(*)::int FROM (SELECT DISTINCT segment_id, direction FROM traffic_statistics WHERE valid_until > now()) x) AS fresh_seg`,
      [p['monitor.deletionStuckHours']])).rows[0];
    return {
      ...base, recentObservations: r.recent_obs, aggregationLagSeconds: r.agg_lag === null ? null : Number(r.agg_lag),
      stuckDeletions: r.stuck, activeCommunityIncidents: r.active_inc, freshTrafficSegments: r.fresh_seg,
    };
  }

  async tick() {
    const sample = await this.collect();
    await this.process(sample);
  }

  /** Persiste les métriques, évalue les règles, ouvre/actualise/clôt les incidents techniques et crée les alertes. */
  async process(sample: Sample, now = new Date()) {
    const p = await this.params.get();
    const { violations, healthy } = evaluateRules(sample, p);
    const services = serviceStates(sample, violations);
    this.last = { sample, services, at: now };

    // Prometheus (toujours, même si la base est indisponible).
    if (sample.dbLatencyMs !== null) this.prom.dbLatency.set(sample.dbLatencyMs);
    if (sample.aggregationLagSeconds !== null) this.prom.aggLag.set(sample.aggregationLagSeconds);
    this.prom.stuckDeletions.set(sample.stuckDeletions);
    this.prom.communityIncidents.set(sample.activeCommunityIncidents);
    this.prom.trafficSegments.set(sample.freshTrafficSegments);
    for (const s of services) this.prom.serviceUp.set({ service: s.name }, s.state === 'INDISPONIBLE' ? 0 : 1);

    if (!sample.dbUp) {
      this.dbDownSince ??= now; // impossible d'écrire en base : on mémorise la panne et on la consignera au retour
      this.logger.error('PostgreSQL indisponible');
      return;
    }
    if (this.dbDownSince) { await this.recordPastDbOutage(this.dbDownSince, now); this.dbDownSince = null; }

    await this.persistMetrics(sample, services);
    await this.reconcile(violations, healthy, now);
    if (++this.ticks % 60 === 0) {
      await this.db.query(`DELETE FROM system_metrics WHERE at < now() - make_interval(days => $1)`, [p['monitor.metricsRetentionDays']]);
    }
    const open = await this.db.query(`SELECT severity, count(*)::int n FROM technical_incidents WHERE status IN ('OUVERT','EN_COURS') GROUP BY severity`);
    for (const sev of ['FAIBLE', 'MOYEN', 'ELEVE', 'CRITIQUE']) this.prom.openIncidents.set({ severity: sev }, open.rows.find((r) => r.severity === sev)?.n ?? 0);
  }

  private async persistMetrics(s: Sample, services: ReturnType<typeof serviceStates>) {
    const rows: [string, number | null, string][] = [
      ['api.requests_5min', s.requests, 'req'], ['api.errors5xx_5min', s.errors5xx, 'req'], ['api.p95_ms', s.p95Ms, 'ms'],
      ['db.latency_ms', s.dbLatencyMs, 'ms'], ['traffic.aggregation_lag_s', s.aggregationLagSeconds, 's'],
      ['traffic.fresh_segments', s.freshTrafficSegments, 'segments'], ['community.active_incidents', s.activeCommunityIncidents, 'incidents'],
      ['privacy.stuck_deletions', s.stuckDeletions, 'demandes'], ['process.rss_mb', Math.round(process.memoryUsage().rss / 1048576), 'Mo'],
    ];
    for (const [name, value, unit] of rows) if (value !== null) await this.db.query('INSERT INTO system_metrics (name, value, unit) VALUES ($1,$2,$3)', [name, value, unit]);
    void services;
  }

  private async reconcile(violations: Violation[], healthy: string[], now: Date) {
    const open = (await this.db.query(`SELECT id, rule FROM technical_incidents WHERE status IN ('OUVERT','EN_COURS')`)).rows;
    for (const v of violations) {
      const existing = open.find((o) => o.rule === v.rule);
      if (existing) {
        await this.db.query(`UPDATE technical_incidents SET last_seen_at=$2, occurrences=occurrences+1, severity=$3, description=$4 WHERE id=$1`,
          [existing.id, now, v.severity, v.description]);
      } else {
        const id = (await this.db.query(
          `INSERT INTO technical_incidents (rule, service, title, description, severity, opened_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
          [v.rule, v.service, v.title, v.description, v.severity, now])).rows[0].id;
        await this.db.query(`INSERT INTO technical_alerts (incident_id, message, severity) VALUES ($1,$2,$3)`, [id, `${v.title} — ${v.description}`, v.severity]);
      }
    }
    for (const o of open) {
      if (healthy.includes(o.rule)) {
        await this.db.query(`UPDATE technical_incidents SET status='RESOLU', resolved_at=$2, resolved_by='système' WHERE id=$1`, [o.id, now]);
      }
    }
  }

  private async recordPastDbOutage(from: Date, to: Date) {
    const id = (await this.db.query(
      `INSERT INTO technical_incidents (rule, service, title, description, severity, status, opened_at, last_seen_at, resolved_at, resolved_by)
       VALUES ('DB_DOWN','postgres','PostgreSQL indisponible',$1,'CRITIQUE','RESOLU',$2,$3,$3,'système') RETURNING id`,
      [`Base injoignable de ${from.toISOString()} à ${to.toISOString()} (consigné au rétablissement).`, from, to])).rows[0].id;
    await this.db.query(`INSERT INTO technical_alerts (incident_id, message, severity) VALUES ($1,$2,'CRITIQUE')`,
      [id, 'PostgreSQL a été indisponible ; incident consigné au rétablissement.']);
  }
}
