import { validationSchema } from './validation.schema.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://portal.example.com',
  REDIS_URL: 'redis://cache.example.com:6379',
};

describe('validationSchema', () => {
  it('keeps development permissive, with the data mocks off by default', () => {
    const { error, value } = validationSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value.FRONTEND_URL).toBe('http://localhost:3000');
    expect(value.DATAFORSEO_ALLOW_MOCK).toBe('0');
  });

  it('accepts a complete production config', () => {
    expect(validationSchema.validate(prod).error).toBeUndefined();
  });

  it('refuses production without a real https FRONTEND_URL', () => {
    const { FRONTEND_URL: _drop, ...noUrl } = prod;
    expect(validationSchema.validate(noUrl).error).toBeDefined();
    expect(validationSchema.validate({ ...prod, FRONTEND_URL: 'http://portal.example.com' }).error).toBeDefined();
  });

  it('refuses production without Redis', () => {
    const { REDIS_URL: _drop, ...noRedis } = prod;
    expect(validationSchema.validate(noRedis).error).toBeDefined();
  });

  it('never allows made-up data in production', () => {
    expect(validationSchema.validate({ ...prod, DATAFORSEO_ALLOW_MOCK: '1' }).error).toBeDefined();
    expect(validationSchema.validate({ ...prod, MEASUREMENT_ALLOW_MOCK: '1' }).error).toBeDefined();
  });

  it('requires an https Google callback in production once Google is configured', () => {
    expect(validationSchema.validate({ ...prod, GOOGLE_CLIENT_ID: 'id' }).error).toBeDefined();
    expect(
      validationSchema.validate({ ...prod, GOOGLE_CLIENT_ID: 'id', GOOGLE_REDIRECT_URI: 'https://api.example.com/auth/google/callback' }).error,
    ).toBeUndefined();
  });
});
