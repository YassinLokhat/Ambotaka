/** Règles pures de collecte (testables). Seuils alignés sur les paramètres serveur par défaut. */
export const MIN_INTERVAL_MS = 5_000;       // 1 observation / 5 s
export const MAX_AGE_MS = 600_000;          // le serveur rejette au-delà : inutile de les garder
export const MAX_ACCURACY_M = 30;
export const MAX_QUEUE = 500;
export const BATCH_SIZE = 100;

export interface RawFix { lat: number; lon: number; accuracy: number | null; speed: number | null; heading: number | null; timestamp: number }

export function shouldRecord(
  fix: RawFix, consentGranted: boolean, lastRecordedAt: number | null,
): boolean {
  if (!consentGranted) return false;                                      // TRF-004
  if (fix.accuracy === null || fix.accuracy > MAX_ACCURACY_M) return false;
  if (fix.speed === null || fix.speed < 0) return false;                  // vitesse invalide (Android renvoie -1/null)
  return lastRecordedAt === null || fix.timestamp - lastRecordedAt >= MIN_INTERVAL_MS;
}

export const isStale = (observedAt: number, now: number) => now - observedAt > MAX_AGE_MS;
