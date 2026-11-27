import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PromService } from './prom.service';
import { RequestStatsService } from './request-stats.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly stats: RequestStatsService, private readonly prom: PromService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest(), res = http.getResponse();
    const start = process.hrtime.bigint();
    // « finish » : le code HTTP final (y compris celui posé par le filtre d'exceptions) est connu.
    res.once('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.stats.record(ms, res.statusCode);
      this.prom.http.observe({ method: req.method, route: req.route?.path ?? 'unmatched', status_class: `${Math.floor(res.statusCode / 100)}xx` }, ms / 1000);
    });
    return next.handle();
  }
}
