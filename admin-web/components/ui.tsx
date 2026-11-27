'use client';
import React from 'react';

const tone: Record<string, string> = {
  ok: 'border-ok/40 text-ok bg-ok/10', warn: 'border-warn/40 text-warn bg-warn/10', danger: 'border-danger/50 text-danger bg-danger/10',
  signal: 'border-signal/50 text-signal bg-signal/10', muted: 'border-line text-muted bg-panel2',
};
export const toneFor = (v: string): string => ({
  DISPONIBLE: 'ok', DEGRADE: 'warn', INDISPONIBLE: 'danger', FAIBLE: 'muted', MOYEN: 'warn', ELEVE: 'danger', CRITIQUE: 'danger',
  OUVERT: 'danger', EN_COURS: 'warn', RESOLU: 'ok', CLOTURE: 'muted', DETECTE: 'signal', CONFIRME: 'danger', EXPIRE: 'muted',
  FLUIDE: 'ok', RALENTI: 'warn', CONGESTIONNE: 'danger', INCONNU: 'muted', CONFIRMEE: 'ok', ECHEC: 'danger',
} as Record<string, string>)[v] ?? 'muted';

export function Badge({ value, children }: { value?: string; children?: React.ReactNode }) {
  return <span className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${tone[toneFor(value ?? '')]}`}>{children ?? value}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Panel({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{title}</h2>{right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone: t }: { label: string; value: React.ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={`mt-1 font-mono text-3xl font-bold ${t === 'danger' ? 'text-danger' : t === 'warn' ? 'text-warn' : t === 'ok' ? 'text-ok' : 'text-white'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Button({ variant = 'default', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const v = variant === 'primary' ? 'bg-signal text-black hover:brightness-110' : variant === 'danger' ? 'border border-danger/60 text-danger hover:bg-danger/10' : 'border border-line text-white hover:bg-panel2';
  return <button {...p} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${v} ${p.className ?? ''}`} />;
}

export function Notice({ kind = 'muted', children }: { kind?: 'muted' | 'danger' | 'ok'; children: React.ReactNode }) {
  return <div className={`rounded-lg border px-3 py-2 text-sm ${tone[kind === 'muted' ? 'muted' : kind]}`}>{children}</div>;
}

/** Affiche chargement / refus de droit / erreur, sinon le contenu. */
export function State({ loading, error, forbidden, children }: { loading: boolean; error: { message: string } | null; forbidden?: boolean; children: React.ReactNode }) {
  if (forbidden) return <Notice>Vous n’avez pas la permission de consulter cette section.</Notice>;
  if (loading) return <div className="font-mono text-sm text-muted">Chargement…</div>;
  if (error) return <Notice kind="danger">{error.message}</Notice>;
  return <>{children}</>;
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  const rows = React.Children.count(children);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-muted">{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line/70">{children}</tbody>
      </table>
      {rows === 0 && <div className="px-3 py-6 text-center text-sm text-muted">{empty ?? 'Aucun élément.'}</div>}
    </div>
  );
}
export const Td = ({ children, mono, className = '' }: { children?: React.ReactNode; mono?: boolean; className?: string }) =>
  <td className={`px-3 py-2 align-top ${mono ? 'font-mono text-xs' : ''} ${className}`}>{children}</td>;

export const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }) : '—');

export function Sparkline({ points, unit }: { points: { at: string; value: number }[]; unit?: string }) {
  if (points.length < 2) return <div className="font-mono text-xs text-muted">Pas assez de points.</div>;
  const w = 320, h = 64, max = Math.max(...points.map((p) => p.value), 1), min = Math.min(...points.map((p) => p.value), 0);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].value;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full"><path d={d} fill="none" stroke="#FFC400" strokeWidth="2" /></svg>
      <div className="font-mono text-xs text-muted">dernier : <span className="text-white">{Math.round(last * 10) / 10}{unit ? ` ${unit}` : ''}</span> · max {Math.round(max * 10) / 10}</div>
    </div>
  );
}
