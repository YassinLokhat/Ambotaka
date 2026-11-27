import { useEffect, useState } from 'react';
import { api, TrafficSegment } from '../../core/api';

/** Trafic communautaire autour d'un point ; `status` explicite l'absence de données (jamais « fluide » par défaut). */
export function useTraffic(center: { lat: number; lon: number } | null) {
  const [segments, setSegments] = useState<TrafficSegment[]>([]);
  const [status, setStatus] = useState<'LOADING' | 'OK' | 'DONNEES_INSUFFISANTES' | 'ERREUR'>('LOADING');
  const lat = center ? Math.round(center.lat * 100) / 100 : null;
  const lon = center ? Math.round(center.lon * 100) / 100 : null;

  useEffect(() => {
    if (lat === null || lon === null) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await api.getTraffic(lat, lon);
        if (alive) { setSegments(r.segments); setStatus(r.status); }
      } catch { if (alive) setStatus('ERREUR'); }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [lat, lon]);

  return { segments, status };
}
