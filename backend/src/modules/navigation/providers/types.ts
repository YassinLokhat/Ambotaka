export interface LatLon { lat: number; lon: number }

export interface PlaceResult { id: string; name: string; address: string; lat: number; lon: number }

export interface RouteStep { instruction: string; distanceMeters: number; location: [number, number] } // [lon, lat]

export interface RouteResult {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] }; // [lon, lat]
  steps: RouteStep[];
}

export interface RoutingProvider {
  readonly name: string;
  /** true si la durée retournée inclut un trafic dont la couverture est démontrée. */
  readonly trafficAware: boolean;
  calculateRoutes(origin: LatLon, destination: LatLon): Promise<RouteResult[]>;
}

export interface GeocodingProvider {
  readonly name: string;
  searchPlaces(query: string, near?: LatLon): Promise<PlaceResult[]>;
}

export class ProviderUnavailableError extends Error {}

export const ROUTING_PROVIDER = 'ROUTING_PROVIDER';
export const GEOCODING_PROVIDER = 'GEOCODING_PROVIDER';

export interface HttpResult { status: number; body: any }

/** Requête JSON avec timeout ; ne lève que si le fournisseur est injoignable. N'inclut jamais l'URL ni les clés dans l'erreur. */
export async function requestJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<HttpResult> {
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    throw new ProviderUnavailableError('Provider injoignable ou trop lent');
  }
}

/** GET JSON : erreur si le statut n'est pas 2xx (utilisé par les fournisseurs qui n'ont pas de cas d'erreur « normaux »). */
export async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const { status, body } = await requestJson(url, { timeoutMs });
  if (status < 200 || status >= 300) throw new ProviderUnavailableError(`Provider HTTP ${status}`);
  return body;
}
