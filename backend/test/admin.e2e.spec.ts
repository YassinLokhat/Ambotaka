import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import configuration from '../src/shared/config/configuration';
import { DatabaseModule } from '../src/shared/database/database.module';
import { DatabaseService } from '../src/shared/database/database.service';
import { AllExceptionsFilter } from '../src/shared/filters/http-exception.filter';
import { ParametersModule } from '../src/shared/parameters/parameters.module';
import { ParametersService } from '../src/shared/parameters/parameters.service';
import { RedisModule } from '../src/shared/redis/redis.module';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { AdminAuthService } from '../src/modules/administration/admin-auth.service';
import { MonitoringModule } from '../src/modules/monitoring/monitoring.module';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { Sample } from '../src/modules/monitoring/monitor-rules';

const d = process.env.DATABASE_URL ? describe : describe.skip;
const PW = 'un-mot-de-passe-solide-1';

d('Administration et supervision (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let auth: AdminAuthService;
  let mon: MonitoringService;
  const api = () => request(app.getHttpServer());
  const rid = () => randomUUID().slice(0, 8);

  async function makeAdmin(role: string, username = `u-${rid()}`) {
    const id = (await db.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2) RETURNING id', [username, await auth.hashPassword(PW)])).rows[0].id;
    await db.query('INSERT INTO admin_user_roles SELECT $1, id FROM roles WHERE name=$2', [id, role]);
    return { id, username };
  }
  const login = (username: string, password = PW) => api().post('/admin/auth/login').send({ username, password });
  async function token(role: string) {
    const u = await makeAdmin(role);
    const res = await login(u.username).expect(200);
    return { ...u, access: res.body.accessToken as string, refresh: res.body.refreshToken as string };
  }
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const auditCount = async (action: string, username?: string) =>
    (await db.query(`SELECT count(*)::int n FROM audit_logs WHERE action=$1 AND ($2::text IS NULL OR admin_username=$2)`, [action, username ?? null])).rows[0].n;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, RedisModule, ParametersModule, AdministrationModule, MonitoringModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService); auth = app.get(AdminAuthService); mon = app.get(MonitoringService);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE admin_users, authentication_attempts, technical_incidents, configuration_history CASCADE');
    await db.query(`DELETE FROM roles WHERE name LIKE 'TEST_%'`);
  });
  afterAll(() => app.close());

  describe('authentification', () => {
    it('connexion, jetons et permissions ; échec identique pour compte inconnu ou mauvais mot de passe', async () => {
      const u = await makeAdmin('SUPER_ADMIN');
      const ok = await login(u.username).expect(200);
      expect(ok.body.admin.permissions).toContain('admin.users.write');
      expect(ok.body.refreshToken.length).toBeGreaterThan(40);
      const bad = await login(u.username, 'mauvais-mot-de-passe').expect(401);
      const unknown = await login(`inconnu-${rid()}`).expect(401);
      expect(bad.body.code).toBe('INVALID_CREDENTIALS');
      expect({ ...unknown.body, requestId: 0 }).toEqual({ ...bad.body, requestId: 0 });
      expect(await auditCount('LOGIN_SUCCEEDED', u.username)).toBe(1);
      expect(await auditCount('LOGIN_FAILED', u.username)).toBe(1);
    });

    it('verrouille après 5 échecs, même avec le bon mot de passe, et aussi pour un identifiant inexistant', async () => {
      const u = await makeAdmin('OPERATEUR');
      for (let i = 0; i < 5; i++) await login(u.username, 'faux-faux-faux').expect(401);
      const locked = await login(u.username).expect(429);
      expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
      const ghost = `fantome-${rid()}`;
      for (let i = 0; i < 5; i++) await login(ghost, 'x').expect(401);
      await login(ghost, 'x').expect(429); // pas de différence observable selon l'existence du compte
      expect(await auditCount('LOGIN_LOCKED', u.username)).toBe(1);
    });

    it('exige un jeton valide ; refuse un jeton altéré', async () => {
      await api().get('/admin/users').expect(401);
      const t = await token('SUPER_ADMIN');
      await api().get('/admin/users').set(as(t.access.slice(0, -3) + 'abc')).expect(401);
      await api().get('/admin/users').set(as(t.access)).expect(200);
    });

    it('déconnexion : invalide la session côté serveur (jeton d’accès ET de rafraîchissement) — ADM-005', async () => {
      const t = await token('OPERATEUR');
      await api().post('/admin/auth/logout').set(as(t.access)).expect(204);
      expect((await api().get('/admin/auth/me').set(as(t.access)).expect(401)).body.code).toBe('SESSION_ENDED');
      await api().post('/admin/auth/refresh').send({ refreshToken: t.refresh }).expect(401);
      expect(await auditCount('LOGOUT', t.username)).toBe(1);
    });

    it('rafraîchissement rotatif : l’ancien jeton rejoué révoque la session', async () => {
      const t = await token('OPERATEUR');
      const r1 = await api().post('/admin/auth/refresh').send({ refreshToken: t.refresh }).expect(200);
      expect(r1.body.refreshToken).not.toBe(t.refresh);
      await api().get('/admin/auth/me').set(as(r1.body.accessToken)).expect(200);
      await api().post('/admin/auth/refresh').send({ refreshToken: t.refresh }).expect(401); // rejeu de l'ancien
      await api().get('/admin/auth/me').set(as(r1.body.accessToken)).expect(401);            // session révoquée
      await api().post('/admin/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
      expect(await auditCount('REFRESH_REUSE_DETECTED', t.username)).toBe(1);
    });
  });

  describe('autorisation et gestion', () => {
    it('refuse sans permission (403) et journalise le refus ; autorise le super administrateur', async () => {
      const op = await token('OPERATEUR');
      const res = await api().get('/admin/users').set(as(op.access)).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await auditCount('PERMISSION_DENIED', op.username)).toBe(1);
      await api().get('/admin/metrics').query({ name: 'api.p95_ms' }).set(as(op.access)).expect(200);
      await api().get('/admin/audit-logs').set(as(op.access)).expect(403);
    });

    it('création d’administrateur : validation, unicité, audit sans mot de passe', async () => {
      const sa = await token('SUPER_ADMIN');
      const name = `neuf-${rid()}`;
      await api().post('/admin/users').set(as(sa.access)).send({ username: name, password: 'court', roles: ['AUDITEUR'] }).expect(400);
      await api().post('/admin/users').set(as(sa.access)).send({ username: name, password: PW, roles: ['ROLE_INCONNU'] }).expect(422);
      await api().post('/admin/users').set(as(sa.access)).send({ username: name, password: PW, roles: ['AUDITEUR'] }).expect(201);
      await api().post('/admin/users').set(as(sa.access)).send({ username: name, password: PW, roles: ['AUDITEUR'] }).expect(409);
      await login(name).expect(200);
      const entry = (await db.query(`SELECT details::text AS d FROM audit_logs WHERE action='USER_CREATED' AND details->>'username'=$1`, [name])).rows[0];
      expect(entry.d).not.toContain(PW);
    });

    it('protège contre la perte du dernier super administrateur et l’auto-désactivation', async () => {
      const sa = await token('SUPER_ADMIN');
      await api().patch(`/admin/users/${sa.id}`).set(as(sa.access)).send({ active: false }).expect(409);
      const r = await api().patch(`/admin/users/${sa.id}`).set(as(sa.access)).send({ roles: ['AUDITEUR'] }).expect(409);
      expect(r.body.code).toBe('LAST_SUPER_ADMIN');
      const second = await makeAdmin('SUPER_ADMIN');
      await api().patch(`/admin/users/${sa.id}`).set(as(sa.access)).send({ roles: ['AUDITEUR'] }).expect(200); // OK : un autre reste
      void second;
    });

    it('désactivation et changement de mot de passe coupent immédiatement les sessions', async () => {
      const sa = await token('SUPER_ADMIN');
      const victim = await token('OPERATEUR');
      await api().patch(`/admin/users/${victim.id}`).set(as(sa.access)).send({ password: 'nouveau-mot-de-passe-2' }).expect(200);
      await api().get('/admin/auth/me').set(as(victim.access)).expect(401);
      await login(victim.username).expect(401);
      await login(victim.username, 'nouveau-mot-de-passe-2').expect(200);
      await api().patch(`/admin/users/${victim.id}`).set(as(sa.access)).send({ active: false }).expect(200);
      await login(victim.username, 'nouveau-mot-de-passe-2').expect(401);
    });

    it('rôles : permissions inconnues refusées, rôle protégé immuable, effet immédiat sur les droits', async () => {
      const sa = await token('SUPER_ADMIN');
      await api().post('/admin/roles').set(as(sa.access)).send({ name: 'TEST_LECTEUR', permissions: ['admin.nope'] }).expect(422);
      const created = await api().post('/admin/roles').set(as(sa.access)).send({ name: 'TEST_LECTEUR', permissions: ['admin.audit.read'] }).expect(201);
      const roles = (await api().get('/admin/roles').set(as(sa.access)).expect(200)).body.roles;
      const superRole = roles.find((r: any) => r.name === 'SUPER_ADMIN');
      await api().patch(`/admin/roles/${superRole.id}`).set(as(sa.access)).send({ permissions: [] }).expect(409);

      const u = await makeAdmin('TEST_LECTEUR');
      const t = (await login(u.username).expect(200)).body.accessToken;
      await api().get('/admin/audit-logs').set(as(t)).expect(200);
      await api().get('/admin/configuration').set(as(t)).expect(403);
      await api().patch(`/admin/roles/${created.body.id}`).set(as(sa.access)).send({ permissions: ['admin.config.read'] }).expect(200);
      await api().get('/admin/configuration').set(as(t)).expect(200);  // même jeton : droits relus à chaque requête
      await api().get('/admin/audit-logs').set(as(t)).expect(403);
    });
  });

  describe('configuration', () => {
    it('modifie en base avec historique, audit (ancienne/nouvelle valeur) et prise en compte immédiate', async () => {
      const sa = await token('SUPER_ADMIN');
      const before = (await app.get(ParametersService).get())['incident.matchRadiusMeters'];
      await api().patch('/admin/configuration').set(as(sa.access)).send({ changes: [{ key: 'incident.matchRadiusMeters', value: 222 }] }).expect(200);
      expect((await app.get(ParametersService).get())['incident.matchRadiusMeters']).toBe(222);
      const hist = (await db.query(`SELECT old_value, new_value FROM configuration_history WHERE key='incident.matchRadiusMeters'`)).rows[0];
      expect([hist.old_value, hist.new_value]).toEqual([before, 222]);
      const audit = (await db.query(`SELECT details FROM audit_logs WHERE action='CONFIG_CHANGED' AND admin_username=$1`, [sa.username])).rows[0];
      expect(audit.details.changes[0]).toMatchObject({ key: 'incident.matchRadiusMeters', from: before, to: 222 });
      await api().patch('/admin/configuration').set(as(sa.access)).send({ changes: [{ key: 'incident.matchRadiusMeters', value: before }] }).expect(200);
    });

    it('valide : clé inconnue, proportion > 1, et reste atomique', async () => {
      const sa = await token('SUPER_ADMIN');
      const cur = (await app.get(ParametersService).get())['incident.matchRadiusMeters'];
      await api().patch('/admin/configuration').set(as(sa.access)).send({ changes: [{ key: 'inconnu.cle', value: 1 }] }).expect(422);
      await api().patch('/admin/configuration').set(as(sa.access)).send({
        changes: [{ key: 'incident.matchRadiusMeters', value: 999 }, { key: 'monitor.errorRate', value: 7 }] }).expect(422);
      app.get(ParametersService).invalidate();
      expect((await app.get(ParametersService).get())['incident.matchRadiusMeters']).toBe(cur); // rien d'appliqué
      await api().patch('/admin/configuration').set(as(sa.access)).send({ changes: [{ key: 'incident.matchRadiusMeters', value: -1 }] }).expect(400);
    });
  });

  describe('audit', () => {
    it('pagination par curseur et filtres', async () => {
      const sa = await token('SUPER_ADMIN');
      const p1 = (await api().get('/admin/audit-logs').query({ limit: 2 }).set(as(sa.access)).expect(200)).body;
      expect(p1.entries).toHaveLength(2);
      expect(p1.nextCursor).toBeTruthy();
      const p2 = (await api().get('/admin/audit-logs').query({ limit: 2, cursor: p1.nextCursor }).set(as(sa.access)).expect(200)).body;
      expect(p2.entries[0].id).toBeLessThan(p1.entries[1].id);
      const f = (await api().get('/admin/audit-logs').query({ action: 'LOGIN_SUCCEEDED', admin: sa.username }).set(as(sa.access)).expect(200)).body;
      expect(f.entries.every((e: any) => e.action === 'LOGIN_SUCCEEDED' && e.adminUsername === sa.username)).toBe(true);
    });

    it('est en ajout seul : UPDATE, DELETE et TRUNCATE sont refusés par la base', async () => {
      const sa = await token('SUPER_ADMIN');
      void sa;
      await expect(db.query(`UPDATE audit_logs SET action='X'`)).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
      await expect(db.query(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);
    });
  });

  describe('modération et vues agrégées', () => {
    async function insertIncident() {
      return (await db.query(`INSERT INTO incidents (type, status, geom, confidence, expires_at)
        VALUES ('ACCIDENT','CONFIRME', ST_SetSRID(ST_MakePoint(47.52,-18.92),4326), 0.8, now() + interval '30 min') RETURNING id`)).rows[0].id as string;
    }
    it('l’opérateur clôt un incident (audité) ; l’auditeur ne le peut pas ; pas de double clôture', async () => {
      const op = await token('OPERATEUR'), au = await token('AUDITEUR');
      const id = await insertIncident();
      await api().patch(`/admin/community/incidents/${id}`).set(as(au.access)).send({ action: 'RESOLVE' }).expect(403);
      await api().patch(`/admin/community/incidents/${id}`).set(as(op.access)).send({ action: 'RESOLVE' }).expect(200);
      await api().patch(`/admin/community/incidents/${id}`).set(as(op.access)).send({ action: 'EXPIRE' }).expect(409);
      expect((await db.query('SELECT status FROM incidents WHERE id=$1', [id])).rows[0].status).toBe('RESOLU');
      expect(await auditCount('COMMUNITY_INCIDENT_MODERATED', op.username)).toBe(1);
      const list = (await api().get('/admin/community/incidents').query({ status: 'RESOLU' }).set(as(op.access)).expect(200)).body.incidents;
      expect(JSON.stringify(list)).not.toMatch(/installation/i);
    });
    it('résumés de trafic et de suppressions : agrégés, sans donnée individuelle', async () => {
      const op = await token('OPERATEUR');
      const t = (await api().get('/admin/traffic/summary').set(as(op.access)).expect(200)).body;
      expect(t).toHaveProperty('freshSegmentsByState');
      expect(JSON.stringify(t)).not.toMatch(/lat|lon|position/i);
      const dl = (await api().get('/admin/privacy/deletions').set(as(op.access)).expect(200)).body;
      expect(dl).toHaveProperty('byStatus');
    });
  });

  describe('supervision (MON-001..004)', () => {
    const healthy: Sample = {
      dbUp: true, redisUp: true, dbLatencyMs: 4, requests: 100, errors5xx: 0, p95Ms: 100, recentObservations: 0,
      aggregationLagSeconds: null, stuckDeletions: 0, activeCommunityIncidents: 0, freshTrafficSegments: 0,
    };
    const incidents = async (rule: string) => (await db.query(`SELECT * FROM technical_incidents WHERE rule=$1 ORDER BY opened_at`, [rule])).rows;
    const alerts = async () => (await db.query('SELECT count(*)::int n FROM technical_alerts')).rows[0].n;

    it('cycle complet : ouverture + alerte, actualisation sans doublon, clôture automatique sur preuve de rétablissement', async () => {
      await mon.process({ ...healthy, requests: 100, errors5xx: 30 });
      let inc = await incidents('API_ERROR_RATE');
      expect(inc).toHaveLength(1);
      expect(inc[0]).toMatchObject({ severity: 'CRITIQUE', status: 'OUVERT', service: 'api' });
      expect(await alerts()).toBe(1);

      await mon.process({ ...healthy, requests: 100, errors5xx: 40 });
      inc = await incidents('API_ERROR_RATE');
      expect(inc).toHaveLength(1);
      expect(inc[0].occurrences).toBe(2);
      expect(await alerts()).toBe(1);                       // pas d'alerte en double

      await mon.process({ ...healthy, requests: 3, errors5xx: 0 });  // trop peu de requêtes : pas une preuve de rétablissement
      expect((await incidents('API_ERROR_RATE'))[0].status).toBe('OUVERT');

      await mon.process({ ...healthy, requests: 100, errors5xx: 0 });
      inc = await incidents('API_ERROR_RATE');
      expect(inc[0]).toMatchObject({ status: 'RESOLU', resolved_by: 'système' });
    });

    it('panne de base : consignée au rétablissement', async () => {
      await mon.process({ ...healthy, dbUp: false, dbLatencyMs: null });
      await mon.process({ ...healthy, dbUp: false, dbLatencyMs: null });
      expect(await incidents('DB_DOWN')).toHaveLength(0); // impossible d'écrire pendant la panne
      await mon.process(healthy);
      const inc = await incidents('DB_DOWN');
      expect(inc).toHaveLength(1);
      expect(inc[0]).toMatchObject({ severity: 'CRITIQUE', status: 'RESOLU' });
    });

    it('les administrateurs autorisés traitent incidents et alertes (transitions contrôlées, audit)', async () => {
      await mon.process({ ...healthy, stuckDeletions: 2 });
      const op = await token('OPERATEUR'), au = await token('AUDITEUR');
      const list = (await api().get('/admin/technical-incidents').set(as(au.access)).expect(200)).body.incidents;
      expect(list[0]).toMatchObject({ rule: 'DELETION_STUCK', status: 'OUVERT' });
      await api().patch(`/admin/technical-incidents/${list[0].id}`).set(as(au.access)).send({ status: 'EN_COURS' }).expect(403);
      await api().patch(`/admin/technical-incidents/${list[0].id}`).set(as(op.access)).send({ status: 'CLOTURE' }).expect(409);
      await api().patch(`/admin/technical-incidents/${list[0].id}`).set(as(op.access)).send({ status: 'EN_COURS' }).expect(200);
      await api().patch(`/admin/technical-incidents/${list[0].id}`).set(as(op.access)).send({ status: 'RESOLU' }).expect(200);

      const al = (await api().get('/admin/alerts').query({ acknowledged: false }).set(as(au.access)).expect(200)).body.alerts;
      expect(al).toHaveLength(1);
      const a1 = await api().patch(`/admin/alerts/${al[0].id}/acknowledge`).set(as(op.access)).expect(200);
      const a2 = await api().patch(`/admin/alerts/${al[0].id}/acknowledge`).set(as(op.access)).expect(200);
      expect(a2.body.acknowledgedAt).toBe(a1.body.acknowledgedAt);   // idempotent
      expect((await api().get('/admin/alerts').query({ acknowledged: false }).set(as(op.access)).expect(200)).body.alerts).toHaveLength(0);
      expect(await auditCount('TECH_INCIDENT_UPDATED', op.username)).toBe(2);
      expect(await auditCount('ALERT_ACKNOWLEDGED', op.username)).toBeGreaterThanOrEqual(1);
    });

    it('santé des services, métriques persistées et export Prometheus', async () => {
      await mon.process(healthy);
      const op = await token('OPERATEUR');
      const s = (await api().get('/admin/services').set(as(op.access)).expect(200)).body;
      expect(s.services.map((x: any) => x.name)).toEqual(expect.arrayContaining(['postgres', 'api', 'aggregation']));
      const m = (await api().get('/admin/metrics').query({ name: 'api.p95_ms', minutes: 60 }).set(as(op.access)).expect(200)).body;
      expect(m.points.length).toBeGreaterThan(0);

      const prom = await api().get('/metrics').expect(200);
      expect(prom.text).toContain('roadpulse_http_request_duration_seconds');
      expect(prom.text).toContain('roadpulse_service_up');
      process.env.METRICS_TOKEN = 'secret-prom';
      await api().get('/metrics').expect(401);
      await api().get('/metrics').set('Authorization', 'Bearer secret-prom').expect(200);
      delete process.env.METRICS_TOKEN;
    });
  });
});
