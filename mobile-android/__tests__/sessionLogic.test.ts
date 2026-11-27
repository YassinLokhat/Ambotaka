import { RESTORE_WINDOW_MS } from '../src/feature/navigation/session/constants';
import {
  buildSummary, deadline, effectiveDurationSeconds, evaluateRestoration, expire, finish, interrupt, resume,
  startSession,
} from '../src/feature/navigation/session/sessionLogic';

const route = { id: 'r', distanceMeters: 1000, durationSeconds: 600, coordinates: [] as [number, number][], steps: [] };
const dest = { name: 'D', lat: 0, lon: 0 };
const H = 3600_000;
const T = 1_700_000_000_000;
const base = () => startSession('s1', route, dest, T);
const ok = { gpsReliable: true, mapsSufficient: true };

describe('interruptions et règle des 24 h', () => {
  it('T0 = première interruption ; une interruption supplémentaire ne le réinitialise pas (RES-003)', () => {
    let s = interrupt(base(), 'GPS_INDISPONIBLE', T + H);
    const t0 = deadline(s);
    s = interrupt(s, 'APPLICATION_FERMEE', T + 5 * H);
    expect(deadline(s)).toBe(t0);
    expect(s.episodes).toHaveLength(1);
    expect(s.episodes[0].causes).toHaveLength(2);
    expect(t0).toBe(T + H + RESTORE_WINDOW_MS);
  });

  it('expire exactement à T0 + 24 h, pas avant', () => {
    const s = interrupt(base(), 'GPS_INDISPONIBLE', T);
    const before = evaluateRestoration(s, { ...ok, now: T + RESTORE_WINDOW_MS - 1 });
    const at = evaluateRestoration(s, { ...ok, now: T + RESTORE_WINDOW_MS });
    expect(before.decision).toBe('RESUME');
    expect(at.decision).toBe('EXPIRE');
  });

  it('récupération partielle : reste interrompue sans réinitialiser (RES-004/006)', () => {
    const s = interrupt(base(), 'GPS_INDISPONIBLE', T);
    const d = evaluateRestoration(s, { now: T + H, gpsReliable: true, mapsSufficient: false });
    expect(d).toEqual({ decision: 'STAY_INTERRUPTED', missing: ['MAPS'] });
    expect(deadline(s)).toBe(T + RESTORE_WINDOW_MS);
  });

  it('horloge reculée => expiration conservatrice (RES-010)', () => {
    let s = interrupt(base(), 'APPLICATION_FERMEE', T);
    s = { ...s, lastSeenAt: T + 3 * H };
    const d = evaluateRestoration(s, { ...ok, now: T + H });
    expect(d.decision).toBe('EXPIRE_UNCERTAIN');
  });

  it("l'horloge monotone prime sur l'horloge civile quand elle est disponible", () => {
    const s = interrupt(base(), 'SYSTEME_INDISPONIBLE', T);
    const d = evaluateRestoration(s, { ...ok, now: T - 10 * H, monotonicElapsedMs: 2 * H });
    expect(d.decision).toBe('RESUME');
  });

  it('une reprise effective clôt l’épisode ; une nouvelle interruption ouvre un nouveau T0', () => {
    let s = interrupt(base(), 'GPS_INDISPONIBLE', T + H);
    s = resume(s, T + 2 * H);
    expect(s.operationalState).toBe('ACTIVE');
    s = interrupt(s, 'GPS_INDISPONIBLE', T + 3 * H);
    expect(s.episodes).toHaveLength(2);
    expect(deadline(s)).toBe(T + 3 * H + RESTORE_WINDOW_MS);
  });
});

describe('durée effective et résumé', () => {
  it('exclut les périodes d’interruption', () => {
    let s = interrupt(base(), 'GPS_INDISPONIBLE', T + 10 * 60_000);
    s = resume(s, T + 20 * 60_000);
    s = finish(s, 'TERMINEE', T + 50 * 60_000);
    expect(effectiveDurationSeconds(s)).toBe(40 * 60);
  });

  it('session expirée : fin = échéance théorique, résumé sans trace GPS, rétention 30 j', () => {
    let s = interrupt(base(), 'APPLICATION_FERMEE', T + 30 * 60_000);
    s = expire(s, T + 30 * H, false);
    expect(s.endedAt).toBe(T + 30 * 60_000 + RESTORE_WINDOW_MS);
    expect(effectiveDurationSeconds(s)).toBe(30 * 60);
    const sum = buildSummary(s, T + 30 * H);
    expect(sum.finalStatus).toBe('EXPIREE');
    expect(sum.retainUntil).toBe(T + 30 * H + 30 * 24 * H);
    expect(JSON.stringify(sum)).not.toMatch(/coordinates|lat|lon|steps/);
  });

  it('horloge incertaine => durée indisponible (null)', () => {
    let s = interrupt(base(), 'APPLICATION_FERMEE', T);
    s = expire(s, T + H, true);
    expect(effectiveDurationSeconds(s)).toBeNull();
    expect(buildSummary(s, T).effectiveDurationSeconds).toBeNull();
  });
});

import { replaceRoute } from '../src/feature/navigation/session/sessionLogic';

describe('remplacement d’itinéraire (recommandation acceptée)', () => {
  const newRoute = { ...route, id: 'alt', distanceMeters: 2000 };
  it('ne change que l’itinéraire d’une session active', () => {
    const s = replaceRoute(base(), newRoute);
    expect(s.route.id).toBe('alt');
    expect(s.startedAt).toBe(T);
  });
  it('refuse sur une session interrompue ou terminée', () => {
    const interrupted = interrupt(base(), 'GPS_INDISPONIBLE', T);
    expect(replaceRoute(interrupted, newRoute).route.id).toBe('r');
    expect(replaceRoute(finish(base(), 'TERMINEE', T + 1), newRoute).route.id).toBe('r');
  });
});
