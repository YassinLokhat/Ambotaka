'use client';
import { useState } from 'react';
import { Badge, Button, fmt, Notice, Panel, PageHeader, State, Table, Td } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, useApi } from '@/lib/client';

interface Inc { id: string; type: string; description: string | null; status: string; latitude: number; longitude: number; confidence: number;
  reporterCount: number; confirmationCount: number; contestationCount: number; updatedAt: string; expiresAt: string }

export default function Community() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const { data, error, loading, forbidden, reload } = useApi<{ incidents: Inc[] }>(`community/incidents${status ? `?status=${status}` : ''}`, 30_000);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(id: string, action: 'RESOLVE' | 'EXPIRE') {
    setMsg(null);
    try { await api(`community/incidents/${id}`, { method: 'PATCH', body: { action } }); await reload(); }
    catch (e) { setMsg((e as ApiError).message); }
  }

  return (
    <>
      <PageHeader title="Incidents routiers" subtitle="Signalements des conducteurs regroupés par incident. Aucun identifiant de déclarant n’est affiché."
        actions={<select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>{['DETECTE', 'CONFIRME', 'EN_COURS', 'RESOLU', 'EXPIRE'].map((s) => <option key={s}>{s}</option>)}</select>} />
      {msg && <div className="mb-4"><Notice kind="danger">{msg}</Notice></div>}
      <Panel>
        <State loading={loading} error={error} forbidden={forbidden}>
          <Table head={['Type', 'Statut', 'Confiance', 'Témoignages', 'Position', 'Mis à jour', 'Actions']} empty="Aucun incident.">
            {data?.incidents.map((i) => {
              const closed = ['RESOLU', 'EXPIRE'].includes(i.status);
              return (
                <tr key={i.id}>
                  <Td><div className="font-semibold">{i.type.replace('_', ' ')}</div>{i.description && <div className="max-w-xs text-xs text-muted">{i.description}</div>}</Td>
                  <Td><Badge value={i.status} /></Td>
                  <Td mono>{Math.round(i.confidence * 100)} %</Td>
                  <Td mono>{i.reporterCount} décl. · {i.confirmationCount} conf. · {i.contestationCount} contest.</Td>
                  <Td mono>{i.latitude.toFixed(4)}, {i.longitude.toFixed(4)}</Td>
                  <Td mono>{fmt(i.updatedAt)}</Td>
                  <Td>{can('admin.community.write') && !closed && (
                    <div className="flex gap-2"><Button onClick={() => act(i.id, 'RESOLVE')}>Marquer résolu</Button><Button variant="danger" onClick={() => act(i.id, 'EXPIRE')}>Écarter</Button></div>)}</Td>
                </tr>
              );
            })}
          </Table>
        </State>
      </Panel>
    </>
  );
}
