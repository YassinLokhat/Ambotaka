import { useEffect, useState } from 'react';
import { api, Place } from '../../core/api';

export function usePlaceSearch(query: string, near?: { lat: number; lon: number }) {
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const r = await api.searchPlaces(query.trim(), near);
        if (!cancelled) setResults(r.places);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return { results, loading, error, clear: () => setResults([]) };
}
