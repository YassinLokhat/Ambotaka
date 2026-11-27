import configuration from '../src/shared/config/configuration';

const productionVariables = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'METRICS_TOKEN', 'MAP_API_KEY'];
const previousValues = new Map<string, string | undefined>();

beforeEach(() => {
  previousValues.clear();
  for (const name of ['NODE_ENV', ...productionVariables]) {
    previousValues.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of ['ADMIN_BOOTSTRAP_USERNAME', 'ADMIN_BOOTSTRAP_PASSWORD']) {
    previousValues.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of previousValues) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('configuration', () => {
  it('fails fast in production when deployment variables are missing', () => {
    process.env.NODE_ENV = 'production';

    expect(() => configuration()).toThrow(
      'Missing required production environment variables: DATABASE_URL, REDIS_URL, JWT_SECRET, METRICS_TOKEN, MAP_API_KEY',
    );
  });

  it('keeps localhost defaults outside production', () => {
    process.env.NODE_ENV = 'development';

    expect(configuration()).toMatchObject({
      databaseUrl: 'postgres://roadpulse:roadpulse@localhost:5432/roadpulse',
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('loads optional admin bootstrap credentials from the environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_BOOTSTRAP_USERNAME = ' initial.admin ';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'a-strong-password';

    expect(configuration()).toMatchObject({
      adminBootstrapUsername: 'initial.admin',
      adminBootstrapPassword: 'a-strong-password',
    });
  });
});