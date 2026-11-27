export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  mapProvider: string;
  mapApiKey: string;
  trafficCoverageValidated: boolean;
  maxGpsAccuracyMeters: number;
  jwtSecret: string;
  mapLanguage: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://roadpulse:roadpulse@localhost:5432/roadpulse',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  mapProvider: process.env.MAP_PROVIDER ?? 'tomtom', // décision produit : TomTom (Orbis)
  mapApiKey: process.env.MAP_API_KEY ?? '',
  mapLanguage: process.env.MAP_LANGUAGE ?? 'fr-FR',
  // Ne passer à true qu'après validation terrain de la couverture trafic (spec §6.2).
  trafficCoverageValidated: process.env.MAP_TRAFFIC_VALIDATED === 'true',
  maxGpsAccuracyMeters: parseInt(process.env.MAX_GPS_ACCURACY_METERS ?? '100', 10),
  // Obligatoire (≥ 32 car.) en production ; valeur de développement uniquement hors production.
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me-dev-only-secret'),
});
