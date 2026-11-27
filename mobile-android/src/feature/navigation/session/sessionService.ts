import { API_URL } from '../../../core/config';
import { RouteOption } from '../../../core/api';
import {
  acknowledgeExpired, deleteSession, loadActiveSession, purgeFinishedSessions, purgeSummaries, saveSession, saveSummary,
  unacknowledgedExpired,
} from './sessionRepository';
import { buildSummary, evaluateRestoration, expire, finish, startSession } from './sessionLogic';
import { Destination, SessionRecord } from './types';
import { syncConsent } from '../../traffic/consentStore';

const newId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Écrit le résumé minimal ; l'itinéraire détaillé est purgé au prochain démarrage (purgeFinishedSessions). */
export async function finalize(s: SessionRecord): Promise<SessionRecord> {
  await saveSummary(buildSummary(s, Date.now()));
  await saveSession(s); // état final conservé jusqu'à l'affichage du résumé
  return s;
}

/** NAV-008 : la session n'existe qu'à partir de cet appel explicite (bouton Démarrer). */
export async function startNavigation(route: RouteOption, destination: Destination): Promise<SessionRecord> {
  const previous = await loadActiveSession();
  if (previous) await finalize(finish(previous, 'ANNULEE', Date.now())); // remplacée volontairement
  const s = startSession(newId(), {
    id: route.id, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds,
    coordinates: route.geometry.coordinates, steps: route.steps ?? [],
  }, destination, Date.now());
  await saveSession(s);
  return s;
}

/** Applique l'expiration si l'échéance est dépassée (appel à l'ouverture de l'app, RES-009/011). */
export async function expireIfDue(s: SessionRecord): Promise<SessionRecord> {
  if (s.status !== 'EN_COURS') return s;
  const d = evaluateRestoration(s, { now: Date.now(), gpsReliable: true, mapsSufficient: true });
  if (d.decision === 'EXPIRE' || d.decision === 'EXPIRE_UNCERTAIN') {
    return finalize(expire(s, Date.now(), d.decision === 'EXPIRE_UNCERTAIN'));
  }
  return s;
}

export async function startupHousekeeping() {
  syncConsent().catch(() => undefined); // rejoue une décision de consentement non confirmée par le serveur
  await purgeSummaries(Date.now());
  await purgeFinishedSessions();
  const active = await loadActiveSession();
  const current = active ? await expireIfDue(active) : null;
  const notices = await unacknowledgedExpired(); // RES-013 : notification groupée
  return { active: current && current.status === 'EN_COURS' ? current : null, expiredNotices: notices.length };
}

export { acknowledgeExpired, deleteSession };

/** Connectivité réelle : ping de l'API (évite une dépendance NetInfo). */
export async function checkOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(4000) });
    return res.status === 200 || res.status === 503; // le serveur répond => le réseau fonctionne
  } catch {
    return false;
  }
}

/** Cartes hors ligne non validées (spec §3.2) : aucune carte locale n'est considérée suffisante. */
export const hasSufficientLocalMaps = () => false;
