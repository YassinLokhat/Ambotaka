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
import { ROUTING_PROVIDER } from '../src/modules/navigation/providers/types';
import { RecommendationsModule } from '../src/modules/recommendations/recommendations.module';

const d = process.env.DATABASE_URL ? describe : describe.skip;
const LAT0 = -18.92, STEP = 0.00135; // ~150 m par tronçon
const line = (lon: number, n = 14): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [lon, LAT0 + i * STEP]);
const route = (id: string, lon: number, d: number, t: number) => ({
  id, distanceMeters: d, durationSeconds: t, steps: [], geometry: { type: 'LineString' as const, coordinates: line(lon) },
});

d('Recommandations (PostgreSQL/PostGIS)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const fake = { name: 'fake', trafficAware: false, calculateRoutes: jest.fn() };
  const inst = () => randomUUID();
  const api = () => request(app.getHttpServer());
  const position = { lat: LAT0, lon: 47.52 };
  const destination = { lat: LAT0 + 14 * STEP, lon: 47.52 };
  const body = (sessionId = 's1', current = line(47.52)) => ({ sessionId, position, destination, currentRoute: current });
  const evaluate = (who: string, b = body()) => api().post('/recommendations/evaluate').set('x-installation-id', who).send(b);

  async function seedTraffic(confidence = 0.8, validMinutes = 10) {
    for (let i = 0; i < 14; i++) {
      const id = (await db.query(
        `INSERT INTO road_segments (external_id, name, length_m, geom, free_flow_kph)
         VALUES ($1,'tronçon',150, ST_GeomFromText($2,4326), 50) RETURNING id`,
        [`r-${i}`, `LINESTRING(47.52 ${LAT0 + i * STEP}, 47.52 ${LAT0 + (i + 1) * STEP})`])).rows[0].id;
      await db.query(
        `INSERT INTO traffic_statistics (segment_id, direction, window_start, window_end, mean_speed_kph, median_speed_kph,
           sample_count, contributor_count, confidence, state, valid_until)
         VALUES ($1, 1, now() - interval '5 min', now(), 8, 8, 12, 5, $2, 'CONGESTIONNE', now() + make_interval(mins => $3))`,
        [id, confidence, validMinutes]);
    }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, ParametersModule, RecommendationsModule],
    }).overrideProvider(ROUTING_PROVIDER).useValue(fake).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService);
    await db.query(`UPDATE system_parameters SET value='0' WHERE key='reco.minIntervalSeconds'`); // pas de limiteur dans ces tests
  });
  beforeEach(async () => {
    await db.query('TRUNCATE route_recommendations, traffic_statistics, incidents, road_segments, driver_installations CASCADE');
    // courant : 2200 m en 300 s ; alternative parallèle plus longue : 2500 m en 380 s
    fake.calculateRoutes.mockResolvedValue([route('cur', 47.52, 2200, 300), route('alt', 47.53, 2500, 380)]);
  });
  afterAll(async () => {
    await db.query(`UPDATE system_parameters SET value='30' WHERE key='reco.minIntervalSeconds'`);
    await app.close();
  });

  it('n’émet rien sans trafic ni incident exploitable (REC-005), même si l’alternative existe', async () => {
    const res = await evaluate(inst()).expect(200);
    expect(res.body).toEqual({ recommendation: null, reason: 'NO_DATA' });
  });

  it('propose l’alternative quand le trafic mesuré ralentit l’itinéraire courant, avec justification (REC-002..004, 008)', async () => {
    await seedTraffic();
    const res = await evaluate(inst()).expect(200);
    const r = res.body.recommendation;
    expect(r.decision).toBe('EN_ATTENTE');
    expect(r.gainSeconds).toBeGreaterThan(300);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.motif).toMatch(/Gain estimé/);
    expect(r.reasons[0].kind).toBe('TRAFFIC');
    expect(r.currentRoute.adjustedDurationSeconds).toBeGreaterThan(r.proposedRoute.adjustedDurationSeconds);
    expect(r.proposedRoute.id).toBe('alt');                  // itinéraire proposé distinct du courant
    expect(r.proposedRoute.geometry.coordinates.length).toBeGreaterThan(2);
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='route_recommendations'`)).rows.map((x) => x.column_name);
    expect(cols.filter((c) => /geom|coord|route$/.test(c))).toEqual([]); // aucune géométrie conservée
  });

  it('ignore un trafic périmé ou trop peu fiable', async () => {
    await seedTraffic(0.8, -1);
    expect((await evaluate(inst()).expect(200)).body.reason).toBe('NO_DATA');
    await db.query('TRUNCATE traffic_statistics, road_segments CASCADE');
    await seedTraffic(0.1, 10);
    expect((await evaluate(inst()).expect(200)).body.reason).toBe('NO_DATA');
  });

  it('prend en compte une route bloquée signalée sur l’itinéraire courant', async () => {
    await db.query(`INSERT INTO incidents (type, status, geom, confidence, reporter_count, expires_at)
      VALUES ('ROUTE_BLOQUEE','CONFIRME', ST_SetSRID(ST_MakePoint(47.52, ${LAT0 + 7 * STEP}),4326), 1, 3, now() + interval '30 min')`);
    const r = (await evaluate(inst()).expect(200)).body.recommendation;
    expect(r.reasons[0]).toMatchObject({ kind: 'INCIDENT' });
    expect(r.motif).toMatch(/Route bloquée confirmé|Route bloquée confirmée|Route bloquée/);
  });

  it('ne compare pas si l’itinéraire courant est introuvable parmi les candidats', async () => {
    await seedTraffic();
    const elsewhere = line(47.60);
    expect((await evaluate(inst(), body('s1', elsewhere)).expect(200)).body.reason).toBe('CURRENT_ROUTE_UNMATCHED');
  });

  it('une seule alternative ou aucune => pas de recommandation', async () => {
    await seedTraffic();
    fake.calculateRoutes.mockResolvedValue([route('cur', 47.52, 2200, 300)]);
    expect((await evaluate(inst()).expect(200)).body.reason).toBe('NO_ALTERNATIVE');
  });

  it('accepter / ignorer ; décision rejouable ; expirée => refus (REC-006/007)', async () => {
    await seedTraffic();
    const who = inst();
    const id = (await evaluate(who).expect(200)).body.recommendation.id;
    const again = (await evaluate(who).expect(200)).body.recommendation; // idempotent tant qu'elle est valable
    expect(again.id).toBe(id);

    expect((await api().patch(`/recommendations/${id}/decision`).set('x-installation-id', inst()).send({ decision: 'ACCEPTEE' }).expect(404)).body.code).toBe('RECOMMENDATION_NOT_FOUND');
    await api().patch(`/recommendations/${id}/decision`).set('x-installation-id', who).send({ decision: 'ACCEPTEE' }).expect(200);
    await api().patch(`/recommendations/${id}/decision`).set('x-installation-id', who).send({ decision: 'ACCEPTEE' }).expect(200);
    const conflict = await api().patch(`/recommendations/${id}/decision`).set('x-installation-id', who).send({ decision: 'IGNOREE' }).expect(409);
    expect(conflict.body.code).toBe('ALREADY_DECIDED');

    // expiration
    const who2 = inst();
    const id2 = (await evaluate(who2, body('s2')).expect(200)).body.recommendation.id;
    await db.query(`UPDATE route_recommendations SET expires_at = now() - interval '1 second' WHERE id=$1`, [id2]);
    const late = await api().patch(`/recommendations/${id2}/decision`).set('x-installation-id', who2).send({ decision: 'ACCEPTEE' }).expect(409);
    expect(late.body.code).toBe('RECOMMENDATION_EXPIRED');
    const list = await api().get('/recommendations').query({ sessionId: 's2' }).set('x-installation-id', who2).expect(200);
    expect(list.body.recommendations[0].decision).toBe('EXPIREE');
  });

  it('ne repropose pas un itinéraire ignoré pendant le délai de grâce', async () => {
    await seedTraffic();
    const who = inst();
    const id = (await evaluate(who).expect(200)).body.recommendation.id;
    await api().patch(`/recommendations/${id}/decision`).set('x-installation-id', who).send({ decision: 'IGNOREE' }).expect(200);
    expect((await evaluate(who).expect(200)).body.reason).toBe('RECENTLY_IGNORED');
  });

  it('refuse un fournisseur indisponible proprement et valide les entrées', async () => {
    const { ProviderUnavailableError } = require('../src/modules/navigation/providers/types');
    fake.calculateRoutes.mockRejectedValue(new ProviderUnavailableError('x'));
    expect((await evaluate(inst()).expect(502)).body.code).toBe('ROUTING_PROVIDER_UNAVAILABLE');
    await evaluate(inst(), { ...body(), currentRoute: [[47.5, -18.9]] } as any).expect(400);
  });
});
