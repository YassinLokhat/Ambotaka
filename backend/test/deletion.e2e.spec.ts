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
import { IncidentsModule } from '../src/modules/incidents/incidents.module';
import { PrivacyModule } from '../src/modules/privacy/privacy.module';
import { RecommendationsModule } from '../src/modules/recommendations/recommendations.module';
import { TrafficModule } from '../src/modules/traffic/traffic.module';

const d = process.env.DATABASE_URL ? describe : describe.skip;

d('Suppression et rejeu (PostgreSQL/PostGIS)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const A = randomUUID(), B = randomUUID();
  const api = () => request(app.getHttpServer());
  const del = (who: string, key: string, types: string[]) =>
    api().post('/deletion-requests').set('x-installation-id', who).send({ idempotencyKey: key, types });
  const pos = { lat: -18.9137, lon: 47.5361 };

  async function seedFor(who: string) {
    await api().put('/consents/statistics').set('x-installation-id', who).send({ granted: true, policyVersion: 'v' }).expect(200);
    const seg = (await db.query(`SELECT id FROM road_segments LIMIT 1`)).rows[0].id;
    await db.query(`INSERT INTO gps_observations (installation_id, client_obs_id, observed_at, segment_id, direction, speed_kph, consent_policy_version)
                    VALUES ($1,$2,now(),$3,1,20,'v')`, [who, randomUUID(), seg]);
    await db.query(`INSERT INTO route_recommendations (installation_id, session_id, expires_at, current_duration_s, current_adjusted_s,
                      proposed_duration_s, proposed_adjusted_s, gain_s, confidence, motif, reasons, proposed_hash)
                    VALUES ($1,'s',now()+interval '1 min',1,1,1,1,1,0.9,'m','[]','h')`, [who]);
  }
  const count = async (table: string, who: string) =>
    (await db.query(`SELECT count(*)::int n FROM ${table} WHERE installation_id=$1`, [who])).rows[0].n;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, ParametersModule,
        PrivacyModule, TrafficModule, IncidentsModule, RecommendationsModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE deletion_requests, route_recommendations, gps_observations, incident_confirmations, reports, incidents, statistical_consents, road_segments, driver_installations CASCADE');
    await db.query(`INSERT INTO road_segments (external_id, length_m, geom, free_flow_kph)
                    VALUES ('x', 100, ST_GeomFromText('LINESTRING(47.52 -18.92, 47.52 -18.919)', 4326), 50)`);
  });
  afterAll(() => app.close());

  it('supprime seulement les types demandés, pour la seule installation appelante, et confirme explicitement', async () => {
    await seedFor(A); await seedFor(B);
    const res = await del(A, randomUUID(), ['GPS_OBSERVATIONS']).expect(200);
    expect(res.body.request).toMatchObject({ status: 'CONFIRMEE', types: ['GPS_OBSERVATIONS'] });
    expect(res.body.request.items).toEqual([{ type: 'GPS_OBSERVATIONS', status: 'CONFIRMEE', deletedCount: 1 }]);
    expect(await count('gps_observations', A)).toBe(0);
    expect(await count('route_recommendations', A)).toBe(1);   // autre catégorie intacte
    expect(await count('gps_observations', B)).toBe(1);        // autre installation intacte
  });

  it('rejeu avec la même clé : même résultat, aucune nouvelle suppression (PRI-005)', async () => {
    await seedFor(A);
    const key = randomUUID();
    const first = await del(A, key, ['GPS_OBSERVATIONS']).expect(200);
    const seg = (await db.query(`SELECT id FROM road_segments LIMIT 1`)).rows[0].id;
    await db.query(`INSERT INTO gps_observations (installation_id, client_obs_id, observed_at, segment_id, direction, speed_kph, consent_policy_version)
                    VALUES ($1,$2,now(),$3,1,30,'v')`, [A, randomUUID(), seg]); // donnée créée APRÈS la demande
    const replay = await del(A, key, ['GPS_OBSERVATIONS']).expect(200);
    expect(replay.body.request.id).toBe(first.body.request.id);
    expect(replay.body.request.completedAt).toBe(first.body.request.completedAt);
    expect(await count('gps_observations', A)).toBe(1);        // pas de seconde suppression destructive
  });

  it('refuse de réutiliser une clé pour une autre demande, et d’accéder à la demande d’autrui (PRI-006)', async () => {
    const key = randomUUID();
    const first = await del(A, key, ['GPS_OBSERVATIONS']).expect(200);
    expect((await del(A, key, ['RECOMMENDATIONS']).expect(422)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await api().get(`/deletion-requests/${first.body.request.id}`).set('x-installation-id', B).expect(404);
    await api().get(`/deletion-requests/${first.body.request.id}`).set('x-installation-id', A).expect(200);
    const list = await api().get('/deletion-requests').set('x-installation-id', A).expect(200);
    expect(list.body.requests).toHaveLength(1);
  });

  it('valide les types demandés', async () => {
    await del(A, randomUUID(), []).expect(400);
    await del(A, randomUUID(), ['TOUT_CASSER']).expect(400);
    await del(A, 'pas-un-uuid', ['ALL']).expect(400);
  });

  it('ALL : efface les contributions, recalcule les incidents et supprime l’installation', async () => {
    await seedFor(A);
    const rep = await api().post('/reports').set('x-installation-id', A).send({ type: 'ACCIDENT', ...pos }).expect(201);
    const incidentId = rep.body.report.incidentId;
    await api().post('/reports').set('x-installation-id', B).send({ type: 'ACCIDENT', ...pos }).expect(201);
    expect((await db.query('SELECT reporter_count FROM incidents WHERE id=$1', [incidentId])).rows[0].reporter_count).toBe(2);

    const res = await del(A, randomUUID(), ['ALL']).expect(200);
    expect(res.body.request).toMatchObject({ status: 'CONFIRMEE', installationRemoved: true });
    expect(res.body.request.items.map((i: any) => i.type).sort()).toEqual(['GPS_OBSERVATIONS', 'INCIDENT_CONTRIBUTIONS', 'RECOMMENDATIONS']);
    expect((await db.query('SELECT count(*)::int n FROM driver_installations WHERE id=$1', [A])).rows[0].n).toBe(0);
    const inc = (await db.query('SELECT reporter_count, status FROM incidents WHERE id=$1', [incidentId])).rows[0];
    expect(inc.reporter_count).toBe(1);                         // le déclarant B subsiste
    expect(inc.status).not.toBe('EXPIRE');
    expect(await count('reports', B)).toBe(1);

    // incident dont l'unique déclarant se supprime : il expire
    const solo = await api().post('/reports').set('x-installation-id', B).send({ type: 'TRAVAUX', lat: -18.95, lon: 47.55 }).expect(201);
    await del(B, randomUUID(), ['INCIDENT_CONTRIBUTIONS']).expect(200);
    expect((await db.query('SELECT status FROM incidents WHERE id=$1', [solo.body.report.incidentId])).rows[0].status).toBe('EXPIRE');
  });

  it('signalement rejoué avec le même clientReportId : un seul signalement (file hors ligne)', async () => {
    const clientReportId = randomUUID();
    const body = { type: 'DANGER', ...pos, clientReportId };
    const first = await api().post('/reports').set('x-installation-id', A).send(body).expect(201);
    const again = await api().post('/reports').set('x-installation-id', A).send(body).expect(201);
    expect(again.body.report.id).toBe(first.body.report.id);
    expect(again.body.report.replayed).toBe(true);
    expect(await count('reports', A)).toBe(1);
    expect(again.body.incident.reporterCount).toBe(1);
  });
});
