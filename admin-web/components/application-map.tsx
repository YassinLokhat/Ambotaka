'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface MapIncident extends MapPoint {
  id: string;
  status?: string;
}

interface Props {
  origin: MapPoint;
  destination: MapPoint | null;
  routeCoordinates: [number, number][];
  incidents: MapIncident[];
  onMapPick: (point: MapPoint) => void;
}

function MapController({ center }: { center: MapPoint }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lon], 14, { duration: 0.7 });
  }, [center, map]);
  return null;
}

function MapClick({ onPick }: { onPick: Props['onMapPick'] }) {
  useMapEvents({ click: ({ latlng }) => onPick({ lat: latlng.lat, lon: latlng.lng }) });
  return null;
}

export default function ApplicationMap({ origin, destination, routeCoordinates, incidents, onMapPick }: Props) {
  const center = destination ?? origin;
  const positions = routeCoordinates.map(([lon, lat]) => [lat, lon] as [number, number]);

  return (
    <MapContainer center={[origin.lat, origin.lon]} zoom={14} scrollWheelZoom className="application-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <MapController center={center} />
      <MapClick onPick={onMapPick} />
      {positions.length > 1 && <Polyline positions={positions} pathOptions={{ color: '#138b6a', weight: 7, opacity: 0.88 }} />}
      <CircleMarker center={[origin.lat, origin.lon]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#146b9c', fillOpacity: 1 }} />
      {destination && <CircleMarker center={[destination.lat, destination.lon]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#ef684f', fillOpacity: 1 }} />}
      {incidents.map((incident) => (
        <CircleMarker key={incident.id} center={[incident.lat, incident.lon]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#e84e55', fillOpacity: 1 }} />
      ))}
    </MapContainer>
  );
}