// Création du premier administrateur (amorçage) : node scripts/create-admin.js <identifiant> <mot_de_passe> [ROLE=SUPER_ADMIN]
const { hash } = require('@node-rs/argon2');
const { Client } = require('pg');
const databaseUrl = require('./database-url');

(async () => {
  const [username, password, role = 'SUPER_ADMIN'] = process.argv.slice(2);
  if (!username || !password) { console.error('Usage: node scripts/create-admin.js <identifiant> <mot_de_passe> [ROLE]'); process.exit(1); }
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.error('Identifiant invalide (3-32 car. : a-z 0-9 . _ -)'); process.exit(1); }
  if (password.length < 12) { console.error('Mot de passe : 12 caractères minimum.'); process.exit(1); }
  const c = new Client({ connectionString: databaseUrl() });
  await c.connect();
  const r = await c.query('SELECT id FROM roles WHERE name=$1', [role]);
  if (!r.rowCount) { console.error(`Rôle inconnu : ${role}`); process.exit(1); }
  const u = await c.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2) RETURNING id', [username, await hash(password)]);
  await c.query('INSERT INTO admin_user_roles VALUES ($1,$2)', [u.rows[0].id, r.rows[0].id]);
  await c.query(`INSERT INTO audit_logs (admin_username, action, resource, details) VALUES ($1,'ADMIN_BOOTSTRAPPED',$2,$3)`,
    [username, `admin_user:${u.rows[0].id}`, JSON.stringify({ role })]);
  console.log(`Administrateur « ${username} » créé avec le rôle ${role}.`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
