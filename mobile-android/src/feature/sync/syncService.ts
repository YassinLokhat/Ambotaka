import { api, ApiError } from '../../core/api';
import { getDb } from '../../core/database';
import { getConsent, setStatisticsConsent, syncConsent } from '../traffic/consentStore';
import { flushObservations, invalidateConsentCache } from '../traffic/observationCollector';
import { checkOnline } from '../navigation/session/sessionService';
import {
  createDeletion, listDeletions, markBlockedNotified, markConfirmed, markFailed, markTransmitting, pendingDeletions,
} from './deletionRepository';
import { ensureNotificationPermission, NOTIFICATION_TEXTS, notifyLocal } from './notifications';
import { clearReports, countReports, deleteReport, listDueReports, markReportFailed } from './reportQueue';
import {
  backoffDelayMs, coversKind, DeletionKind, isBlocked, isDue, isPermanentSendError, ordinarySyncBlocked, REPORT_MAX_AGE_MS,
} from './syncRules';

let running = false;

/** Travail en attente ? (évite un ping réseau inutile quand tout est à jour) */
export async function hasPendingWork(): Promise<boolean> {
  const now = Date.now();
  if ((await listDeletions()).some((d) => isDue(d, now))) return true;
  if ((await listDueReports(now)).length) return true;
  const c = await getConsent();
  if (c && !c.serverSynced) return true;
  const d = await getDb();
  const obs = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM observation_queue');
  return (obs?.n ?? 0) > 0;
}

async function sendDeletions(): Promise<boolean> {
  let did = false;
  for (const dl of await listDeletions()) {
    if (!isDue(dl, Date.now())) continue;
    did = true;
    await markTransmitting(dl.id);
    try {
      const r = await api.createDeletionRequest(dl.idempotencyKey, dl.types);
      // NFR-008 : « terminée » uniquement sur confirmation explicite du serveur.
      if (r.request.status !== 'CONFIRMEE') throw new ApiError('NOT_CONFIRMED', 'Suppression non confirmée', 0);
      await markConfirmed(dl.id, r.request.id);
      await notifyLocal(NOTIFICATION_TEXTS.deletionDone);
    } catch (e) {
      const attempts = dl.attempts + 1;
      await markFailed(dl.id, e instanceof ApiError ? e.code : 'ERROR', Date.now() + backoffDelayMs(attempts), attempts);
    }
  }
  // Blocage persistant : alerte une seule fois, la demande continue d'être rejouée (jamais abandonnée).
  for (const dl of await listDeletions()) {
    if (isBlocked(dl, Date.now()) && !dl.blockedNotified) {
      await markBlockedNotified(dl.id);
      await notifyLocal(NOTIFICATION_TEXTS.deletionBlocked);
    }
  }
  return did;
}

async function sendReports(): Promise<boolean> {
  let did = false;
  for (const r of await listDueReports(Date.now())) {
    // Une suppression créée pendant l'envoi prime : on s'arrête immédiatement.
    if (ordinarySyncBlocked(await pendingDeletions(), 'INCIDENT_CONTRIBUTIONS')) return did;
    did = true;
    if (Date.now() - r.observedAt > REPORT_MAX_AGE_MS) { await deleteReport(r.clientReportId); continue; } // périmé
    try {
      await api.createReport({
        type: r.type, description: r.description ?? undefined, lat: r.lat, lon: r.lon,
        clientReportId: r.clientReportId, observedAt: new Date(r.observedAt).toISOString(),
      });
      await deleteReport(r.clientReportId);
    } catch (e) {
      if (e instanceof ApiError && isPermanentSendError(e.status)) await deleteReport(r.clientReportId);
      else { const a = r.attempts + 1; await markReportFailed(r.clientReportId, a, Date.now() + backoffDelayMs(a)); }
    }
  }
  return did;
}

/**
 * Ordre de la spec §11.2 : réseau -> suppressions en priorité -> confirmations -> exclusion des données en cours
 * de suppression -> envoi ordinaire -> replanification. Appelée à l'ouverture, au retour au premier plan,
 * périodiquement en premier plan, après une action utilisateur et par la tâche d'arrière-plan.
 */
export async function syncNow(): Promise<{ didWork: boolean; online: boolean }> {
  if (running) return { didWork: false, online: true };
  running = true;
  try {
    if (!(await hasPendingWork())) return { didWork: false, online: true };
    if (!(await checkOnline())) return { didWork: false, online: false };
    let didWork = await sendDeletions();
    const pending = await pendingDeletions();
    await syncConsent();
    if (!ordinarySyncBlocked(pending, 'INCIDENT_CONTRIBUTIONS')) didWork = (await sendReports()) || didWork;
    if (!ordinarySyncBlocked(pending, 'GPS_OBSERVATIONS')) await flushObservations();
    return { didWork, online: true };
  } finally {
    running = false;
  }
}

/** Crée la demande, neutralise immédiatement les données locales concernées, puis tente l'envoi. */
export async function requestDeletion(types: DeletionKind[]) {
  const rec = await createDeletion(types);
  const d = await getDb();
  if (coversKind(types, 'GPS_OBSERVATIONS')) await d.runAsync('DELETE FROM observation_queue');
  if (coversKind(types, 'INCIDENT_CONTRIBUTIONS')) await clearReports();
  if (types.includes('ALL')) { await setStatisticsConsent(false); invalidateConsentCache(); } // tout supprimer = ne plus contribuer
  await ensureNotificationPermission();
  syncNow().catch(() => undefined);
  return rec;
}

export { countReports };
