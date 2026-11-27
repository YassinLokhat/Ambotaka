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
import { PrivacyModule } from '../src/modules/privacy/privacy.module';
import { TrafficModule } from '../src/modules/traffic/traffic.module';
import { AggregationService } from '../src/modules/traffic/aggregation.service';

const d = process.env.DATABASE_URL ? describe : describe.skip;

d('Trafic communautaire (PostgreSQL/PostGIS)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let agg: AggregationService;
  const on = { lon: 47.52, lat: -18.9195 };       // sur le segment bidirectionnel
  const onOneway = { lon: 47.53, lat: -18.9195 }; // sur le segment à sens unique
  const off = { lon: 47.60, lat: -18.80 };
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  const api = () => request(app.getHttpServer());
  const consent = (who: string, granted: boolean) =>
    api().put('/consents/statistics').set('x-installation-id', who).send({ granted, policyVersion: 'test-v1' });
  const obs = (over: object = {}) => ({
    clientObsId: randomUUID(), observedAt: new Date().toISOString(), ...on,
    accuracyMeters: 8, speedMps: 5, headingDeg: 0, ...over,
  });
  const send = (who: string, observations: object[]) =>
    api().post('/traffic-observations').set('x-installation-id', who).send({ observations, appVersion: '0.1.0' });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, ParametersModule, PrivacyModule, TrafficModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService);
    agg = app.get(AggregationService);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE traffic_statistics, gps_observations, statistical_consents, road_segments, driver_installations CASCADE');
    await db.query(`INSERT INTO road_segments (external_id, name, length_m, geom, oneway, free_flow_kph) VALUES
      ('t-two', 'Rue bidirectionnelle', 111, ST_GeomFromText('LINESTRING(47.52 -18.92, 47.52 -18.919)', 4326), false, 50),
      ('t-one', 'Rue à sens unique',    111, ST_GeomFromText('LINESTRING(47.53 -18.92, 47.53 -18.919)', 4326), true, 50)`);
  });
  afterAll(() => app.close());

  it('refuse toute observation sans consentement actif (TRF-004)', async () => {
    const res = await send(ids[0], [obs()]).expect(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    await consent(ids[0], false).expect(200);
    await send(ids[0], [obs()]).expect(403);
  });

  it('accepte, déduplique, et ne conserve aucune coordonnée brute', async () => {
    await consent(ids[0], true).expect(200);
    const o = obs();
    expect((await send(ids[0], [o]).expect(200)).body).toMatchObject({ accepted: 1, duplicates: 0 });
    expect((await send(ids[0], [o]).expect(200)).body).toMatchObject({ accepted: 0, duplicates: 1 });
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='gps_observations'`);
    const names: string[] = cols.rows.map((r) => r.column_name);
    expect(names.filter((n) => /^(lat|lon|latitude|longitude|geom|heading|position)/.test(n))).toEqual([]);
  });

  it('rejette les observations invalides avec un motif (TRF-006)', async () => {
    await consent(ids[0], true).expect(200);
    const res = await send(ids[0], [
      obs({ ...off }), obs({ accuracyMeters: 80 }), obs({ speedMps: 60 }),
      obs({ observedAt: new Date(Date.now() - 3600_000).toISOString() }),
      obs({ ...onOneway, headingDeg: 180 }), obs({ ...onOneway, headingDeg: 5 }),
    ]).expect(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected.map((r: any) => r.reason).sort()).toEqual(
      ['INVALID_ACCURACY', 'NO_ROAD_MATCH', 'SPEED_OUT_OF_RANGE', 'TIMESTAMP_INVALID', 'WRONG_DIRECTION']);
  });

  it('valide le format du lot', async () => {
    await consent(ids[0], true).expect(200);
    await send(ids[0], []).expect(400);
    await send(ids[0], [{ ...obs(), lat: 999 }]).expect(400);
  });

  it('publie un agrégat seulement à partir de 3 contributeurs, avec source/fraîcheur/confiance (TRF-002/008/012)', async () => {
    const at = new Date().toISOString();
    for (const who of ids.slice(0, 2)) {
      await consent(who, true).expect(200);
      await send(who, [obs({ observedAt: at }), obs({ observedAt: at }), obs({ observedAt: at })]).expect(200);
    }
    expect(await agg.aggregate()).toBe(0); // 2 contributeurs : insuffisant
    const none = await api().get('/traffic').query({ ...{ lat: on.lat, lon: on.lon } }).expect(200);
    expect(none.body).toMatchObject({ status: 'DONNEES_INSUFFISANTES', segments: [] });

    await consent(ids[2], true).expect(200);
    await send(ids[2], [obs({ observedAt: at }), obs({ observedAt: at })]).expect(200);
    expect(await agg.aggregate()).toBe(1);
    const res = await api().get('/traffic').query({ lat: on.lat, lon: on.lon }).expect(200);
    expect(res.body.status).toBe('OK');
    const seg = res.body.segments[0];
    expect(seg).toMatchObject({ state: 'CONGESTIONNE', source: 'CROWDSOURCED_GPS', direction: 1, sampleCount: 8, meanSpeedKph: 18 });
    expect(seg.confidence).toBeGreaterThan(0);
    expect(new Date(seg.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toMatch(/installation|contributor/i);
  });

  it('retrait du consentement : suppression des observations brutes, arrêt des contributions, idempotent (TRF-009)', async () => {
    await consent(ids[0], true).expect(200);
    await send(ids[0], [obs()]).expect(200);
    await consent(ids[1], true).expect(200);
    await send(ids[1], [obs()]).expect(200);
    expect((await db.query('SELECT count(*)::int n FROM gps_observations')).rows[0].n).toBe(2);

    await consent(ids[0], false).expect(200);
    await consent(ids[0], false).expect(200); // rejouable
    const left = await db.query('SELECT installation_id FROM gps_observations');
    expect(left.rows.map((r) => r.installation_id)).toEqual([ids[1]]); // seules les données de l'autre installation restent
    await send(ids[0], [obs()]).expect(403);
    const state = await api().get('/consents').set('x-installation-id', ids[0]).expect(200);
    expect(state.body.statistics.granted).toBe(false);
    const history = await db.query('SELECT count(*)::int n FROM statistical_consents WHERE installation_id=$1', [ids[0]]);
    expect(history.rows[0].n).toBe(2); // décision initiale + retrait, sans doublon du rejeu
  });
});
