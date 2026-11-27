// Seuils centralisés et configurables (spec §6.3 : pas de constantes dispersées).
export const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;      // RES-002
export const SUMMARY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // HIS-002
export const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;           // RES-010
export const NAV_MAX_ACCURACY_M = 50;                      // NAV-003 / NAV-011
export const FIX_MAX_AGE_MS = 10_000;
export const NO_FIX_TIMEOUT_MS = 20_000;                   // => GPS_INDISPONIBLE
export const HEARTBEAT_MS = 10_000;
export const BACKGROUND_GAP_MS = 60_000;                   // écart => app considérée interrompue
export const ARRIVAL_M = 30;
export const OFF_ROUTE_M = 60;
export const RETRY_RESTORE_MS = 15_000;
