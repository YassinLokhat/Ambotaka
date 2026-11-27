'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CSRF_HEADER, CSRF_VALUE } from './backend-const';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method: init.method ?? 'GET', cache: 'no-store',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: CSRF_VALUE },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'Erreur inattendue.');
  return data as T;
}

/** Charge une ressource, avec rafraîchissement périodique optionnel. `forbidden` distingue « pas le droit » d'une panne. */
export function useApi<T>(path: string | null, everyMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e as ApiError); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    alive.current = true; setLoading(true); load();
    const t = everyMs ? setInterval(load, everyMs) : undefined;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, everyMs]);
  return { data, error, loading, reload: load, forbidden: error?.status === 403 };
}
