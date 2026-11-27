import { CLOCK_TOLERANCE_MS, RESTORE_WINDOW_MS, SUMMARY_RETENTION_MS } from './constants';
import {
  Destination, InterruptionCause, InterruptionEpisode, RestorationDecision, RouteSnapshot, SessionRecord,
  TripSummary,
} from './types';

/** Fonctions pures : aucune horloge ni I/O ; `now` est toujours injecté (testable autour des 24 h). */

export function startSession(id: string, route: RouteSnapshot, destination: Destination, now: number): SessionRecord {
  return {
    id, status: 'EN_COURS', operationalState: 'ACTIVE', route, destination, startedAt: now, endedAt: null,
    episodes: [], lastSeenAt: now, lastKnownPosition: null, distanceTraveledMeters: 0,
    clockUncertain: false, expiredDetectedAt: null,
  };
}

export const openEpisode = (s: SessionRecord): InterruptionEpisode | null => {
  const e = s.episodes[s.episodes.length - 1];
  return e && e.resumedAt === null ? e : null;
};

/** Échéance théorique = T0 + 24 h (RES-009). */
export const deadline = (s: SessionRecord): number | null => {
  const e = openEpisode(s);
  return e ? e.startedAt + RESTORE_WINDOW_MS : null;
};

/** RES-001/003 : une interruption supplémentaire n'écrase jamais T0. */
export function interrupt(s: SessionRecord, cause: InterruptionCause, now: number, at = now): SessionRecord {
  if (s.status !== 'EN_COURS') return s;
  const open = openEpisode(s);
  if (open) {
    const known = open.causes.some((c) => c.cause === cause);
    const episodes = s.episodes.slice(0, -1).concat({
      ...open, causes: known ? open.causes : [...open.causes, { cause, at: now }],
    });
    return { ...s, episodes, operationalState: 'INTERROMPUE' };
  }
  const episode: InterruptionEpisode = { startedAt: at, resumedAt: null, causes: [{ cause, at: now }] };
  return { ...s, episodes: [...s.episodes, episode], operationalState: 'INTERROMPUE' };
}

export interface RestorationContext {
  now: number;
  gpsReliable: boolean;
  mapsSufficient: boolean;
  /** Temps écoulé depuis T0 mesuré par une horloge monotone, si disponible (perdu après redémarrage). */
  monotonicElapsedMs?: number | null;
}

/** RES-004..RES-010 : décide du sort d'une session interrompue. */
export function evaluateRestoration(s: SessionRecord, ctx: RestorationContext): RestorationDecision {
  const ep = openEpisode(s);
  if (!ep) return { decision: 'RESUME' };

  let elapsed: number;
  if (ctx.monotonicElapsedMs != null) {
    elapsed = ctx.monotonicElapsedMs;
  } else {
    elapsed = ctx.now - ep.startedAt;
    const clockWentBack = elapsed < 0 || ctx.now < s.lastSeenAt - CLOCK_TOLERANCE_MS;
    if (clockWentBack) {
      return { decision: 'EXPIRE_UNCERTAIN', reason: 'Horloge incohérente : durée écoulée indéterminable.' };
    }
  }
  if (elapsed >= RESTORE_WINDOW_MS) return { decision: 'EXPIRE', reason: 'Délai de 24 h dépassé.' };

  const missing: ('GPS' | 'MAPS')[] = [];
  if (!ctx.gpsReliable) missing.push('GPS');
  if (!ctx.mapsSufficient) missing.push('MAPS');
  return missing.length ? { decision: 'STAY_INTERRUPTED', missing } : { decision: 'RESUME' };
}

/** Seule une reprise effective clôt l'épisode et rétablit l'état actif. */
export function resume(s: SessionRecord, now: number): SessionRecord {
  const open = openEpisode(s);
  if (!open || s.status !== 'EN_COURS') return s;
  const episodes = s.episodes.slice(0, -1).concat({ ...open, resumedAt: now });
  return { ...s, episodes, operationalState: 'ACTIVE', lastSeenAt: now };
}

/** Expiration : date de fin = échéance théorique, sauf horloge incertaine (null). */
export function expire(s: SessionRecord, now: number, uncertain: boolean): SessionRecord {
  const dl = deadline(s);
  return {
    ...s, status: 'EXPIREE', operationalState: 'INTERROMPUE',
    endedAt: uncertain || dl === null ? null : dl,
    expiredDetectedAt: now, clockUncertain: uncertain,
  };
}

export function finish(s: SessionRecord, status: 'TERMINEE' | 'ANNULEE', now: number): SessionRecord {
  const open = openEpisode(s);
  const episodes = open ? s.episodes.slice(0, -1).concat({ ...open, resumedAt: now }) : s.episodes;
  return { ...s, status, episodes, endedAt: now, operationalState: 'ACTIVE' };
}

/** Durée effective = durée totale − périodes d'interruption ; null si non calculable (§8.2). */
export function effectiveDurationSeconds(s: SessionRecord): number | null {
  if (s.clockUncertain || s.endedAt === null) return null;
  const total = s.endedAt - s.startedAt;
  if (total < 0) return null;
  let paused = 0;
  for (const e of s.episodes) {
    const end = e.resumedAt ?? s.endedAt;
    const d = end - e.startedAt;
    if (d < 0) return null;
    paused += d;
  }
  const eff = total - paused;
  return eff < 0 ? null : Math.round(eff / 1000);
}

export function buildSummary(s: SessionRecord, now: number): TripSummary {
  return {
    id: `sum-${s.id}`, sessionId: s.id, startedAt: s.startedAt, endedAt: s.endedAt,
    finalStatus: s.status,
    distanceMeters: s.distanceTraveledMeters > 0 ? Math.round(s.distanceTraveledMeters) : null,
    effectiveDurationSeconds: effectiveDurationSeconds(s),
    retainUntil: s.status === 'EXPIREE' ? now + SUMMARY_RETENTION_MS : null,
    acknowledged: s.status !== 'EXPIREE',
  };
}

/** Acceptation d'une recommandation : seul l'itinéraire suivi change (REC-008), jamais l'historique d'interruptions. */
export function replaceRoute(s: SessionRecord, route: RouteSnapshot): SessionRecord {
  if (s.status !== 'EN_COURS' || s.operationalState !== 'ACTIVE') return s;
  return { ...s, route };
}
