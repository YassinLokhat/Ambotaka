import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, Recommendation } from '../../core/api';
import { Guidance, remainingCoordinates } from '../navigation/session/geometry';
import { RouteSnapshot, SessionRecord } from '../navigation/session/types';

const FIRST_EVAL_MS = 20_000;
const EVAL_EVERY_MS = 60_000;
const MIN_REMAINING_M = 1_000; // inutile de proposer un détour sur la fin du trajet

/** Interroge périodiquement le serveur pendant une navigation ACTIVE ; n'affiche que ce que le serveur recommande. */
export function useRecommendation(
  session: SessionRecord | null, user: { lat: number; lon: number } | null, guidance: Guidance | null,
  applyRoute: (r: RouteSnapshot) => Promise<void>,
) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ session, user, guidance, rec });
  live.current = { session, user, guidance, rec };
  const active = session?.status === 'EN_COURS' && session.operationalState === 'ACTIVE';

  const evaluate = useCallback(async () => {
    const { session: s, user: u, guidance: g, rec: current } = live.current;
    if (!s || !u || !g || current || g.remainingMeters < MIN_REMAINING_M) return;
    try {
      const r = await api.evaluateRecommendation({
        sessionId: s.id, position: u, destination: { lat: s.destination.lat, lon: s.destination.lon },
        currentRoute: remainingCoordinates(s.route.coordinates, [u.lon, u.lat]),
      });
      if (r.recommendation && r.recommendation.decision === 'EN_ATTENTE') setRec(r.recommendation);
    } catch { /* hors ligne ou limite : on réessaiera au prochain cycle */ }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(evaluate, FIRST_EVAL_MS);
    const t = setInterval(evaluate, EVAL_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [active, evaluate]);

  // REC-007 : une recommandation périmée disparaît et ne peut plus être acceptée.
  useEffect(() => {
    if (!rec) return;
    const ms = new Date(rec.expiresAt).getTime() - Date.now();
    const t = setTimeout(() => setRec(null), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [rec]);

  const decide = useCallback(async (decision: 'ACCEPTEE' | 'IGNOREE') => {
    const r = live.current.rec;
    if (!r) return;
    setError(null);
    try {
      await api.decideRecommendation(r.id, decision);
      if (decision === 'ACCEPTEE') {
        await applyRoute({
          id: r.proposedRoute.id, distanceMeters: r.proposedRoute.distanceMeters,
          durationSeconds: r.proposedRoute.durationSeconds, coordinates: r.proposedRoute.geometry.coordinates,
          steps: r.proposedRoute.steps,
        });
      }
      setRec(null);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'RECOMMENDATION_EXPIRED' || e.code === 'ALREADY_DECIDED')) { setRec(null); }
      setError(e instanceof ApiError ? e.message : 'Action impossible pour le moment.');
    }
  }, [applyRoute]);

  return { rec, error, accept: () => decide('ACCEPTEE'), ignore: () => decide('IGNOREE') };
}
