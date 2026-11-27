/** Règles pures de synchronisation (testables) : backoff, priorité et exclusion des suppressions. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 60 * 60 * 1000;
export const BLOCKED_AFTER_MS = 6 * 60 * 60 * 1000;  // seuil opérationnel configurable (spec §11.3)
export const REPORT_MAX_AGE_MS = 10 * 60 * 1000;     // au-delà, le serveur rejette le signalement

export type DeletionKind = 'GPS_OBSERVATIONS' | 'INCIDENT_CONTRIBUTIONS' | 'RECOMMENDATIONS' | 'ALL';
export type LocalDeletionStatus = 'EN_ATTENTE' | 'EN_TRANSMISSION' | 'EN_ECHEC_TEMPORAIRE' | 'CONFIRMEE';

export interface PendingDeletion {
  id: string; types: DeletionKind[]; status: LocalDeletionStatus;
  createdAt: number; attempts: number; nextAttemptAt: number;
}

/** Backoff exponentiel plafonné avec gigue ±20 % pour désynchroniser les appareils (PRI-008). */
export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
  const n = Math.max(1, attempt);
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
  return Math.min(BACKOFF_CAP_MS, Math.round(raw * (0.8 + 0.4 * rand())));
}

export const isPending = (d: PendingDeletion) => d.status !== 'CONFIRMEE';
export const coversKind = (types: DeletionKind[], kind: 'GPS_OBSERVATIONS' | 'INCIDENT_CONTRIBUTIONS') =>
  types.includes('ALL') || types.includes(kind);

/** Une demande est à envoyer si elle n'est pas confirmée, pas déjà en cours d'envoi et que son délai est écoulé. */
export const isDue = (d: PendingDeletion, now: number) =>
  isPending(d) && d.status !== 'EN_TRANSMISSION' && d.nextAttemptAt <= now;

/** Aucune demande n'est jamais abandonnée : elle devient « bloquée » (alerte) mais continue d'être rejouée. */
export const isBlocked = (d: PendingDeletion, now: number) => isPending(d) && now - d.createdAt >= BLOCKED_AFTER_MS;

/** PRI-009 / TRF-010 : tant qu'une suppression couvrant ce type n'est pas confirmée, on ne retransmet rien de ce type. */
export const ordinarySyncBlocked = (deletions: PendingDeletion[], kind: 'GPS_OBSERVATIONS' | 'INCIDENT_CONTRIBUTIONS') =>
  deletions.some((d) => isPending(d) && coversKind(d.types, kind));

/** Erreur définitive pour un signalement en file (inutile de rejouer) ; réseau, 408, 429 et 5xx sont temporaires. */
export const isPermanentSendError = (httpStatus: number) =>
  httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;
