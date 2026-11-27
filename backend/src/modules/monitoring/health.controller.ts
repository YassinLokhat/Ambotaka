import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../shared/database/database.service';
import { RedisService } from '../../shared/redis/redis.service';

@ApiTags('monitoring')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService, private readonly redis: RedisService) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    const result = {
      status: database && redis ? 'ok' : 'degraded',
      checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
      time: new Date().toISOString(),
    };
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: 'SERVICE_DEGRADED',
        message: 'Un ou plusieurs services sont indisponibles.',
        details: [result.checks],
      });
    }
    return result;
  }
}
