import {
  BadGatewayException, Inject, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GEOCODING_PROVIDER, GeocodingProvider, LatLon, ProviderUnavailableError, ROUTING_PROVIDER, RoutingProvider,
} from './providers/types';

export type SourceEstimation = 'TRAFIC_RECENT' | 'DUREE_REFERENCE';

function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(GEOCODING_PROVIDER) private readonly geocoding: GeocodingProvider,
    private readonly config: ConfigService,
  ) {}

  private wrap<T>(p: Promise<T>, code: string): Promise<T> {
    return p.catch((e) => {
      if (e instanceof ProviderUnavailableError) {
        throw new BadGatewayException({ code, message: 'Le service cartographique est momentanément indisponible.' });
      }
      throw e;
    });
  }

  /** NAV-007 : une recherche ne crée jamais de session de navigation. */
  async searchRoutes(origin: LatLon, destination: LatLon, accuracy?: number) {
    const maxAcc = this.config.get<number>('maxGpsAccuracyMeters') ?? 100;
    if (accuracy !== undefined && accuracy > maxAcc) {
      throw new UnprocessableEntityException({
        code: 'POSITION_NOT_RELIABLE',
        message: 'La position GPS n’est pas assez précise pour calculer un itinéraire.',
      });
    }
    if (distanceM(origin, destination) < 20) {
      throw new UnprocessableEntityException({
        code: 'ORIGIN_EQUALS_DESTINATION',
        message: 'Le départ et la destination sont identiques.',
      });
    }
    const routes = await this.wrap(this.routing.calculateRoutes(origin, destination), 'ROUTING_PROVIDER_UNAVAILABLE');
    if (!routes.length) {
      throw new NotFoundException({ code: 'NO_ROUTE_FOUND', message: 'Aucun itinéraire disponible.' });
    }
    // NAV-005 : provenance explicite. Sans couverture trafic démontrée => durée de référence.
    const estimationSource: SourceEstimation = this.routing.trafficAware ? 'TRAFIC_RECENT' : 'DUREE_REFERENCE';
    return {
      provider: this.routing.name,
      computedAt: new Date().toISOString(),
      routes: routes
        .sort((a, b) => a.durationSeconds - b.durationSeconds)
        .map((r) => ({ ...r, estimationSource })),
    };
  }

  async searchPlaces(q: string, near?: LatLon) {
    const places = await this.wrap(this.geocoding.searchPlaces(q, near), 'GEOCODING_PROVIDER_UNAVAILABLE');
    return { provider: this.geocoding.name, places };
  }
}
