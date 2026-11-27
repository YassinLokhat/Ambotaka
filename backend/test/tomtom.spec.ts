import { TomTomGeocodingProvider, TomTomRoutingProvider } from '../src/modules/navigation/providers/tomtom.provider';
import { ProviderUnavailableError } from '../src/modules/navigation/providers/types';

const o = { lat: -18.91, lon: 47.525 }, d = { lat: -18.797, lon: 47.479 };
const reply = (status: number, body: unknown) => jest.fn().mockResolvedValue({ status, json: async () => body });

describe('TomTomRoutingProvider (Orbis v3)', () => {
  afterEach(() => { delete (global as any).fetch; });

  it('envoie la requête documentée : POST, clé en en-tête (jamais dans l’URL), coordonnées [lon, lat]', async () => {
    const f = reply(200, { routes: [] });
    (global as any).fetch = f;
    await new TomTomRoutingProvider('SECRET-KEY', false).calculateRoutes(o, d);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3');
    expect(url).not.toContain('SECRET-KEY');
    expect(init.method).toBe('POST');
    expect(init.headers['TomTom-Api-Key']).toBe('SECRET-KEY');
    expect(init.headers.Attributes).toBe('routes');
    const body = JSON.parse(init.body);
    expect(body.routePlanningLocations.origin).toEqual({ type: 'Point', coordinates: [47.525, -18.91] });
    expect(body.routePlanningLocations.destination.coordinates).toEqual([47.479, -18.797]);
    expect(body).toMatchObject({ maxPathAlternativeRoutes: 2, guidance: 'instructions', instructionPhonetics: 'ipa', travelMode: 'car' });
  });

  it('demande un trafic « historical » tant que la couverture temps réel n’est pas validée (spec §6.2)', async () => {
    const f = reply(200, { routes: [] });
    (global as any).fetch = f;
    await new TomTomRoutingProvider('k', false).calculateRoutes(o, d);
    expect(JSON.parse(f.mock.calls[0][1].body).traffic).toBe('historical');
    await new TomTomRoutingProvider('k', true).calculateRoutes(o, d);
    expect(JSON.parse(f.mock.calls[1][1].body).traffic).toBe('live');
  });

  it('mappe distance, durée, tracé (tronçons raccordés) et instructions avec leurs distances', async () => {
    (global as any).fetch = reply(200, { routes: [{
      summary: { lengthInMeters: 5000, travelDurationInSeconds: 700 },
      legs: [
        { path: { type: 'LineString', coordinates: [[47.5, -18.9], [47.51, -18.91]] } },
        { path: { type: 'LineString', coordinates: [[47.51, -18.91], [47.52, -18.92]] } },
      ],
      instructions: [
        { routeOffsetInMeters: 0, maneuverPoint: { latitude: -18.9, longitude: 47.5 }, maneuver: 'depart', message: 'Partez vers le nord.' },
        { routeOffsetInMeters: 1200, maneuverPoint: { latitude: -18.91, longitude: 47.51 }, maneuver: 'turnRight', message: 'Tournez à droite.' },
        { routeOffsetInMeters: 5000, maneuverPoint: { latitude: -18.92, longitude: 47.52 }, maneuver: 'arrive', message: 'Vous êtes arrivé.' },
      ],
    }] });
    const [r] = await new TomTomRoutingProvider('k', false).calculateRoutes(o, d);
    expect(r).toMatchObject({ id: 'tomtom-0', distanceMeters: 5000, durationSeconds: 700 });
    expect(r.geometry.coordinates).toEqual([[47.5, -18.9], [47.51, -18.91], [47.52, -18.92]]); // point de jonction non dupliqué
    expect(r.steps).toEqual([
      { instruction: 'Partez vers le nord.', distanceMeters: 1200, location: [47.5, -18.9] },
      { instruction: 'Tournez à droite.', distanceMeters: 3800, location: [47.51, -18.91] },
      { instruction: 'Vous êtes arrivé.', distanceMeters: 0, location: [47.52, -18.92] },
    ]);
  });

  it('« aucune route » est une réponse normale ; clé refusée ou panne = fournisseur indisponible', async () => {
    (global as any).fetch = reply(400, { detailedError: { code: 'NO_ROUTE_FOUND', message: 'x' } });
    expect(await new TomTomRoutingProvider('k', false).calculateRoutes(o, d)).toEqual([]);
    (global as any).fetch = reply(400, { detailedError: { code: 'MAP_MATCHING_FAILURE', message: 'x' } });
    expect(await new TomTomRoutingProvider('k', false).calculateRoutes(o, d)).toEqual([]);
    (global as any).fetch = reply(400, { detailedError: { code: 'BAD_INPUT', message: 'x' } });
    await expect(new TomTomRoutingProvider('k', false).calculateRoutes(o, d)).rejects.toBeInstanceOf(ProviderUnavailableError);
    for (const status of [403, 429, 500]) {
      (global as any).fetch = reply(status, {});
      await expect(new TomTomRoutingProvider('k', false).calculateRoutes(o, d)).rejects.toBeInstanceOf(ProviderUnavailableError);
    }
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(new TomTomRoutingProvider('k', false).calculateRoutes(o, d)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe('TomTomGeocodingProvider (Orbis Search v1)', () => {
  afterEach(() => { delete (global as any).fetch; });

  it('restreint à Madagascar, biaise vers la position, clé en en-tête', async () => {
    const f = reply(200, { results: [] });
    (global as any).fetch = f;
    await new TomTomGeocodingProvider('SECRET-KEY').searchPlaces('Analakely', { lat: -18.9, lon: 47.5 });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/maps/orbis/places/search/Analakely.json?');
    expect(url).toContain('countrySet=MG');
    expect(url).toContain('geobias=point%3A-18.9%2C47.5');
    expect(url).not.toContain('SECRET-KEY');
    expect(init.headers['TomTom-Api-Key']).toBe('SECRET-KEY');
  });

  it('mappe lieux et adresses, ignore les résultats sans position', async () => {
    (global as any).fetch = reply(200, { results: [
      { id: 'a1', poi: { name: 'Marché d’Analakely' }, address: { freeformAddress: 'Analakely, Antananarivo' }, position: { lat: -18.91, lon: 47.525 } },
      { id: 'a2', address: { freeformAddress: 'Rue Rainandriamampandry, Antananarivo', streetName: 'Rue Rainandriamampandry' }, position: { lat: -18.92, lon: 47.52 } },
      { id: 'sans-position', address: { freeformAddress: 'x' } },
    ] });
    const r = await new TomTomGeocodingProvider('k').searchPlaces('analakely');
    expect(r).toEqual([
      { id: 'a1', name: 'Marché d’Analakely', address: 'Analakely, Antananarivo', lat: -18.91, lon: 47.525 },
      { id: 'a2', name: 'Rue Rainandriamampandry', address: 'Rue Rainandriamampandry, Antananarivo', lat: -18.92, lon: 47.52 },
    ]);
  });

  it('erreur HTTP = fournisseur indisponible', async () => {
    (global as any).fetch = reply(403, {});
    await expect(new TomTomGeocodingProvider('k').searchPlaces('x')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
