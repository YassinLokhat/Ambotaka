import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/modules/monitoring/health.controller';
import { DatabaseService } from '../src/shared/database/database.service';
import { RedisService } from '../src/shared/redis/redis.service';
import { AllExceptionsFilter } from '../src/shared/filters/http-exception.filter';
import { RequestIdMiddleware } from '../src/shared/middleware/request-id.middleware';

async function build(db: boolean, redis: boolean) {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: DatabaseService, useValue: { ping: async () => db } },
      { provide: RedisService, useValue: { ping: async () => redis } },
    ],
  }).compile();
  const app: INestApplication = mod.createNestApplication();
  const mw = new RequestIdMiddleware();
  app.use((req: any, res: any, next: any) => mw.use(req, res, next));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('GET /health', () => {
  it('200 quand tout est up', async () => {
    const app = await build(true, true);
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    await app.close();
  });

  it("503 au format d'erreur homogène quand un service est down", async () => {
    const app = await build(true, false);
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({ statusCode: 503, code: 'SERVICE_DEGRADED' });
    expect(res.body.requestId).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('stack');
    await app.close();
  });
});
