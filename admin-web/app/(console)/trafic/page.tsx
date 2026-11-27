'use client';
import { Badge, fmt, Notice, Panel, PageHeader, Stat, State } from '@/components/ui';
import { useApi } from '@/lib/client';

interface Summary { freshSegmentsByState: Record<string, number>; networkSegments: number; lastComputedAt: string | null;
  observationsLastHour: number; contributorsLastHour: number }

export default function Traffic() {
  const { data, error, loading, forbidden } = useApi<Summary>('traffic/summary', 30_000);
  const total = data ? Object.values(data.freshSegmentsByState).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <PageHeader title="Trafic agrégé" subtitle="Vue d’ensemble uniquement : la console n’affiche jamais de position individuelle." />
      <State loading={loading} error={error} forbidden={forbidden}>
        {data && (
          <div className="space-y-6">
            {total === 0 && <Notice>Données insuffisantes : aucun tronçon n’atteint les seuils de publication. L’absence de mesure n’est jamais présentée comme une circulation fluide.</Notice>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Réseau importé" value={data.networkSegments} hint="tronçons" tone={data.networkSegments === 0 ? 'danger' : undefined} />
              <Stat label="Tronçons mesurés" value={total} />
              <Stat label="Observations (1 h)" value={data.observationsLastHour} />
              <Stat label="Contributeurs (1 h)" value={data.contributorsLastHour} />
            </div>
            <Panel title="Répartition des tronçons frais">
              <div className="flex flex-wrap items-center gap-6">
                {['FLUIDE', 'RALENTI', 'CONGESTIONNE', 'INCONNU'].map((s) => (
                  <div key={s} className="flex items-center gap-3"><Badge value={s} /><span className="font-mono text-2xl font-bold">{data.freshSegmentsByState[s] ?? 0}</span></div>
                ))}
              </div>
              <p className="mt-4 font-mono text-xs text-muted">Dernier calcul : {fmt(data.lastComputedAt)}</p>
            </Panel>
          </div>
        )}
      </State>
    </>
  );
}
