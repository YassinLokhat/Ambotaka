import { useCallback, useEffect, useState } from 'react';
import { api, Incident } from '../../core/api';

/** Rafraîchit les incidents autour d'un point (arrondi ~110 m pour éviter des appels à chaque fix). */
export function useIncidents(center: { lat: number; lon: number } | null) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const lat = center ? Math.round(center.lat * 1000) / 1000 : null;
  const lon = center ? Math.round(center.lon * 1000) / 1000 : null;

  const refresh = useCallback(async () => {
    if (lat === null || lon === null) return;
    try { setIncidents((await api.listIncidents(lat, lon)).incidents); } catch { /* hors ligne : on garde l'existant */ }
  }, [lat, lon]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const upsert = (i: Incident) => setIncidents((cur) => [i, ...cur.filter((x) => x.id !== i.id)]);
  return { incidents, refresh, upsert };
}
