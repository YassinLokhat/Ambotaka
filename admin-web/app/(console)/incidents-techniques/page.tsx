'use client';
import { useState } from 'react';
import { Badge, Button, fmt, Notice, Panel, PageHeader, State, Table, Td } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, useApi } from '@/lib/client';

interface Inc { id: string; rule: string; service: string; title: string; description: string; severity: string; status: string;
  openedAt: string; lastSeenAt: string; occurrences: number; resolvedAt: string | null; resolvedBy: string | null }
const NEXT: Record<string, { to: string; label: string }[]> = {
  OUVERT: [{ to: 'EN_COURS', label: 'Prendre en charge' }, { to: 'RESOLU', label: 'Résoudre' }],
  EN_COURS: [{ to: 'RESOLU', label: 'Résoudre' }], RESOLU: [{ to: 'CLOTURE', label: 'Clôturer' }], CLOTURE: [],
};

export default function TechIncidents() {
  const { can } = useAuth();
  const [filter, setFilter] = useState('');
  const { data, error, loading, forbidden, reload } = useApi<{ incidents: Inc[] }>(`technical-incidents${filter ? `?status=${filter}` : ''}`, 30_000);
  const [msg, setMsg] = useState<string | null>(null);

  async function move(id: string, status: string) {
    setMsg(null);
    try { await api(`technical-incidents/${id}`, { method: 'PATCH', body: { status } }); await reload(); }
    catch (e) { setMsg((e as ApiError).message); }
  }

  return (
    <>
      <PageHeader title="Incidents techniques" subtitle="Anomalies détectées automatiquement par la supervision."
        actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>{['OUVERT', 'EN_COURS', 'RESOLU', 'CLOTURE'].map((s) => <option key={s}>{s}</option>)}</select>} />
      {msg && <div className="mb-4"><Notice kind="danger">{msg}</Notice></div>}
      <Panel>
        <State loading={loading} error={error} forbidden={forbidden}>
          <Table head={['Gravité', 'Incident', 'Service', 'Statut', 'Vu', 'Actions']} empty="Aucun incident technique.">
            {data?.incidents.map((i) => (
              <tr key={i.id}>
                <Td><Badge value={i.severity} /></Td>
                <Td><div className="font-semibold">{i.title}</div><div className="max-w-md text-xs text-muted">{i.description}</div>
                  <div className="font-mono text-[11px] text-muted">ouvert {fmt(i.openedAt)} · {i.occurrences}×{i.resolvedBy ? ` · résolu par ${i.resolvedBy}` : ''}</div></Td>
                <Td mono>{i.service}</Td>
                <Td><Badge value={i.status} /></Td>
                <Td mono>{fmt(i.lastSeenAt)}</Td>
                <Td>{can('admin.tech.write') && <div className="flex flex-wrap gap-2">{NEXT[i.status].map((n) => <Button key={n.to} onClick={() => move(i.id, n.to)}>{n.label}</Button>)}</div>}</Td>
              </tr>
            ))}
          </Table>
        </State>
      </Panel>
    </>
  );
}
