import { parseEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5433/coworking',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('fills in the defaults', () => {
    expect(parseEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 4010,
      JWT_TTL: '12h',
      ENABLE_RESET: false,
      CORS_ORIGINS: [],
      LOG_LEVEL: 'log',
      SEED: 42,
    });
  });

  it('coerces numbers and flags from strings', () => {
    const env = parseEnv({ ...required, PORT: '8080', SEED: '7', ENABLE_RESET: 'true' });

    expect(env).toMatchObject({ PORT: 8080, SEED: 7, ENABLE_RESET: true });
  });

  it('splits the allowed origins and drops blanks', () => {
    const env = parseEnv({
      ...required,
      CORS_ORIGINS: 'http://localhost:4200, ,http://localhost:3100',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'http://localhost:3100']);
  });

  it('lists every problem at once', () => {
    expect(() => parseEnv({ JWT_SECRET: 'short', PORT: '0', JWT_TTL: 'soon' })).toThrow(
      [
        'Invalid environment:',
        'PORT: Too small: expected number to be >=1',
        'DATABASE_URL: Invalid input: expected string, received undefined',
        'JWT_SECRET: Use at least 32 characters',
        'JWT_TTL: Use a number and a unit: s, m, h or d',
      ].join('\n'),
    );
  });

  it('rejects an unknown log level', () => {
    expect(() => parseEnv({ ...required, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
