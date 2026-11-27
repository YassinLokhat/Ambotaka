import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NavigationController } from './navigation.controller';
import { MapboxGeocodingProvider, MapboxRoutingProvider } from './providers/mapbox.provider';
import { TomTomGeocodingProvider, TomTomRoutingProvider } from './providers/tomtom.provider';
import { GEOCODING_PROVIDER, ROUTING_PROVIDER } from './providers/types';
import { RoutesService } from './routes.service';

@Module({
  controllers: [NavigationController],
  exports: [ROUTING_PROVIDER],
  providers: [
    RoutesService,
    {
      provide: ROUTING_PROVIDER,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const key = c.get<string>('mapApiKey') ?? '';
        const traffic = c.get<boolean>('trafficCoverageValidated') ?? false;
        return c.get('mapProvider') === 'tomtom'
          ? new TomTomRoutingProvider(key, traffic, c.get<string>('mapLanguage'))
          : new MapboxRoutingProvider(key, traffic ? 'driving-traffic' : 'driving', traffic);
      },
    },
    {
      provide: GEOCODING_PROVIDER,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const key = c.get<string>('mapApiKey') ?? '';
        return c.get('mapProvider') === 'tomtom' ? new TomTomGeocodingProvider(key) : new MapboxGeocodingProvider(key);
      },
    },
  ],
})
export class NavigationModule {}
