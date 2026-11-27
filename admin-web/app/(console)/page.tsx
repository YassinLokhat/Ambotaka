'use client';
import { useState } from 'react';
import { Badge, Button, fmt, Notice, Panel, PageHeader, Sparkline, Stat, State } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, useApi } from '@/lib/client';

interface Services { at: string | null; services: { name: string; state: string; detail?: string }[]; sample: null | {
  requests: number; errors5xx: number; p95Ms: number | null; activeCommunityIncidents: number; freshTrafficSegments: number;
  stuckDeletions: number; aggregationLagSeconds: number | null; recentObservations: number } }
interface Alerts { alerts: { id: string; title: string; service: string; message: string; severity: string; createdAt: string }[] }
interface Series { points: { at: string; value: number }[]; unit: string | null }

export default function Dashboard() {
  const { can } = useAuth();
  const svc = useApi<Services>(can('admin.metrics.read') ? 'services' : null, 30_000);
  const alerts = useApi<Alerts>(can('admin.tech.read') ? 'alerts?acknowledged=false' : null, 30_000);
  const p95 = useApi<Series>(can('admin.metrics.read') ? 'metrics?name=api.p95_ms&minutes=180' : null, 60_000);
  const seg = useApi<Series>(can('admin.metrics.read') ? 'metrics?name=traffic.fresh_segments&minutes=180' : null, 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const s = svc.data?.sample;

  async function ack(id: string) {
    setBusy(id);
    try { await api(`alerts/${id}/acknowledge`, { method: 'PATCH' }); await alerts.reload(); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={svc.data?.at ? `Dernier relevé : ${fmt(svc.data.at)}` : 'Supervision en temps réel'} actions={<Button onClick={() => { svc.reload(); alerts.reload(); }}>Actualiser</Button>} />
      <div className="space-y-6">
        <State loading={svc.loading} error={svc.error} forbidden={svc.forbidden}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {svc.data?.services.map((x) => (
              <div key={x.name} className="rounded-xl border border-line bg-panel p-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{x.name}</div>
                <div className="mt-2"><Badge value={x.state} /></div>
                <div className="mt-2 font-mono text-xs text-muted">{x.detail ?? ' '}</div>
              </div>
            ))}
          </div>
          {s && (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Requêtes (5 min)" value={s.requests} hint={`${s.errors5xx} erreur(s) 5xx`} tone={s.errors5xx > 0 ? 'warn' : undefined} />
              <Stat label="Latence p95" value={s.p95Ms === null ? '—' : `${Math.round(s.p95Ms)} ms`} />
              <Stat label="Incidents routiers actifs" value={s.activeCommunityIncidents} />
              <Stat label="Tronçons mesurés" value={s.freshTrafficSegments} hint={s.freshTrafficSegments === 0 ? 'données insuffisantes' : 'mesures fraîches'} />
              <Stat label="Suppressions bloquées" value={s.stuckDeletions} tone={s.stuckDeletions > 0 ? 'danger' : 'ok'} />
              <Stat label="Retard d’agrégation" value={s.aggregationLagSeconds === null ? '—' : `${Math.round(s.aggregationLagSeconds / 60)} min`} />
              <Stat label="Observations (10 min)" value={s.recentObservations} />
            </div>
          )}
        </State>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Alertes à traiter">
            <State loading={alerts.loading} error={alerts.error} forbidden={alerts.forbidden}>
              {alerts.data?.alerts.length ? (
                <ul className="space-y-3">
                  {alerts.data.alerts.map((a) => (
                    <li key={a.id} className="rounded-lg border border-line bg-panel2 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2"><Badge value={a.severity} /><span className="font-semibold">{a.title}</span></div>
                        {can('admin.tech.write') && <Button disabled={busy === a.id} onClick={() => ack(a.id)}>Acquitter</Button>}
                      </div>
                      <p className="mt-2 text-sm text-muted">{a.message}</p>
                      <div className="mt-1 font-mono text-[11px] text-muted">{a.service} · {fmt(a.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              ) : <Notice kind="ok">Aucune alerte en attente.</Notice>}
            </State>
          </Panel>
          <div className="space-y-6">
            <Panel title="Latence p95 · 3 h"><State loading={p95.loading} error={p95.error} forbidden={p95.forbidden}><Sparkline points={p95.data?.points ?? []} unit="ms" /></State></Panel>
            <Panel title="Tronçons mesurés · 3 h"><State loading={seg.loading} error={seg.error} forbidden={seg.forbidden}><Sparkline points={seg.data?.points ?? []} /></State></Panel>
          </div>
        </div>
      </div>
    </>
  );
}
