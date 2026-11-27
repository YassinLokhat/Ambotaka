'use client';
import { useState } from 'react';
import { Badge, Button, fmt, Notice, Panel, PageHeader, State, Table, Td } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, useApi } from '@/lib/client';

interface User { id: string; username: string; active: boolean; roles: string[]; lastLoginAt: string | null }
interface Role { id: string; name: string; description: string | null; protected: boolean; permissions: string[]; userCount: number }
interface Perm { code: string; description: string }

export default function Admins() {
  const { me, can } = useAuth();
  const users = useApi<{ users: User[] }>('users');
  const roles = useApi<{ roles: Role[] }>(can('admin.roles.read') ? 'roles' : null);
  const perms = useApi<{ permissions: Perm[] }>(can('admin.roles.read') ? 'permissions' : null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [form, setForm] = useState({ username: '', password: '', roles: [] as string[] });
  const [roleForm, setRoleForm] = useState({ name: '', description: '', permissions: [] as string[] });
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const writeUsers = can('admin.users.write'), writeRoles = can('admin.roles.write');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: ok }); await Promise.all([users.reload(), roles.reload()]); }
    catch (e) { setMsg({ kind: 'danger', text: (e as ApiError).message }); }
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <PageHeader title="Administrateurs" subtitle="Comptes, rôles et permissions. Les droits sont revérifiés par l’API à chaque requête." />
      {msg && <div className="mb-4"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="space-y-6">
        <Panel title="Comptes">
          <State loading={users.loading} error={users.error} forbidden={users.forbidden}>
            <Table head={['Identifiant', 'Rôles', 'État', 'Dernière connexion', 'Actions']}>
              {users.data?.users.map((u) => (
                <tr key={u.id}>
                  <Td><span className="font-semibold">{u.username}</span>{u.id === me.id && <span className="ml-2 font-mono text-[11px] text-signal">(vous)</span>}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {(roles.data?.roles ?? []).map((r) => {
                        const has = u.roles.includes(r.name);
                        return writeUsers ? (
                          <button key={r.id} title={has ? 'Retirer ce rôle' : 'Ajouter ce rôle'}
                            onClick={() => { const next = toggle(u.roles, r.name); if (!next.length) return setMsg({ kind: 'danger', text: 'Un administrateur doit avoir au moins un rôle.' });
                              run(() => api(`users/${u.id}`, { method: 'PATCH', body: { roles: next } }), `Rôles de ${u.username} mis à jour.`); }}
                            className={`rounded border px-2 py-0.5 font-mono text-[11px] ${has ? 'border-signal bg-signal/15 text-signal' : 'border-line text-muted hover:text-white'}`}>{r.name}</button>
                        ) : (has ? <Badge key={r.id}>{r.name}</Badge> : null);
                      })}
                      {!roles.data && u.roles.map((r) => <Badge key={r}>{r}</Badge>)}
                    </div>
                  </Td>
                  <Td><Badge value={u.active ? 'DISPONIBLE' : 'INDISPONIBLE'}>{u.active ? 'actif' : 'désactivé'}</Badge></Td>
                  <Td mono>{fmt(u.lastLoginAt)}</Td>
                  <Td>{writeUsers && (
                    <div className="flex gap-2">
                      <Button disabled={u.id === me.id && u.active} onClick={() => run(() => api(`users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), `${u.username} ${u.active ? 'désactivé' : 'réactivé'}.`)}>{u.active ? 'Désactiver' : 'Réactiver'}</Button>
                      <Button onClick={() => { const p = window.prompt(`Nouveau mot de passe pour ${u.username} (12 caractères minimum)`); if (p) run(() => api(`users/${u.id}`, { method: 'PATCH', body: { password: p } }), 'Mot de passe changé ; sessions révoquées.'); }}>Mot de passe</Button>
                    </div>)}</Td>
                </tr>
              ))}
            </Table>
          </State>
        </Panel>

        {writeUsers && (
          <Panel title="Créer un administrateur">
            <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault();
              run(() => api('users', { method: 'POST', body: form }), `Compte « ${form.username} » créé.`).then(() => setForm({ username: '', password: '', roles: [] })); }}>
              <input placeholder="identifiant (a-z, 0-9, . _ -)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              <input type="password" placeholder="mot de passe (12 car. min.)" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
              <Button variant="primary" disabled={!form.roles.length}>Créer</Button>
              <div className="flex flex-wrap gap-3 md:col-span-3">
                {roles.data?.roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.roles.includes(r.name)} onChange={() => setForm({ ...form, roles: toggle(form.roles, r.name) })} />{r.name}</label>
                ))}
              </div>
            </form>
          </Panel>
        )}

        {can('admin.roles.read') && (
          <Panel title="Rôles et permissions">
            <State loading={roles.loading} error={roles.error} forbidden={roles.forbidden}>
              <div className="space-y-3">
                {roles.data?.roles.map((r) => {
                  const cur = draft[r.id] ?? r.permissions;
                  const changed = JSON.stringify([...cur].sort()) !== JSON.stringify([...r.permissions].sort());
                  return (
                    <details key={r.id} className="rounded-lg border border-line bg-panel2">
                      <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
                        <span><span className="font-semibold">{r.name}</span> <span className="text-sm text-muted">· {r.description}</span></span>
                        <span className="font-mono text-xs text-muted">{r.permissions.length} permission(s) · {r.userCount} compte(s){r.protected ? ' · protégé' : ''}</span>
                      </summary>
                      <div className="border-t border-line p-4">
                        <div className="grid gap-2 md:grid-cols-2">
                          {perms.data?.permissions.map((p) => (
                            <label key={p.code} className="flex items-start gap-2 text-sm">
                              <input type="checkbox" disabled={r.protected || !writeRoles} checked={cur.includes(p.code)} onChange={() => setDraft({ ...draft, [r.id]: toggle(cur, p.code) })} />
                              <span><span className="font-mono text-xs">{p.code}</span><br /><span className="text-xs text-muted">{p.description}</span></span>
                            </label>
                          ))}
                        </div>
                        {writeRoles && !r.protected && (
                          <div className="mt-4"><Button variant="primary" disabled={!changed} onClick={() => run(() => api(`roles/${r.id}`, { method: 'PATCH', body: { permissions: cur } }).then(() => setDraft({ ...draft, [r.id]: undefined as never })), `Rôle ${r.name} mis à jour.`)}>Enregistrer les permissions</Button></div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
              {writeRoles && (
                <form className="mt-6 space-y-3 rounded-lg border border-dashed border-line p-4" onSubmit={(e) => { e.preventDefault();
                  run(() => api('roles', { method: 'POST', body: roleForm }), `Rôle « ${roleForm.name} » créé.`).then(() => setRoleForm({ name: '', description: '', permissions: [] })); }}>
                  <div className="font-mono text-xs uppercase tracking-wider text-muted">Nouveau rôle</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input placeholder="NOM_DU_ROLE" value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value.toUpperCase() })} required />
                    <input placeholder="description" value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {perms.data?.permissions.map((p) => (
                      <label key={p.code} className="flex items-center gap-1.5 font-mono text-xs"><input type="checkbox" checked={roleForm.permissions.includes(p.code)} onChange={() => setRoleForm({ ...roleForm, permissions: toggle(roleForm.permissions, p.code) })} />{p.code}</label>
                    ))}
                  </div>
                  <Button variant="primary">Créer le rôle</Button>
                </form>
              )}
            </State>
          </Panel>
        )}
      </div>
    </>
  );
}
