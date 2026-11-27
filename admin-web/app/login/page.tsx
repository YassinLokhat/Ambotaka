'use client';
import { useState } from 'react';
import { CSRF_HEADER, CSRF_VALUE } from '@/lib/backend-const';

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: CSRF_VALUE },
      body: JSON.stringify({ username: f.get('username'), password: f.get('password') }),
    });
    if (res.ok) { window.location.href = '/'; return; }
    const d = await res.json().catch(() => ({}));
    setError(d.message ?? 'Connexion impossible.');
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="hazard h-2" />
        <form onSubmit={submit} className="space-y-4 p-6">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-signal">RoadPulse</div>
            <h1 className="mt-1 text-2xl font-extrabold">Console d’exploitation</h1>
            <p className="mt-1 text-sm text-muted">Accès réservé aux administrateurs.</p>
          </div>
          <label className="block text-sm">Identifiant
            <input name="username" autoComplete="username" required className="mt-1 w-full" autoFocus />
          </label>
          <label className="block text-sm">Mot de passe
            <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full" />
          </label>
          {error && <div role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          <button disabled={busy} className="w-full rounded-lg bg-signal py-2.5 font-bold text-black transition hover:brightness-110 disabled:opacity-50">
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </main>
  );
}
