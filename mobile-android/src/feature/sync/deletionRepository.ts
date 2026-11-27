import { getDb } from '../../core/database';
import { DeletionKind, LocalDeletionStatus, PendingDeletion } from './syncRules';

export interface LocalDeletion extends PendingDeletion {
  idempotencyKey: string; confirmedAt: number | null; serverId: string | null; lastError: string | null; blockedNotified: boolean;
}

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

const map = (r: any): LocalDeletion => ({
  id: r.id, idempotencyKey: r.idempotency_key, types: JSON.parse(r.types), status: r.status, attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at, createdAt: r.created_at, confirmedAt: r.confirmed_at, serverId: r.server_id,
  lastError: r.last_error, blockedNotified: !!r.blocked_notified,
});

/** PRI-005 : identifiant et clé d'idempotence uniques ; PRI-007 : persistée jusqu'à confirmation explicite du serveur. */
export async function createDeletion(types: DeletionKind[]): Promise<LocalDeletion> {
  const d = await getDb();
  const now = Date.now();
  const id = uuid(), key = uuid();
  await d.runAsync(
    `INSERT INTO deletion_requests (id, idempotency_key, types, status, next_attempt_at, created_at) VALUES (?,?,?,?,?,?)`,
    id, key, JSON.stringify(types), 'EN_ATTENTE', now, now);
  return (await listDeletions()).find((x) => x.id === id)!;
}

export async function listDeletions(): Promise<LocalDeletion[]> {
  const d = await getDb();
  return (await d.getAllAsync('SELECT * FROM deletion_requests ORDER BY created_at DESC LIMIT 50')).map(map);
}

export const pendingDeletions = async () => (await listDeletions()).filter((x) => x.status !== 'CONFIRMEE');

export async function markTransmitting(id: string) {
  await (await getDb()).runAsync("UPDATE deletion_requests SET status='EN_TRANSMISSION' WHERE id=?", id);
}
export async function markFailed(id: string, error: string, nextAttemptAt: number, attempts: number) {
  await (await getDb()).runAsync(
    "UPDATE deletion_requests SET status='EN_ECHEC_TEMPORAIRE', last_error=?, next_attempt_at=?, attempts=? WHERE id=?",
    error, nextAttemptAt, attempts, id);
}
export async function markConfirmed(id: string, serverId: string) {
  await (await getDb()).runAsync(
    "UPDATE deletion_requests SET status='CONFIRMEE', confirmed_at=?, server_id=?, last_error=NULL WHERE id=?", Date.now(), serverId, id);
}
export async function markBlockedNotified(id: string) {
  await (await getDb()).runAsync('UPDATE deletion_requests SET blocked_notified=1 WHERE id=?', id);
}
/** Action utilisateur « Réessayer » : rend la demande immédiatement éligible. */
export async function retryNow(id: string) {
  await (await getDb()).runAsync("UPDATE deletion_requests SET status='EN_ATTENTE', next_attempt_at=? WHERE id=? AND status!='CONFIRMEE'", Date.now(), id);
}
/** Au démarrage : une demande restée « en transmission » (app tuée) est rejouée ; la clé d'idempotence rend cela sûr. */
export async function recoverInterrupted() {
  await (await getDb()).runAsync(
    "UPDATE deletion_requests SET status='EN_ECHEC_TEMPORAIRE', next_attempt_at=? WHERE status='EN_TRANSMISSION'", Date.now());
}
export type { LocalDeletionStatus };
