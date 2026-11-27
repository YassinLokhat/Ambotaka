'use client';
import { Badge, fmt, Notice, Panel, PageHeader, Stat, State, Table, Td } from '@/components/ui';
import { useApi } from '@/lib/client';

interface Deletions { byStatus: Record<string, number>; stuck: { id: string; installation: string; types: string[]; status: string; attempts: number; createdAt: string }[] }

export default function Privacy() {
  const { data, error, loading, forbidden } = useApi<Deletions>('privacy/deletions', 30_000);
  return (
    <>
      <PageHeader title="Suppressions de données" subtitle="Suivi des demandes des conducteurs. Les installations sont pseudonymisées (8 premiers caractères)." />
      <State loading={loading} error={error} forbidden={forbidden}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Confirmées" value={data.byStatus.CONFIRMEE ?? 0} tone="ok" />
              <Stat label="En cours" value={data.byStatus.EN_COURS ?? 0} />
              <Stat label="En échec" value={data.byStatus.ECHEC ?? 0} tone={(data.byStatus.ECHEC ?? 0) > 0 ? 'danger' : undefined} />
            </div>
            <Panel title="Demandes bloquées (non confirmées au-delà du seuil)">
              {data.stuck.length === 0 ? <Notice kind="ok">Aucune demande bloquée.</Notice> : (
                <Table head={['Demande', 'Installation', 'Types', 'Statut', 'Tentatives', 'Créée']}>
                  {data.stuck.map((d) => (
                    <tr key={d.id}><Td mono>{d.id.slice(0, 8)}</Td><Td mono>{d.installation}…</Td><Td mono>{d.types.join(', ')}</Td>
                      <Td><Badge value={d.status} /></Td><Td mono>{d.attempts}</Td><Td mono>{fmt(d.createdAt)}</Td></tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>
        )}
      </State>
    </>
  );
}
