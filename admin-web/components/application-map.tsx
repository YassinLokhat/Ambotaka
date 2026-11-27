'use client';

import { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface MapIncident extends MapPoint {
  id: string;
  status?: string;
}

export interface MapTraffic {
  segmentId: string;
  state: 'FLUIDE' | 'RALENTI' | 'CONGESTIONNE' | 'INCONNU';
  geometry: { coordinates: [number, number][] };
}

interface Props {
  origin: MapPoint;
  destination: MapPoint | null;
  routeCoordinates: [number, number][];
  incidents: MapIncident[];
  traffic: MapTraffic[];
  onMapPick: (point: MapPoint) => void;
  onPressIncident: (id: string) => void;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    properties: Record<string, string | number | boolean | null>;
    geometry: { type: 'Point' | 'LineString'; coordinates: number[] | number[][] };
  }>;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';
const MAP_WORKER_URL = new URL('../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString();

function geoJsonSource(map: MapLibreMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined;
}

export default function ApplicationMap({ origin, destination, routeCoordinates, incidents, traffic, onMapPick, onPressIncident }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacksRef = useRef({ onMapPick, onPressIncident });
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onMapPick, onPressIncident };
  }, [onMapPick, onPressIncident]);

  useEffect(() => {
    if (!containerRef.current) return;
    setWorkerUrl(MAP_WORKER_URL);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [origin.lon, origin.lat],
      zoom: 14,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.once('load', () => {
      map.addSource('roadpulse-traffic', { type: 'geojson', data: EMPTY as never });
      map.addSource('roadpulse-route', { type: 'geojson', data: EMPTY as never });
      map.addSource('roadpulse-incidents', { type: 'geojson', data: EMPTY as never });
      map.addSource('roadpulse-origin', { type: 'geojson', data: EMPTY as never });
      map.addSource('roadpulse-destination', { type: 'geojson', data: EMPTY as never });

      map.addLayer({
        id: 'roadpulse-traffic-lines', type: 'line', source: 'roadpulse-traffic',
        paint: {
          'line-color': ['match', ['get', 'state'], 'FLUIDE', '#238a63', 'RALENTI', '#d89b23', 'CONGESTIONNE', '#d9574f', '#87938f'],
          'line-width': 4, 'line-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'roadpulse-route-line', type: 'line', source: 'roadpulse-route',
        paint: { 'line-color': '#138b6a', 'line-width': 6, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'roadpulse-incident-points', type: 'circle', source: 'roadpulse-incidents',
        paint: { 'circle-radius': 8, 'circle-color': '#e84e55', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: 'roadpulse-origin-point', type: 'circle', source: 'roadpulse-origin',
        paint: { 'circle-radius': 8, 'circle-color': '#146b9c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'roadpulse-destination-point', type: 'circle', source: 'roadpulse-destination',
        paint: { 'circle-radius': 9, 'circle-color': '#ef684f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });

      map.on('click', (event: MapMouseEvent) => {
        const hit = map.queryRenderedFeatures(event.point, { layers: ['roadpulse-incident-points'] })[0];
        if (hit?.properties?.id) {
          callbacksRef.current.onPressIncident(String(hit.properties.id));
          return;
        }
        callbacksRef.current.onMapPick({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      });
      map.on('mouseenter', 'roadpulse-incident-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'roadpulse-incident-points', () => { map.getCanvas().style.cursor = ''; });
      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.flyTo({ center: [origin.lon, origin.lat], zoom: 14, duration: 700 });
  }, [origin.lat, origin.lon, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const trafficData: FeatureCollection = {
      type: 'FeatureCollection',
      features: traffic.map((segment) => ({
        type: 'Feature',
        id: segment.segmentId,
        properties: { state: segment.state },
        geometry: { type: 'LineString', coordinates: segment.geometry.coordinates },
      })),
    };
    geoJsonSource(map, 'roadpulse-traffic')?.setData(trafficData as never);
  }, [traffic, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const routeData: FeatureCollection = {
      type: 'FeatureCollection',
      features: routeCoordinates.length > 1 ? [{
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoordinates },
      }] : [],
    };
    const incidentData: FeatureCollection = {
      type: 'FeatureCollection',
      features: incidents.map((incident) => ({
        type: 'Feature', id: incident.id, properties: { id: incident.id, status: incident.status ?? '' },
        geometry: { type: 'Point', coordinates: [incident.lon, incident.lat] },
      })),
    };
    const originData: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [origin.lon, origin.lat] } }],
    };
    const destinationData: FeatureCollection = {
      type: 'FeatureCollection',
      features: destination ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [destination.lon, destination.lat] } }] : [],
    };
    geoJsonSource(map, 'roadpulse-route')?.setData(routeData as never);
    geoJsonSource(map, 'roadpulse-incidents')?.setData(incidentData as never);
    geoJsonSource(map, 'roadpulse-origin')?.setData(originData as never);
    geoJsonSource(map, 'roadpulse-destination')?.setData(destinationData as never);
  }, [destination, incidents, origin, routeCoordinates, mapReady]);

  return <div ref={containerRef} className="application-map" aria-label="Carte interactive des environs" />;
}