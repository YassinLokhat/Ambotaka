import { api, ObservationPayload } from '../../core/api';
import { getDb } from '../../core/database';
import { pendingDeletions } from '../sync/deletionRepository';
import { ordinarySyncBlocked } from '../sync/syncRules';
import { getConsent, syncConsent } from './consentStore';
import { BATCH_SIZE, isStale, MAX_QUEUE, RawFix, shouldRecord } from './observationLogic';

let lastRecordedAt: number | null = null;
let consentCache: { at: number; granted: boolean } | null = null;

async function consentGranted(): Promise<boolean> {
  if (consentCache && Date.now() - consentCache.at < 5_000) return consentCache.granted;
  const granted = (await getConsent())?.granted === true;
  consentCache = { at: Date.now(), granted };
  return granted;
}
export const invalidateConsentCache = () => { consentCache = null; };

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

/** Appelé pour chaque position FIABLE pendant une navigation active. N'enregistre rien sans consentement. */
export async function recordObservation(fix: RawFix) {
  if (!shouldRecord(fix, await consentGranted(), lastRecordedAt)) return;
  lastRecordedAt = fix.timestamp;
  const d = await getDb();
  await d.runAsync(
    'INSERT OR IGNORE INTO observation_queue (client_obs_id, observed_at, lat, lon, accuracy, speed_mps, heading) VALUES (?,?,?,?,?,?,?)',
    uuid(), fix.timestamp, fix.lat, fix.lon, fix.accuracy!, fix.speed!, fix.heading != null && fix.heading >= 0 ? fix.heading : null);
  await d.runAsync(
    'DELETE FROM observation_queue WHERE client_obs_id IN (SELECT client_obs_id FROM observation_queue ORDER BY observed_at DESC LIMIT -1 OFFSET ?)',
    MAX_QUEUE);
}

/** Envoie la file par lots. Les observations sont retirées dès que le serveur a répondu (acceptées, doublons OU rejetées). */
export async function flushObservations(): Promise<void> {
  const d = await getDb();
  if ((await getConsent())?.granted !== true) { await d.runAsync('DELETE FROM observation_queue'); return; } // TRF-010
  if (ordinarySyncBlocked(await pendingDeletions(), 'GPS_OBSERVATIONS')) return; // PRI-009 : suppression en attente
  await d.runAsync('DELETE FROM observation_queue WHERE observed_at < ?', Date.now() - 600_000);
  for (;;) {
    const rows = await d.getAllAsync<any>('SELECT * FROM observation_queue ORDER BY observed_at LIMIT ?', BATCH_SIZE);
    if (!rows.length) return;
    const batch: ObservationPayload[] = rows.filter((r) => !isStale(r.observed_at, Date.now())).map((r) => ({
      clientObsId: r.client_obs_id, observedAt: new Date(r.observed_at).toISOString(), lat: r.lat, lon: r.lon,
      accuracyMeters: r.accuracy, speedMps: r.speed_mps, ...(r.heading != null ? { headingDeg: r.heading } : {}),
    }));
    try {
      if (batch.length) await api.postObservations(batch);
    } catch (e: any) {
      if (e.code === 'CONSENT_REQUIRED') await syncConsent(); // le serveur n'a pas (encore) la décision locale
      return; // réseau ou refus : on conserve la file, nouvelle tentative plus tard
    }
    const marks = rows.map(() => '?').join(',');
    await d.runAsync(`DELETE FROM observation_queue WHERE client_obs_id IN (${marks})`, ...rows.map((r) => r.client_obs_id));
  }
}
