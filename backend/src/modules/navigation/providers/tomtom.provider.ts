import { Logger } from '@nestjs/common';
import {
  GeocodingProvider, LatLon, PlaceResult, ProviderUnavailableError, requestJson, RouteResult, RouteStep, RoutingProvider,
} from './types';

// TomTom Orbis (une seule famille de données, cohérente avec la carte Orbis — spec §6.1).
// Routing API Orbis v3 : POST /maps/orbis/routing/routes/calculate ; Search API Orbis v1 : GET /maps/orbis/places/search.
// Clé transmise par en-tête TomTom-Api-Key (jamais dans l'URL, donc jamais dans les journaux).
const BASE = 'https://api.tomtom.com';
const log = new Logger('TomTom');
const NO_ROUTE_CODES = new Set(['NO_ROUTE_FOUND', 'MAP_MATCHING_FAILURE']);

export class TomTomRoutingProvider implements RoutingProvider {
  readonly name = 'tomtom';
  /**
   * @param trafficAware true seulement après validation de la couverture du trafic temps réel (spec §6.2) :
   *   sinon on demande `historical` pour ne pas présenter comme « temps réel » une estimation qui ne l'est pas.
   */
  constructor(private readonly key: string, readonly trafficAware: boolean, private readonly language = 'fr-FR') {}

  async calculateRoutes(o: LatLon, d: LatLon): Promise<RouteResult[]> {
    const { status, body } = await requestJson(`${BASE}/maps/orbis/routing/routes/calculate?apiVersion=3`, {
      method: 'POST',
      headers: { 'TomTom-Api-Key': this.key, Attributes: 'routes', 'Accept-Language': this.language },
      body: {
        routePlanningLocations: {
          origin: { type: 'Point', coordinates: [o.lon, o.lat] },
          destination: { type: 'Point', coordinates: [d.lon, d.lat] },
        },
        maxPathAlternativeRoutes: 2,
        traffic: this.trafficAware ? 'live' : 'historical',
        routeType: 'fast',
        travelMode: 'car',
        guidance: 'instructions',
        instructionPhonetics: 'ipa',
      },
    });

    if (status === 400) {
      const code = body?.detailedError?.code;
      if (NO_ROUTE_CODES.has(code)) return []; // pas de route : réponse normale, pas une panne
      log.error(`Routing 400 (${code ?? 'inconnu'}) : requête invalide`);
      throw new ProviderUnavailableError('TomTom 400');
    }
    if (status !== 200) {
      log.error(`Routing HTTP ${status}${status === 401 || status === 403 ? ' : clé refusée ou service non activé pour cette clé' : ''}`);
      throw new ProviderUnavailableError(`TomTom ${status}`);
    }
    return (body?.routes ?? []).map((r: any, i: number) => this.mapRoute(r, i));
  }

  private mapRoute(r: any, i: number): RouteResult {
    // Un tracé par tronçon (leg) : on les met bout à bout sans dupliquer le point de jonction.
    const coordinates: [number, number][] = [];
    for (const leg of r.legs ?? []) {
      const pts: [number, number][] = leg.path?.coordinates ?? [];
      coordinates.push(...(coordinates.length ? pts.slice(1) : pts));
    }
    const ins: any[] = r.instructions ?? [];
    const steps: RouteStep[] = ins
      .filter((x) => x.maneuverPoint)
      .map((x, k) => ({
        instruction: x.message ?? x.maneuver ?? '',
        // distance entre cette manœuvre et la suivante ; 0 pour la dernière (arrivée)
        distanceMeters: k + 1 < ins.length ? Math.max(0, (ins[k + 1].routeOffsetInMeters ?? 0) - (x.routeOffsetInMeters ?? 0)) : 0,
        location: [x.maneuverPoint.longitude, x.maneuverPoint.latitude] as [number, number],
      }));
    return {
      id: `tomtom-${i}`,
      distanceMeters: r.summary?.lengthInMeters ?? 0,
      durationSeconds: r.summary?.travelDurationInSeconds ?? 0,
      geometry: { type: 'LineString', coordinates },
      steps,
    };
  }
}

export class TomTomGeocodingProvider implements GeocodingProvider {
  readonly name = 'tomtom';
  constructor(private readonly key: string, private readonly country = 'MG') {}

  async searchPlaces(q: string, near?: LatLon): Promise<PlaceResult[]> {
    const params = new URLSearchParams({ apiVersion: '1', limit: '6', countrySet: this.country });
    if (near) params.set('geobias', `point:${near.lat},${near.lon}`);
    const { status, body } = await requestJson(`${BASE}/maps/orbis/places/search/${encodeURIComponent(q)}.json?${params}`, {
      headers: { 'TomTom-Api-Key': this.key },
    });
    if (status !== 200) {
      log.error(`Search HTTP ${status}${status === 401 || status === 403 ? ' : clé refusée ou service non activé pour cette clé' : ''}`);
      throw new ProviderUnavailableError(`TomTom ${status}`);
    }
    // Lecture défensive : le schéma exact d'Orbis Search est à confirmer au Lot 0 (script tomtom-check).
    return (body?.results ?? [])
      .map((r: any) => {
        const lat = r.position?.lat ?? r.position?.latitude, lon = r.position?.lon ?? r.position?.longitude;
        return {
          id: String(r.id ?? `${lat},${lon}`),
          name: r.poi?.name ?? r.address?.streetName ?? r.address?.freeformAddress ?? '',
          address: r.address?.freeformAddress ?? '',
          lat, lon,
        };
      })
      .filter((p: PlaceResult) => typeof p.lat === 'number' && typeof p.lon === 'number');
  }
}
