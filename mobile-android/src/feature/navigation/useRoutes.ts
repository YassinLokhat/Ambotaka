import { useCallback, useState } from 'react';
import { api, RouteOption } from '../../core/api';

/** NAV-007 : cette recherche ne crée aucune session de navigation. */
export function useRoutes() {
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (
    origin: { lat: number; lon: number }, destination: { lat: number; lon: number }, accuracy?: number | null,
  ) => {
    setLoading(true); setError(null); setRoutes([]);
    try {
      const r = await api.searchRoutes(origin, destination, accuracy ?? undefined);
      setRoutes(r.routes);
      setSelectedId(r.routes[0]?.id ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => { setRoutes([]); setSelectedId(null); setError(null); }, []);
  return { routes, selectedId, setSelectedId, loading, error, search, reset };
}
