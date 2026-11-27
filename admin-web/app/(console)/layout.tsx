'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthContext, Me } from '@/lib/auth-context';
import { CSRF_HEADER, CSRF_VALUE } from '@/lib/backend-const';

const NAV: { href: string; label: string; perm: string }[] = [
  { href: '/', label: 'Tableau de bord', perm: 'admin.metrics.read' },
  { href: '/incidents-techniques', label: 'Incidents techniques', perm: 'admin.tech.read' },
  { href: '/signalements', label: 'Incidents routiers', perm: 'admin.community.read' },
  { href: '/trafic', label: 'Trafic agrégé', perm: 'admin.traffic.read' },
  { href: '/confidentialite', label: 'Suppressions', perm: 'admin.privacy.read' },
  { href: '/configuration', label: 'Configuration', perm: 'admin.config.read' },
  { href: '/administrateurs', label: 'Administrateurs', perm: 'admin.users.read' },
  { href: '/audit', label: 'Journal d’audit', perm: 'admin.audit.read' },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then(async (r) => {
      if (r.status === 401) { window.location.href = '/login'; return; }
      if (r.ok) setMe((await r.json()).admin as Me);
    }).catch(() => undefined);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { [CSRF_HEADER]: CSRF_VALUE } });
    window.location.href = '/login';
  }
  if (!me) return <div className="p-8 font-mono text-sm text-muted">Chargement de la session…</div>;
  const can = (p: string) => me.permissions.includes(p);

  return (
    <AuthContext.Provider value={{ me, can }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-panel">
          <div className="hazard h-1.5" />
          <div className="px-5 py-5">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-signal">RoadPulse</div>
            <div className="text-lg font-extrabold">Console</div>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {NAV.filter((n) => can(n.perm)).map((n) => {
              const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-signal text-black' : 'text-muted hover:bg-panel2 hover:text-white'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-line p-4 text-sm">
            <div className="font-mono text-xs text-muted">connecté</div>
            <div className="font-semibold">{me.username}</div>
            <div className="mb-3 text-xs text-muted">{me.roles.join(', ') || 'aucun rôle'}</div>
            <button onClick={logout} className="w-full rounded-lg border border-line py-1.5 text-sm hover:bg-panel2">Se déconnecter</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </div>
    </AuthContext.Provider>
  );
}
