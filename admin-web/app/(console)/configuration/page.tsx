'use client';
import { useMemo, useState } from 'react';
import { Button, fmt, Notice, Panel, PageHeader, State } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, useApi } from '@/lib/client';

interface Param { key: string; value: number; description: string | null; updatedAt: string; isRatio: boolean }

export default function Configuration() {
  const { can } = useAuth();
  const { data, error, loading, forbidden, reload } = useApi<{ parameters: Param[] }>('configuration');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const writable = can('admin.config.write');

  const groups = useMemo(() => {
    const g: Record<string, Param[]> = {};
    data?.parameters.forEach((p) => { (g[p.key.split('.')[0]] ??= []).push(p); });
    return g;
  }, [data]);
  const dirty = Object.entries(edits).filter(([k, v]) => v !== '' && Number(v) !== data?.parameters.find((p) => p.key === k)?.value);

  async function save() {
    setMsg(null);
    try {
      await api('configuration', { method: 'PATCH', body: { changes: dirty.map(([key, v]) => ({ key, value: Number(v) })) } });
      setEdits({}); await reload(); setMsg({ kind: 'ok', text: `${dirty.length} paramètre(s) enregistré(s) et audités.` });
    } catch (e) { setMsg({ kind: 'danger', text: (e as ApiError).message }); }
  }

  return (
    <>
      <PageHeader title="Configuration" subtitle="Seuils métier et de supervision. Valeurs initiales NON validées : à calibrer pendant le pilote. Chaque changement est historisé et audité."
        actions={writable && <Button variant="primary" disabled={!dirty.length} onClick={save}>Enregistrer ({dirty.length})</Button>} />
      {msg && <div className="mb-4"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <State loading={loading} error={error} forbidden={forbidden}>
        <div className="space-y-6">
          {Object.entries(groups).map(([group, params]) => (
            <Panel key={group} title={group}>
              <div className="divide-y divide-line/70">
                {params.map((p) => (
                  <div key={p.key} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-4 py-2.5">
                    <div><div className="font-mono text-sm">{p.key}</div><div className="text-xs text-muted">{p.description}{p.isRatio ? ' · proportion (0 à 1)' : ''} · modifié {fmt(p.updatedAt)}</div></div>
                    <input type="number" step="any" min={0} max={p.isRatio ? 1 : undefined} disabled={!writable} className="w-full text-right font-mono"
                      value={edits[p.key] ?? String(p.value)} onChange={(e) => setEdits({ ...edits, [p.key]: e.target.value })} aria-label={p.key} />
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </State>
    </>
  );
}
