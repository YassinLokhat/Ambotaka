import { PARAM_DEFAULTS as p } from '../src/shared/parameters/parameters.service';
import { overlapFraction } from '../src/modules/recommendations/geo';
import {
  decide, directionMatches, evidenceConfidence, MinIntervalLimiter, trafficDelaySeconds,
} from '../src/modules/recommendations/reco-logic';

const row = { mean_speed_kph: 8, free_flow_kph: 50, direction: 1, seg_len: 150, seg_az: 0, route_az: 0, confidence: 0.8 };

describe('logique de recommandation', () => {
  it('retard mesuré par rapport à la vitesse déjà supposée par le fournisseur', () => {
    const slowProvider = trafficDelaySeconds(row, 13);   // fournisseur déjà lent => petit retard
    const fastProvider = trafficDelaySeconds(row, 40);   // fournisseur rapide => grand retard
    expect(fastProvider).toBeGreaterThan(slowProvider);
    expect(trafficDelaySeconds({ ...row, mean_speed_kph: 60 }, 40)).toBe(0);      // plus rapide que prévu : pas de retard
    expect(trafficDelaySeconds({ ...row, free_flow_kph: null }, 40)).toBe(0);     // pas de référence : pas d'estimation
  });
  it('sens de circulation', () => {
    expect(directionMatches(0, 0, 180)).toBe(true);
    expect(directionMatches(1, 10, 20)).toBe(true);
    expect(directionMatches(-1, 10, 20)).toBe(false);
    expect(directionMatches(-1, 10, 190)).toBe(true);
  });
  it('pas de recommandation sans retard documenté (REC-005)', () => {
    expect(decide(900, 400, [], p)).toEqual({ ok: false, reason: 'NO_DATA' });
  });
  it('gain insuffisant ou confiance faible => aucune recommandation', () => {
    const ev = [{ kind: 'TRAFFIC' as const, delaySeconds: 300, confidence: 0.9, label: 'x' }];
    expect(decide(900, 850, ev, p)).toEqual({ ok: false, reason: 'NO_BETTER_ROUTE' });
    expect(decide(900, 400, [{ ...ev[0], confidence: 0.2 }], p)).toEqual({ ok: false, reason: 'LOW_CONFIDENCE' });
    expect(decide(900, 400, ev, p)).toMatchObject({ ok: true, gain: 500 });
  });
  it('confiance pondérée par le retard', () => {
    expect(evidenceConfidence([
      { kind: 'TRAFFIC', delaySeconds: 300, confidence: 1, label: '' },
      { kind: 'INCIDENT', delaySeconds: 100, confidence: 0.2, label: '' },
    ])).toBe(0.8);
  });
  it('limiteur d’intervalle', () => {
    let t = 0;
    const l = new MinIntervalLimiter(() => t);
    expect(l.allow('a', 30_000)).toBe(true);
    t = 10_000; expect(l.allow('a', 30_000)).toBe(false);
    expect(l.allow('b', 30_000)).toBe(true);
    t = 31_000; expect(l.allow('a', 30_000)).toBe(true);
  });
  it('recouvrement d’itinéraires', () => {
    const a: [number, number][] = [[47.52, -18.92], [47.52, -18.9]];
    const near: [number, number][] = [[47.52005, -18.92], [47.52005, -18.9]];
    const far: [number, number][] = [[47.53, -18.92], [47.53, -18.9]];
    expect(overlapFraction(a, near, 40)).toBe(1);
    expect(overlapFraction(a, far, 40)).toBe(0);
  });
});
