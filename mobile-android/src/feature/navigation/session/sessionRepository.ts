import { getDb } from '../../../core/database';
import { SessionRecord, TripSummary } from './types';

const db = getDb;

/** RES-007 : l'état de session est persisté avant toute dépendance réseau (NFR-006). */
export async function saveSession(s: SessionRecord) {
  const d = await db();
  await d.runAsync(
    'INSERT OR REPLACE INTO navigation_sessions (id, status, payload, updated_at) VALUES (?, ?, ?, ?)',
    s.id, s.status, JSON.stringify(s), Date.now(),
  );
}

export async function loadSession(id: string): Promise<SessionRecord | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ payload: string }>('SELECT payload FROM navigation_sessions WHERE id = ?', id);
  return row ? (JSON.parse(row.payload) as SessionRecord) : null;
}

export async function loadActiveSession(): Promise<SessionRecord | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM navigation_sessions WHERE status = 'EN_COURS' ORDER BY updated_at DESC LIMIT 1",
  );
  return row ? (JSON.parse(row.payload) as SessionRecord) : null;
}

export async function deleteSession(id: string) {
  const d = await db();
  await d.runAsync('DELETE FROM navigation_sessions WHERE id = ?', id);
}

/** HIS-004 : une session finie n'est conservée que par son résumé ; l'itinéraire détaillé est supprimé. */
export async function purgeFinishedSessions() {
  const d = await db();
  await d.runAsync("DELETE FROM navigation_sessions WHERE status != 'EN_COURS'");
}

export async function saveSummary(t: TripSummary) {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO trip_summaries
     (id, session_id, started_at, ended_at, final_status, distance_m, effective_duration_s, retain_until, acknowledged)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id, t.sessionId, t.startedAt, t.endedAt, t.finalStatus, t.distanceMeters, t.effectiveDurationSeconds,
    t.retainUntil, t.acknowledged ? 1 : 0,
  );
}

const toSummary = (r: any): TripSummary => ({
  id: r.id, sessionId: r.session_id, startedAt: r.started_at, endedAt: r.ended_at, finalStatus: r.final_status,
  distanceMeters: r.distance_m, effectiveDurationSeconds: r.effective_duration_s, retainUntil: r.retain_until,
  acknowledged: !!r.acknowledged,
});

export async function listSummaries(): Promise<TripSummary[]> {
  const d = await db();
  return (await d.getAllAsync('SELECT * FROM trip_summaries ORDER BY started_at DESC')).map(toSummary);
}

/** HIS-006 : supprime uniquement ce résumé. */
export async function deleteSummary(id: string) {
  const d = await db();
  await d.runAsync('DELETE FROM trip_summaries WHERE id = ?', id);
}

/** HIS-002 : purge des résumés expirés au-delà de 30 jours. */
export async function purgeSummaries(now: number) {
  const d = await db();
  await d.runAsync('DELETE FROM trip_summaries WHERE retain_until IS NOT NULL AND retain_until < ?', now);
}

export async function unacknowledgedExpired(): Promise<TripSummary[]> {
  const d = await db();
  return (await d.getAllAsync("SELECT * FROM trip_summaries WHERE final_status = 'EXPIREE' AND acknowledged = 0")).map(toSummary);
}

export async function acknowledgeExpired() {
  const d = await db();
  await d.runAsync("UPDATE trip_summaries SET acknowledged = 1 WHERE final_status = 'EXPIREE'");
}
