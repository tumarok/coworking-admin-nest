import { JwtService } from '@nestjs/jwt';
import { type Clock } from '../clock/clock.js';
import { parseEnv } from '../../config/env.js';
import { TokenService } from './token.service.js';

const secret = 'a-secret-of-at-least-thirty-two-characters';
const env = (JWT_TTL = '12h') =>
  parseEnv({ DATABASE_URL: 'postgresql://x', JWT_SECRET: secret, JWT_TTL });

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

const START = new Date('2026-10-14T09:00:00.000Z');
const clockAt = (instant: Date): Clock & { instant: Date } => ({
  instant,
  now() {
    return this.instant;
  },
});

describe('TokenService', () => {
  const clock = clockAt(START);
  const tokens = new TokenService(env(), clock);

  afterEach(() => {
    clock.instant = START;
  });

  it('verifies the token it signed and returns the user id', async () => {
    expect(await tokens.verify(await tokens.sign('usr_admin'))).toBe('usr_admin');
  });

  it.each([
    ['30s', 30],
    ['90m', 90 * 60],
    ['12h', 12 * 3600],
    ['2d', 2 * 86_400],
  ])('signs an HS256 token issued by the clock that lasts %s', async (ttl, seconds) => {
    const token = await new TokenService(env(ttl), clock).sign('usr_admin');
    const { header, payload } = new JwtService().decode<{ sub: string; iat: number; exp: number }>(
      token,
      { complete: true },
    );

    expect(header.alg).toBe('HS256');
    expect(payload.sub).toBe('usr_admin');
    expect(payload.iat).toBe(START.getTime() / 1000);
    expect(payload.exp).toBe(START.getTime() / 1000 + seconds);
  });

  it('accepts a token until the clock passes its expiry, and not after', async () => {
    const token = await tokens.sign('usr_admin');

    clock.instant = new Date(START.getTime() + 12 * 3600_000 - 1000);
    expect(await tokens.verify(token)).toBe('usr_admin');

    clock.instant = new Date(START.getTime() + 12 * 3600_000 + 1000);
    await expect(tokens.verify(token)).rejects.toThrow('expired');
  });

  it('rejects a token signed with another secret', async () => {
    const foreign = new JwtService({ secret: 'another-secret-of-at-least-32-characters' });

    await expect(tokens.verify(foreign.sign({ sub: 'usr_admin' }))).rejects.toThrow();
  });

  it('rejects an unsigned token', async () => {
    const unsigned = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({ sub: 'usr_admin' })}.`;

    await expect(tokens.verify(unsigned)).rejects.toThrow();
  });

  it('rejects a token signed with another algorithm', async () => {
    const own = new JwtService({ secret });

    await expect(
      tokens.verify(own.sign({ sub: 'usr_admin' }, { algorithm: 'HS512' })),
    ).rejects.toThrow();
  });

  it('rejects a token without a subject', async () => {
    const own = new JwtService({ secret });

    await expect(tokens.verify(own.sign({}, { expiresIn: '1h' }))).rejects.toThrow('subject');
  });

  it('rejects text that is no token', async () => {
    await expect(tokens.verify('demo-token.usr_admin')).rejects.toThrow();
  });
});
