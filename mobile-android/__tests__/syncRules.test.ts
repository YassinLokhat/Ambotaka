import {
  BACKOFF_BASE_MS, BACKOFF_CAP_MS, backoffDelayMs, BLOCKED_AFTER_MS, isBlocked, isDue, isPermanentSendError,
  ordinarySyncBlocked, PendingDeletion,
} from '../src/feature/sync/syncRules';

const del = (over: Partial<PendingDeletion> = {}): PendingDeletion => ({
  id: 'd', types: ['GPS_OBSERVATIONS'], status: 'EN_ATTENTE', createdAt: 0, attempts: 0, nextAttemptAt: 0, ...over,
});

describe('backoff exponentiel (PRI-008)', () => {
  it('double à chaque tentative sans gigue, plafonné', () => {
    const mid = () => 0.5; // facteur 1.0
    expect(backoffDelayMs(1, mid)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(2, mid)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(4, mid)).toBe(BACKOFF_BASE_MS * 8);
    expect(backoffDelayMs(50, mid)).toBe(BACKOFF_CAP_MS);
    expect(backoffDelayMs(50, () => 1)).toBe(BACKOFF_CAP_MS); // la gigue ne dépasse jamais le plafond
  });
  it('gigue bornée à ±20 %', () => {
    expect(backoffDelayMs(3, () => 0)).toBe(Math.round(BACKOFF_BASE_MS * 4 * 0.8));
    expect(backoffDelayMs(3, () => 1)).toBe(Math.round(BACKOFF_BASE_MS * 4 * 1.2));
  });
});

describe('suppressions : priorité, exclusion, blocage', () => {
  it('une demande non confirmée exclut la synchronisation ordinaire du type concerné (PRI-009)', () => {
    const p = [del()];
    expect(ordinarySyncBlocked(p, 'GPS_OBSERVATIONS')).toBe(true);
    expect(ordinarySyncBlocked(p, 'INCIDENT_CONTRIBUTIONS')).toBe(false);
    expect(ordinarySyncBlocked([del({ types: ['ALL'] })], 'INCIDENT_CONTRIBUTIONS')).toBe(true);
    expect(ordinarySyncBlocked([del({ status: 'CONFIRMEE' })], 'GPS_OBSERVATIONS')).toBe(false);
  });
  it('une demande est éligible quand son délai est écoulé et qu’elle n’est pas déjà en transmission', () => {
    expect(isDue(del({ nextAttemptAt: 100 }), 99)).toBe(false);
    expect(isDue(del({ nextAttemptAt: 100 }), 100)).toBe(true);
    expect(isDue(del({ status: 'EN_TRANSMISSION' }), 1000)).toBe(false);
    expect(isDue(del({ status: 'CONFIRMEE' }), 1000)).toBe(false);
  });
  it('« bloquée » après le seuil mais jamais abandonnée', () => {
    const d = del({ status: 'EN_ECHEC_TEMPORAIRE', attempts: 99 });
    expect(isBlocked(d, BLOCKED_AFTER_MS - 1)).toBe(false);
    expect(isBlocked(d, BLOCKED_AFTER_MS)).toBe(true);
    expect(isDue({ ...d, nextAttemptAt: 0 }, BLOCKED_AFTER_MS * 10)).toBe(true); // toujours rejouée
    expect(isBlocked(del({ status: 'CONFIRMEE' }), BLOCKED_AFTER_MS * 2)).toBe(false);
  });
  it('erreurs d’envoi définitives vs temporaires', () => {
    expect(isPermanentSendError(422)).toBe(true);
    expect(isPermanentSendError(400)).toBe(true);
    expect(isPermanentSendError(429)).toBe(false);
    expect(isPermanentSendError(408)).toBe(false);
    expect(isPermanentSendError(503)).toBe(false);
    expect(isPermanentSendError(0)).toBe(false); // réseau
  });
});
