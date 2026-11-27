import { fetchJson, GeocodingProvider, LatLon, PlaceResult, RouteResult, RoutingProvider } from './types';

export class MapboxRoutingProvider implements RoutingProvider {
  readonly name = 'mapbox';
  constructor(private readonly key: string, private readonly profile: string, readonly trafficAware: boolean) {}

  async calculateRoutes(o: LatLon, d: LatLon): Promise<RouteResult[]> {
    const coords = `${o.lon},${o.lat};${d.lon},${d.lat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/${this.profile}/${coords}` +
      `?alternatives=true&geometries=geojson&overview=full&steps=true&access_token=${this.key}`;
    const data = await fetchJson(url);
    return (data.routes ?? []).map((r: any, i: number) => ({
      id: `mapbox-${i}`,
      distanceMeters: r.distance,
      durationSeconds: r.duration,
      geometry: r.geometry,
      steps: (r.legs ?? []).flatMap((l: any) =>
        (l.steps ?? []).map((st: any) => ({
          instruction: st.maneuver?.instruction ?? '',
          distanceMeters: st.distance,
          location: st.maneuver?.location,
        })),
      ).filter((st: any) => st.location),
    }));
  }
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name = 'mapbox';
  constructor(private readonly key: string, private readonly country = 'mg') {}

  async searchPlaces(q: string, near?: LatLon): Promise<PlaceResult[]> {
    let url =
      `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}` +
      `&country=${this.country}&limit=6&access_token=${this.key}`;
    if (near) url += `&proximity=${near.lon},${near.lat}`;
    const data = await fetchJson(url);
    return (data.features ?? []).map((f: any) => ({
      id: f.properties?.mapbox_id ?? f.id,
      name: f.properties?.name ?? '',
      address: f.properties?.full_address ?? f.properties?.place_formatted ?? '',
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
  }
}
