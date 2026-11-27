import { Controller, ForbiddenException, Get, Header, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { PromService } from './prom.service';

/** Exposition Prometheus. En production, METRICS_TOKEN est obligatoire (jeton Bearer). */
@ApiExcludeController()
@Controller('metrics')
export class PrometheusController {
  constructor(private readonly prom: PromService, private readonly config: ConfigService) {}

  @Get() @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = process.env.METRICS_TOKEN;
    if (!token && this.config.get('nodeEnv') === 'production') throw new ForbiddenException({ code: 'METRICS_DISABLED', message: 'Métriques désactivées.' });
    if (token && auth !== `Bearer ${token}`) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Jeton requis.' });
    return this.prom.registry.metrics();
  }
}
