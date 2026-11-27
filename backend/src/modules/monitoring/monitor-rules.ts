import { AppParams } from '../../shared/parameters/parameters.service';

export type Severity = 'FAIBLE' | 'MOYEN' | 'ELEVE' | 'CRITIQUE';
export type ServiceState = 'DISPONIBLE' | 'DEGRADE' | 'INDISPONIBLE';

export interface Sample {
  dbUp: boolean; redisUp: boolean; dbLatencyMs: number | null;
  requests: number; errors5xx: number; p95Ms: number | null;           // fenêtre glissante de 5 minutes
  recentObservations: number; aggregationLagSeconds: number | null;  // null : aucune statistique calculée
  stuckDeletions: number; activeCommunityIncidents: number; freshTrafficSegments: number;
}
export interface Violation { rule: string; service: string; severity: Severity; title: string; description: string }
export interface Evaluation { violations: Violation[]; healthy: string[] }

/**
 * Évalue les règles d'anomalie. `healthy` ne liste que les règles réellement évaluées ET saines : seules celles-là
 * peuvent clore automatiquement un incident (pas de « rétablissement » déduit d'un manque de données).
 */
export function evaluateRules(s: Sample, p: AppParams): Evaluation {
  const violations: Violation[] = [];
  const healthy: string[] = [];
  const check = (rule: string, bad: boolean, v: Omit<Violation, 'rule'>) => { bad ? violations.push({ rule, ...v }) : healthy.push(rule); };

  if (p['monitor.redisEnabled'] > 0) {
    check('REDIS_DOWN', !s.redisUp, { service: 'redis', severity: 'ELEVE', title: 'Redis indisponible', description: 'Le ping Redis échoue : files et limiteurs impactés.' });
  }
  if (s.requests >= p['monitor.minRequests']) {
    const rate = s.errors5xx / s.requests;
    check('API_ERROR_RATE', rate > p['monitor.errorRate'], {
      service: 'api', severity: rate > 0.25 ? 'CRITIQUE' : 'ELEVE', title: 'Taux d’erreurs API élevé',
      description: `${(rate * 100).toFixed(1)} % d’erreurs 5xx sur ${s.requests} requêtes (5 min), seuil ${(p['monitor.errorRate'] * 100).toFixed(1)} %.`,
    });
    if (s.p95Ms !== null) {
      check('API_LATENCY', s.p95Ms > p['monitor.latencyP95Ms'], {
        service: 'api', severity: 'MOYEN', title: 'Latence API élevée',
        description: `p95 = ${Math.round(s.p95Ms)} ms sur ${s.requests} requêtes (5 min), seuil ${p['monitor.latencyP95Ms']} ms.`,
      });
    }
  }
  if (s.dbUp) {
    if (s.recentObservations > 0) {
      const stale = s.aggregationLagSeconds === null || s.aggregationLagSeconds > p['monitor.aggregationStaleMinutes'] * 60;
      check('AGGREGATION_STALE', stale, {
        service: 'aggregation', severity: 'ELEVE', title: 'Agrégation du trafic en retard',
        description: s.aggregationLagSeconds === null
          ? 'Des observations arrivent mais aucune statistique n’a été calculée.'
          : `Dernier calcul il y a ${Math.round(s.aggregationLagSeconds / 60)} min (seuil ${p['monitor.aggregationStaleMinutes']} min).`,
      });
    }
    check('DELETION_STUCK', s.stuckDeletions > 0, {
      service: 'privacy', severity: 'ELEVE', title: 'Suppressions non confirmées',
      description: `${s.stuckDeletions} demande(s) de suppression non confirmée(s) depuis plus de ${p['monitor.deletionStuckHours']} h.`,
    });
  }
  return { violations, healthy };
}

export function serviceStates(s: Sample, violations: Violation[]): { name: string; state: ServiceState; detail?: string }[] {
  const has = (r: string) => violations.some((v) => v.rule === r);
  return [
    { name: 'postgres', state: !s.dbUp ? 'INDISPONIBLE' : (s.dbLatencyMs ?? 0) > 500 ? 'DEGRADE' : 'DISPONIBLE', detail: s.dbLatencyMs !== null ? `${Math.round(s.dbLatencyMs)} ms` : undefined },
    { name: 'redis', state: s.redisUp ? 'DISPONIBLE' : 'INDISPONIBLE' },
    { name: 'api', state: has('API_ERROR_RATE') || has('API_LATENCY') ? 'DEGRADE' : 'DISPONIBLE', detail: s.p95Ms !== null ? `p95 ${Math.round(s.p95Ms)} ms` : undefined },
    { name: 'aggregation', state: has('AGGREGATION_STALE') ? 'DEGRADE' : 'DISPONIBLE' },
    { name: 'suppressions', state: has('DELETION_STUCK') ? 'DEGRADE' : 'DISPONIBLE' },
  ];
}
