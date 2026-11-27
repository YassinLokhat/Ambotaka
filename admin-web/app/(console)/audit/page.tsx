'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, fmt, Notice, Panel, PageHeader, Table, Td } from '@/components/ui';
import { api, ApiError } from '@/lib/client';

interface Entry { id: number; at: string; adminUsername: string | null; action: string; resource: string | null; details: Record<string, unknown>; ip: string | null }

export default function Audit() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState({ action: '', admin: '' });
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (more: boolean, from: string | null) => {
    setLoading(true); setError(null);
    const q = new URLSearchParams({ limit: '50' });
    if (filters.action) q.set('action', filters.action);
    if (filters.admin) q.set('admin', filters.admin);
    if (more && from) q.set('cursor', from);
    try {
      const r = await api<{ entries: Entry[]; nextCursor: string | null }>(`audit-logs?${q}`);
      setEntries((cur) => (more ? [...cur, ...r.entries] : r.entries)); setCursor(r.nextCursor);
    } catch (e) { setError({ status: (e as ApiError).status, message: (e as ApiError).message }); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(false, null); }, [load]);

  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Actions sensibles, en ajout seul : même la base de données interdit toute modification."
        actions={<>
          <input placeholder="action (ex. LOGIN_FAILED)" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value.toUpperCase() })} />
          <input placeholder="administrateur" value={filters.admin} onChange={(e) => setFilters({ ...filters, admin: e.target.value })} />
        </>} />
      {error?.status === 403 ? <Notice>Vous n’avez pas la permission de consulter le journal d’audit.</Notice> : error && <Notice kind="danger">{error.message}</Notice>}
      <Panel>
        <Table head={['Date', 'Administrateur', 'Action', 'Ressource', 'Détails', 'IP']} empty={loading ? 'Chargement…' : 'Aucune entrée.'}>
          {entries.map((e) => (
            <tr key={e.id}>
              <Td mono>{fmt(e.at)}</Td><Td>{e.adminUsername ?? '—'}</Td>
              <Td mono className="text-signal">{e.action}</Td><Td mono>{e.resource ?? '—'}</Td>
              <Td>{Object.keys(e.details ?? {}).length > 0 && <details><summary className="cursor-pointer text-xs text-muted">voir</summary><pre className="mt-1 max-w-md overflow-x-auto font-mono text-[11px] text-muted">{JSON.stringify(e.details, null, 2)}</pre></details>}</Td>
              <Td mono>{e.ip ?? '—'}</Td>
            </tr>
          ))}
        </Table>
        {cursor && <div className="mt-4 text-center"><Button disabled={loading} onClick={() => load(true, cursor)}>Charger plus</Button></div>}
      </Panel>
    </>
  );
}
