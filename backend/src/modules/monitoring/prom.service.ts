import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class PromService {
  readonly registry = new Registry();
  readonly http = new Histogram({
    name: 'roadpulse_http_request_duration_seconds', help: 'Durée des requêtes HTTP', labelNames: ['method', 'route', 'status_class'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5], registers: [this.registry],
  });
  private g = (name: string, help: string, labelNames: string[] = []) => new Gauge({ name, help, labelNames, registers: [this.registry] });
  readonly dbLatency = this.g('roadpulse_db_latency_ms', 'Latence du ping PostgreSQL (ms)');
  readonly aggLag = this.g('roadpulse_aggregation_lag_seconds', 'Âge du dernier agrégat de trafic (s)');
  readonly stuckDeletions = this.g('roadpulse_stuck_deletions', 'Demandes de suppression non confirmées au-delà du seuil');
  readonly communityIncidents = this.g('roadpulse_active_community_incidents', 'Incidents communautaires actifs');
  readonly trafficSegments = this.g('roadpulse_fresh_traffic_segments', 'Tronçons avec une mesure de trafic fraîche');
  readonly openIncidents = this.g('roadpulse_open_technical_incidents', 'Incidents techniques ouverts', ['severity']);
  readonly serviceUp = this.g('roadpulse_service_up', '1 si le service est disponible', ['service']);

  constructor() { collectDefaultMetrics({ register: this.registry, prefix: 'roadpulse_' }); }
}
