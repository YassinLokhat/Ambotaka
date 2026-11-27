const LOCAL_DATABASE_URL = 'postgres://roadpulse:roadpulse@localhost:5432/roadpulse';

module.exports = function databaseUrl(env = process.env) {
  const configuredUrl = env.DATABASE_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production; configure the Render Postgres connection string.');
  }
  return LOCAL_DATABASE_URL;
};