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

// Test d'intégration : nécessite PostgreSQL + PostGIS (migrations appliquées) via DATABASE_URL.
const d = process.env.DATABASE_URL ? describe : describe.skip;

d('Incidents (PostgreSQL/PostGIS)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const base = { lat: -18.9137, lon: 47.5361 };
  const near = { lat: -18.9140, lon: 47.5363 };   // ~40 m
  const far = { lat: -18.9300, lon: 47.5361 };    // ~1,8 km
  const post = (path: string, who: string | null, body: object) => {
    const r = request(app.getHttpServer()).post(path);
    if (who) r.set('x-installation-id', who);
    return r.send(body);
  };
  const report = (who: string, type: string, pos = base) => post('/reports', who, { type, ...pos });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, ParametersModule, IncidentsModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService);
  });
  beforeEach(() => db.query('TRUNCATE incident_confirmations, reports, incidents, driver_installations CASCADE'));
  afterAll(() => app.close());

  it('crée un incident DETECTE au premier signalement', async () => {
    const res = await report(A, 'ACCIDENT').expect(201);
    expect(res.body.incident).toMatchObject({ status: 'DETECTE', confidence: 0.25, reporterCount: 1, myResponse: 'REPORTER' });
    expect(res.body.report.mergedIntoExisting).toBe(false);
  });

  it('rapproche un 2e déclarant proche et confirme l’incident ; ignore le doublon du même déclarant', async () => {
    const first = await report(A, 'ACCIDENT').expect(201);
    const second = await report(B, 'ACCIDENT', near).expect(201);
    expect(second.body.report.incidentId).toBe(first.body.report.incidentId);
    expect(second.body.incident).toMatchObject({ status: 'CONFIRME', reporterCount: 2 });
    const again = await report(A, 'ACCIDENT').expect(201);
    expect(again.body.incident.reporterCount).toBe(2);
  });

  it('crée des incidents distincts si lointain ou de type différent', async () => {
    const a = await report(A, 'ACCIDENT').expect(201);
    const b = await report(B, 'ACCIDENT', far).expect(201);
    const c = await report(C, 'TRAVAUX', near).expect(201);
    expect(new Set([a.body.report.incidentId, b.body.report.incidentId, c.body.report.incidentId]).size).toBe(3);
  });

  it('une seule réponse par installation ; le déclarant ne peut pas confirmer son propre incident (INC-006)', async () => {
    const { body } = await report(A, 'DANGER').expect(201);
    const id = body.report.incidentId;
    await post(`/incidents/${id}/confirmations`, A, { kind: 'CONFIRMATION' }).expect(409);
    const ok = await post(`/incidents/${id}/confirmations`, B, { kind: 'CONFIRMATION' }).expect(201);
    expect(ok.body.incident).toMatchObject({ status: 'CONFIRME', confirmationCount: 1, myResponse: 'CONFIRMATION' });
    const dup = await post(`/incidents/${id}/confirmations`, B, { kind: 'CONTESTATION' }).expect(409);
    expect(dup.body.code).toBe('ALREADY_RESPONDED');
  });

  it('deux contestations font expirer un incident à un seul déclarant', async () => {
    const id = (await report(A, 'EMBOUTEILLAGE').expect(201)).body.report.incidentId;
    await post(`/incidents/${id}/confirmations`, B, { kind: 'CONTESTATION' }).expect(201);
    const last = await post(`/incidents/${id}/confirmations`, C, { kind: 'CONTESTATION' }).expect(201);
    expect(last.body.incident.status).toBe('EXPIRE');
    const late = await post(`/incidents/${id}/confirmations`, randomUUID(), { kind: 'CONFIRMATION' }).expect(409);
    expect(late.body.code).toBe('INCIDENT_NOT_ACTIVE');
  });

  it('liste par proximité, triée, sans les incidents expirés', async () => {
    await report(A, 'ACCIDENT').expect(201);
    await report(B, 'TRAVAUX', far).expect(201);
    const res = await request(app.getHttpServer()).get('/incidents').query({ ...base, radiusMeters: 5000 })
      .set('x-installation-id', A).expect(200);
    expect(res.body.incidents.map((i: any) => i.type)).toEqual(['ACCIDENT', 'TRAVAUX']);
    expect(res.body.incidents[0].myResponse).toBe('REPORTER');
    const small = await request(app.getHttpServer()).get('/incidents').query({ ...base, radiusMeters: 500 }).expect(200);
    expect(small.body.incidents).toHaveLength(1);
    await db.query(`UPDATE incidents SET expires_at = now() - interval '1 minute'`);
    const none = await request(app.getHttpServer()).get('/incidents').query(base).expect(200);
    expect(none.body.incidents).toHaveLength(0);
  });

  it('valide les entrées et exige l’identifiant d’installation', async () => {
    await post('/reports', null, { type: 'ACCIDENT', ...base }).expect(401);
    await post('/reports', A, { type: 'INCONNU', ...base }).expect(400);
    await post('/reports', A, { type: 'ACCIDENT', lat: 120, lon: 0 }).expect(400);
    const old = new Date(Date.now() - 3600_000).toISOString();
    const res = await post('/reports', A, { type: 'ACCIDENT', ...base, observedAt: old }).expect(422);
    expect(res.body.code).toBe('REPORT_TIMESTAMP_INVALID');
  });

  it('limite le nombre de signalements par installation', async () => {
    for (let i = 0; i < 5; i++) await report(A, 'DANGER').expect(201);
    const res = await report(A, 'DANGER').expect(429);
    expect(res.body.code).toBe('REPORT_RATE_LIMITED');
  });
});
