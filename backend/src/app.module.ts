import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './shared/config/configuration';
import { DatabaseModule } from './shared/database/database.module';
import { RedisModule } from './shared/redis/redis.module';
import { RequestIdMiddleware } from './shared/middleware/request-id.middleware';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { ParametersModule } from './shared/parameters/parameters.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { TrafficModule } from './modules/traffic/traffic.module';
import { NavigationModule } from './modules/navigation/navigation.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';

// Monolithe modulaire : ajouter ici navigation, traffic, incidents, recommendations,
// privacy, administration (un module par domaine, sans import des internes d'un autre).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    RedisModule,
    ParametersModule,
    MonitoringModule,
    NavigationModule,
    IncidentsModule,
    PrivacyModule,
    TrafficModule,
    RecommendationsModule,
    AdministrationModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
