import { api } from '../../core/api';
import { POLICY_VERSION } from '../../core/config';
import { getDb } from '../../core/database';

export interface LocalConsent { granted: boolean; policyVersion: string; decidedAt: number; serverSynced: boolean }
const KEY = 'stats.consent';

export async function getConsent(): Promise<LocalConsent | null> {
  const row = await (await getDb()).getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  return row ? (JSON.parse(row.value) as LocalConsent) : null;
}

async function put(c: LocalConsent) {
  await (await getDb()).runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY, JSON.stringify(c));
}

/** Pousse la décision au serveur ; reste « non synchronisée » (donc rejouée) tant que le serveur n'a pas confirmé. */
export async function syncConsent(): Promise<void> {
  const c = await getConsent();
  if (!c || c.serverSynced) return;
  try {
    await api.setStatisticsConsent(c.granted, c.policyVersion);
    await put({ ...c, serverSynced: true });
  } catch { /* hors ligne : nouvelle tentative à la prochaine ouverture / action */ }
}

/** PRI-001..004 : décision locale immédiate ; le retrait vide aussi la file locale d'observations. */
export async function setStatisticsConsent(granted: boolean): Promise<void> {
  await put({ granted, policyVersion: POLICY_VERSION, decidedAt: Date.now(), serverSynced: false });
  if (!granted) await (await getDb()).runAsync('DELETE FROM observation_queue');
  await syncConsent();
}
