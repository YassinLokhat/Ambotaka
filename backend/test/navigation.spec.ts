import { ConfigService } from '@nestjs/config';
import { MapboxRoutingProvider } from '../src/modules/navigation/providers/mapbox.provider';
import { ProviderUnavailableError } from '../src/modules/navigation/providers/types';
import { RoutesService } from '../src/modules/navigation/routes.service';

const o = { lat: -18.9137, lon: 47.5361 };
const d = { lat: -18.8792, lon: 47.5079 };
const cfg = { get: () => undefined } as unknown as ConfigService;
const geo: any = { name: 'x', searchPlaces: async () => [] };

describe('RoutesService', () => {
  it('trie par durée et marque la durée de référence sans trafic validé', async () => {
    const routing: any = {
      name: 'fake', trafficAware: false,
      calculateRoutes: async () => [
        { id: 'b', distanceMeters: 1, durationSeconds: 900, geometry: { type: 'LineString', coordinates: [] }, steps: [] },
        { id: 'a', distanceMeters: 1, durationSeconds: 600, geometry: { type: 'LineString', coordinates: [] }, steps: [] },
      ],
    };
    const res = await new RoutesService(routing, geo, cfg).searchRoutes(o, d);
    expect(res.routes.map((r) => r.id)).toEqual(['a', 'b']);
    expect(res.routes[0].estimationSource).toBe('DUREE_REFERENCE');
  });

  it('refuse une position imprécise (NAV-003)', async () => {
    const routing: any = { name: 'f', trafficAware: false, calculateRoutes: jest.fn() };
    await expect(new RoutesService(routing, geo, cfg).searchRoutes(o, d, 500)).rejects.toMatchObject({
      response: { code: 'POSITION_NOT_RELIABLE' },
    });
    expect(routing.calculateRoutes).not.toHaveBeenCalled();
  });

  it('404 si aucun itinéraire, 502 si fournisseur indisponible', async () => {
    const empty: any = { name: 'f', trafficAware: false, calculateRoutes: async () => [] };
    await expect(new RoutesService(empty, geo, cfg).searchRoutes(o, d)).rejects.toMatchObject({
      response: { code: 'NO_ROUTE_FOUND' },
    });
    const down: any = { name: 'f', trafficAware: false, calculateRoutes: async () => { throw new ProviderUnavailableError('x'); } };
    await expect(new RoutesService(down, geo, cfg).searchRoutes(o, d)).rejects.toMatchObject({
      response: { code: 'ROUTING_PROVIDER_UNAVAILABLE' },
    });
  });
});

describe('MapboxRoutingProvider', () => {
  it('mappe la réponse Directions', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: 5000, duration: 700, geometry: { type: 'LineString', coordinates: [[47.5, -18.9]] }, legs: [{ steps: [{ distance: 120, maneuver: { instruction: 'Tournez à gauche', location: [47.5, -18.9] } }] }] }] }),
    });
    const r = await new MapboxRoutingProvider('k', 'driving', false).calculateRoutes(o, d);
    expect(r[0]).toMatchObject({ distanceMeters: 5000, durationSeconds: 700 });
    expect(r[0].steps[0]).toEqual({ instruction: 'Tournez à gauche', distanceMeters: 120, location: [47.5, -18.9] });
  });
});
