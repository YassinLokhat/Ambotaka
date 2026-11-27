export type SessionStatus = 'EN_COURS' | 'TERMINEE' | 'ANNULEE' | 'EXPIREE';
export type OperationalState = 'ACTIVE' | 'INTERROMPUE' | 'RESTAURATION_EN_ATTENTE';
export type InterruptionCause =
  | 'GPS_INDISPONIBLE' | 'RESEAU_INDISPONIBLE' | 'DONNEES_CARTOGRAPHIQUES_INDISPONIBLES'
  | 'APPLICATION_FERMEE' | 'SYSTEME_INDISPONIBLE';

export interface RouteStep { instruction: string; distanceMeters: number; location: [number, number] }
export interface RouteSnapshot {
  id: string; distanceMeters: number; durationSeconds: number;
  coordinates: [number, number][]; steps: RouteStep[];
}
export interface Destination { name: string; lat: number; lon: number }

/** Un épisode = une période d'interruption. Sa date de début est T0 (RES-002/003). */
export interface InterruptionEpisode {
  startedAt: number; resumedAt: number | null;
  causes: { cause: InterruptionCause; at: number }[];
}

export interface SessionRecord {
  id: string;
  status: SessionStatus;
  operationalState: OperationalState;
  route: RouteSnapshot;
  destination: Destination;
  startedAt: number;
  endedAt: number | null;
  episodes: InterruptionEpisode[];
  lastSeenAt: number;
  lastKnownPosition: { lat: number; lon: number; at: number } | null;
  distanceTraveledMeters: number;
  clockUncertain: boolean;
  expiredDetectedAt: number | null;
}

export interface TripSummary {
  id: string; sessionId: string;
  startedAt: number; endedAt: number | null;
  finalStatus: SessionStatus;
  distanceMeters: number | null;
  effectiveDurationSeconds: number | null; // null => « indisponible » (HIS-005)
  retainUntil: number | null;
  acknowledged: boolean;
  // Volontairement : aucune trace GPS, aucun itinéraire détaillé (HIS-004).
}

export type RestorationDecision =
  | { decision: 'EXPIRE'; reason: string }
  | { decision: 'EXPIRE_UNCERTAIN'; reason: string }
  | { decision: 'RESUME' }
  | { decision: 'STAY_INTERRUPTED'; missing: ('GPS' | 'MAPS')[] };
