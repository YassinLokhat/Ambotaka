import { Camera, CircleLayer, LineLayer, MapView, ShapeSource, UserLocation } from '@maplibre/maplibre-react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { DEFAULT_CENTER, MAP_STYLE_URL } from '../../core/config';
import { Incident, RouteOption, TrafficSegment } from '../../core/api';
import { theme } from '../../core/theme';

interface Props {
  user?: { lat: number; lon: number } | null;
  destination?: { lat: number; lon: number } | null;
  routes: RouteOption[];
  selectedId: string | null;
  /** Mode navigation : la caméra suit cette position au lieu de cadrer l'itinéraire. */
  follow?: { lat: number; lon: number } | null;
  incidents?: Incident[];
  traffic?: TrafficSegment[];
  onPressIncident?: (id: string) => void;
  onPressMap: (p: { lat: number; lon: number }) => void;
}

/** Adaptateur cartographique (spec §5.1.1) : l'écran ne dépend que de ces props, pas de MapLibre. */
export function RoadMap({ user, destination, routes, selectedId, onPressMap, follow, incidents = [], onPressIncident, traffic = [] }: Props) {
  const camera = useRef<any>(null);
  const selected = routes.find((r) => r.id === selectedId);

  useEffect(() => {
    if (!follow) return;
    camera.current?.setCamera({ centerCoordinate: [follow.lon, follow.lat], zoomLevel: 16.5, animationDuration: 800 });
  }, [follow]);

  useEffect(() => {
    if (follow || !selected || selected.geometry.coordinates.length < 2) return;
    const lons = selected.geometry.coordinates.map((c) => c[0]);
    const lats = selected.geometry.coordinates.map((c) => c[1]);
    camera.current?.fitBounds([Math.max(...lons), Math.max(...lats)], [Math.min(...lons), Math.min(...lats)], [80, 40, 340, 40], 600);
  }, [selected, follow]);

  const alts = useMemo(
    () => ({ type: 'FeatureCollection' as const,
      features: routes.filter((r) => r.id !== selectedId).map((r) => ({ type: 'Feature' as const, properties: {}, geometry: r.geometry })) }),
    [routes, selectedId],
  );
  const main = useMemo(
    () => ({ type: 'FeatureCollection' as const,
      features: selected ? [{ type: 'Feature' as const, properties: {}, geometry: selected.geometry }] : [] }),
    [selected],
  );
  const incidentShape = useMemo(
    () => ({ type: 'FeatureCollection' as const,
      features: incidents.map((i) => ({ type: 'Feature' as const, properties: { id: i.id, status: i.status },
        geometry: { type: 'Point' as const, coordinates: [i.longitude, i.latitude] } })) }),
    [incidents],
  );
  const trafficShape = useMemo(
    () => ({ type: 'FeatureCollection' as const,
      features: traffic.map((t) => ({ type: 'Feature' as const, properties: { state: t.state }, geometry: t.geometry })) }),
    [traffic],
  );
  const dest = useMemo(
    () => ({ type: 'FeatureCollection' as const,
      features: destination ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [destination.lon, destination.lat] } }] : [] }),
    [destination],
  );

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE_URL}
      onPress={(e: any) => { const [lon, lat] = e.geometry.coordinates; onPressMap({ lat, lon }); }}
    >
      <Camera
        ref={camera}
        defaultSettings={{ centerCoordinate: [(user ?? DEFAULT_CENTER).lon, (user ?? DEFAULT_CENTER).lat], zoomLevel: 12 }}
      />
      {user ? <UserLocation visible /> : null}
      <ShapeSource id="traffic" shape={trafficShape}>
        <LineLayer id="traffic-line" style={{
          lineWidth: 4, lineOpacity: 0.9,
          lineColor: ['match', ['get', 'state'], 'FLUIDE', '#2ECC71', 'RALENTI', '#FFA500', 'CONGESTIONNE', '#E53935', '#6B7280'],
        }} />
      </ShapeSource>
      <ShapeSource id="alts" shape={alts}>
        <LineLayer id="alts-line" style={{ lineColor: theme.routeAlt, lineWidth: 5, lineOpacity: 0.8 }} />
      </ShapeSource>
      <ShapeSource id="main" shape={main}>
        <LineLayer id="main-casing" style={{ lineColor: '#000', lineWidth: 10, lineOpacity: 0.5 }} />
        <LineLayer id="main-line" style={{ lineColor: theme.route, lineWidth: 6 }} />
      </ShapeSource>
      <ShapeSource
        id="incidents" shape={incidentShape}
        onPress={(e: any) => { const id = e?.features?.[0]?.properties?.id; if (id) onPressIncident?.(id); }}
      >
        <CircleLayer id="incidents-halo" style={{ circleRadius: 16, circleColor: '#FF5A5F', circleOpacity: 0.25 }} />
        <CircleLayer id="incidents-dot" style={{
          circleRadius: 8, circleStrokeColor: '#fff', circleStrokeWidth: 2,
          circleColor: ['case', ['==', ['get', 'status'], 'CONFIRME'], '#FF5A5F', '#FFC400'],
        }} />
      </ShapeSource>
      <ShapeSource id="dest" shape={dest}>
        <CircleLayer id="dest-dot" style={{ circleRadius: 9, circleColor: theme.danger, circleStrokeColor: '#fff', circleStrokeWidth: 3 }} />
      </ShapeSource>
    </MapView>
  );
}
