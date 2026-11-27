import { API_URL } from './config';
import { getInstallationId } from './installation';

const API_REQUEST_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Installation-Id': await getInstallationId(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Impossible de joindre le serveur. Vérifiez votre connexion.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.code ?? 'ERROR', body.message ?? 'Erreur inattendue.', res.status);
  return body as T;
}

export interface Place { id: string; name: string; address: string; lat: number; lon: number }
export interface RouteOption {
  id: string; distanceMeters: number; durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  estimationSource: 'TRAFIC_RECENT' | 'DUREE_REFERENCE';
  steps?: { instruction: string; distanceMeters: number; location: [number, number] }[];
}

export type IncidentType = 'ACCIDENT' | 'EMBOUTEILLAGE' | 'ROUTE_BLOQUEE' | 'TRAVAUX' | 'DANGER' | 'AUTRE';
export type IncidentStatus = 'DETECTE' | 'CONFIRME' | 'EN_COURS' | 'RESOLU' | 'EXPIRE';
export interface Incident {
  id: string; type: IncidentType; description: string | null; status: IncidentStatus;
  latitude: number; longitude: number; confidence: number;
  reporterCount: number; confirmationCount: number; contestationCount: number;
  startedAt: string; expiresAt: string; updatedAt: string; distanceMeters?: number;
  myResponse?: null | 'REPORTER' | 'CONFIRMATION' | 'CONTESTATION';
}

export interface TrafficSegment {
  segmentId: string; direction: number; name: string | null;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  state: 'FLUIDE' | 'RALENTI' | 'CONGESTIONNE' | 'INCONNU'; meanSpeedKph: number; sampleCount: number;
  confidence: number; source: string; observedAt: string; computedAt: string; validUntil: string;
}
export interface ObservationPayload {
  clientObsId: string; observedAt: string; lat: number; lon: number;
  accuracyMeters: number; speedMps: number; headingDeg?: number;
}

export interface Recommendation {
  id: string; sessionId: string; createdAt: string; expiresAt: string;
  decision: 'EN_ATTENTE' | 'ACCEPTEE' | 'IGNOREE' | 'EXPIREE';
  gainSeconds: number; confidence: number; motif: string;
  reasons: { kind: 'TRAFFIC' | 'INCIDENT'; label: string; delaySeconds: number }[];
  estimationSource: string;
  currentRoute: { durationSeconds: number; adjustedDurationSeconds: number };
  proposedRoute: {
    id: string; distanceMeters: number; durationSeconds: number; adjustedDurationSeconds: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    steps: { instruction: string; distanceMeters: number; location: [number, number] }[];
  };
}

export interface DeletionRequestView {
  id: string; status: 'EN_COURS' | 'CONFIRMEE' | 'ECHEC'; types: string[];
  items: { type: string; status: string; deletedCount: number }[]; createdAt: string; completedAt: string | null;
}

export const api = {
  createDeletionRequest: (idempotencyKey: string, types: string[]) =>
    request<{ request: DeletionRequestView }>('/deletion-requests', { method: 'POST', body: JSON.stringify({ idempotencyKey, types }) }),
  evaluateRecommendation: (b: {
    sessionId: string; position: { lat: number; lon: number }; destination: { lat: number; lon: number };
    currentRoute: [number, number][];
  }) => request<{ recommendation: Recommendation | null; reason: string | null }>(
    '/recommendations/evaluate', { method: 'POST', body: JSON.stringify(b) }),
  decideRecommendation: (id: string, decision: 'ACCEPTEE' | 'IGNOREE') =>
    request<{ recommendation: Recommendation }>(`/recommendations/${id}/decision`, { method: 'PATCH', body: JSON.stringify({ decision }) }),
  getTraffic: (lat: number, lon: number, radiusMeters = 3000) =>
    request<{ status: 'OK' | 'DONNEES_INSUFFISANTES'; segments: TrafficSegment[] }>(`/traffic?lat=${lat}&lon=${lon}&radiusMeters=${radiusMeters}`),
  setStatisticsConsent: (granted: boolean, policyVersion: string) =>
    request<{ statistics: { granted: boolean | null } }>('/consents/statistics', { method: 'PUT', body: JSON.stringify({ granted, policyVersion }) }),
  postObservations: (observations: ObservationPayload[]) =>
    request<{ accepted: number; duplicates: number; rejected: { clientObsId: string; reason: string }[] }>(
      '/traffic-observations', { method: 'POST', body: JSON.stringify({ observations, appVersion: '0.1.0' }) }),
  listIncidents: (lat: number, lon: number, radiusMeters = 5000) =>
    request<{ incidents: Incident[] }>(`/incidents?lat=${lat}&lon=${lon}&radiusMeters=${radiusMeters}`),
  createReport: (b: { type: IncidentType; description?: string; lat: number; lon: number; clientReportId?: string; observedAt?: string }) =>
    request<{ report: { id: string; incidentId: string; mergedIntoExisting: boolean }; incident: Incident }>(
      '/reports', { method: 'POST', body: JSON.stringify({ ...b, observedAt: b.observedAt ?? new Date().toISOString() }) }),
  respondToIncident: (id: string, kind: 'CONFIRMATION' | 'CONTESTATION') =>
    request<{ incident: Incident }>(`/incidents/${id}/confirmations`, { method: 'POST', body: JSON.stringify({ kind }) }),
  searchPlaces: (q: string, near?: { lat: number; lon: number }) => {
    const p = new URLSearchParams({ q });
    if (near) { p.set('lat', String(near.lat)); p.set('lon', String(near.lon)); }
    return request<{ provider: string; places: Place[] }>(`/places/search?${p}`);
  },
  searchRoutes: (origin: { lat: number; lon: number }, destination: { lat: number; lon: number }, originAccuracyMeters?: number) =>
    request<{ provider: string; computedAt: string; routes: RouteOption[] }>('/routes/search', {
      method: 'POST',
      body: JSON.stringify({ origin, destination, originAccuracyMeters }),
    }),
};
