import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdministrationModule } from '../administration/administration.module';
import { HealthController } from './health.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MonitoringAdminController } from './monitoring-admin.controller';
import { MonitoringService } from './monitoring.service';
import { PrometheusController } from './prometheus.controller';
import { PromService } from './prom.service';
import { RequestStatsService } from './request-stats.service';

@Module({
  imports: [AdministrationModule],
  controllers: [HealthController, MonitoringAdminController, PrometheusController],
  providers: [
    PromService, MonitoringService,
    { provide: RequestStatsService, useFactory: () => new RequestStatsService() },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MonitoringService, RequestStatsService],
})
export class MonitoringModule {}
