const databaseUrl = require('../scripts/database-url') as (env: NodeJS.ProcessEnv) => string;

describe('database URL resolution', () => {
  it('uses the local default in development', () => {
    expect(databaseUrl({ NODE_ENV: 'development' })).toBe('postgres://roadpulse:roadpulse@localhost:5432/roadpulse');
  });

  it('requires an explicit URL in production', () => {
    expect(() => databaseUrl({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required in production; configure the Render Postgres connection string.',
    );
  });

  it('uses the configured managed database URL in production', () => {
    expect(databaseUrl({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/roadpulse' }))
      .toBe('postgresql://db.internal/roadpulse');
  });
});