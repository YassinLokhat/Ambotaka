import { PARAM_DEFAULTS as p } from '../src/shared/parameters/parameters.service';
import { evaluateRules, Sample, serviceStates } from '../src/modules/monitoring/monitor-rules';
import { RequestStatsService } from '../src/modules/monitoring/request-stats.service';

const ok: Sample = {
  dbUp: true, redisUp: true, dbLatencyMs: 5, requests: 100, errors5xx: 0, p95Ms: 120, recentObservations: 0,
  aggregationLagSeconds: null, stuckDeletions: 0, activeCommunityIncidents: 0, freshTrafficSegments: 0,
};

describe('règles d’anomalie', () => {
  it('rien à signaler sur un échantillon sain, et seules les règles évaluées sont « saines »', () => {
    const r = evaluateRules(ok, p);
    expect(r.violations).toEqual([]);
    expect(r.healthy).toEqual(expect.arrayContaining(['API_ERROR_RATE', 'API_LATENCY', 'DELETION_STUCK']));
    expect(r.healthy).not.toContain('REDIS_DOWN');       // désactivée par défaut (Redis pas encore requis)
    expect(r.healthy).not.toContain('AGGREGATION_STALE'); // aucune observation récente : non évaluée
  });
  it('taux d’erreurs : seuil, gravité, et pas d’évaluation sans assez de requêtes', () => {
    expect(evaluateRules({ ...ok, errors5xx: 10 }, p).violations[0]).toMatchObject({ rule: 'API_ERROR_RATE', severity: 'ELEVE' });
    expect(evaluateRules({ ...ok, errors5xx: 40 }, p).violations[0].severity).toBe('CRITIQUE');
    const few = evaluateRules({ ...ok, requests: 5, errors5xx: 5 }, p);
    expect(few.violations).toEqual([]);
    expect(few.healthy).not.toContain('API_ERROR_RATE'); // manque de données ≠ rétablissement
  });
  it('latence p95', () => {
    expect(evaluateRules({ ...ok, p95Ms: 3000 }, p).violations[0]).toMatchObject({ rule: 'API_LATENCY', severity: 'MOYEN' });
  });
  it('agrégation en retard seulement si des observations arrivent', () => {
    expect(evaluateRules({ ...ok, recentObservations: 5, aggregationLagSeconds: 3600 }, p).violations[0].rule).toBe('AGGREGATION_STALE');
    expect(evaluateRules({ ...ok, recentObservations: 5, aggregationLagSeconds: null }, p).violations[0].rule).toBe('AGGREGATION_STALE');
    expect(evaluateRules({ ...ok, recentObservations: 5, aggregationLagSeconds: 60 }, p).violations).toEqual([]);
  });
  it('suppressions bloquées et Redis (quand activé)', () => {
    expect(evaluateRules({ ...ok, stuckDeletions: 2 }, p).violations[0].rule).toBe('DELETION_STUCK');
    expect(evaluateRules({ ...ok, redisUp: false }, { ...p, 'monitor.redisEnabled': 1 }).violations[0].rule).toBe('REDIS_DOWN');
  });
  it('états des services', () => {
    const v = evaluateRules({ ...ok, errors5xx: 10 }, p).violations;
    const st = serviceStates({ ...ok, errors5xx: 10 }, v);
    expect(st.find((s) => s.name === 'api')!.state).toBe('DEGRADE');
    expect(serviceStates({ ...ok, dbUp: false }, []).find((s) => s.name === 'postgres')!.state).toBe('INDISPONIBLE');
  });
});

describe('statistiques de requêtes (fenêtre glissante)', () => {
  it('compte, erreurs 5xx, p95, et oublie les minutes anciennes', () => {
    let t = 0;
    const s = new RequestStatsService(() => t);
    for (let i = 1; i <= 100; i++) s.record(i, i === 1 ? 500 : 200);
    expect(s.window(5)).toMatchObject({ requests: 100, errors5xx: 1, p95Ms: 95 });
    t = 6 * 60_000;
    expect(s.window(5)).toEqual({ requests: 0, errors5xx: 0, p95Ms: null });
  });
});
