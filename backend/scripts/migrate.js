// Exécute les migrations SQL versionnées de /migrations, une transaction par fichier.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://roadpulse:roadpulse@localhost:5432/roadpulse',
  });
  await client.connect();
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`Applying ${f}... `);
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('FAILED\n', e.message);
      process.exit(1);
    }
  }
  await client.end();
})();
