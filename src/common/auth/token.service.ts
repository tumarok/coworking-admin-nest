import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ENV, type Env } from '../../config/env.js';
import { Clock } from '../clock/clock.js';

const ALGORITHM = 'HS256';
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** `12h` is 43200: the environment schema guarantees a number and one of the units s, m, h, d. */
const ttlSeconds = (ttl: string): number => {
  const unit = ttl.slice(-1) as keyof typeof UNIT_SECONDS;
  return Number.parseInt(ttl, 10) * UNIT_SECONDS[unit];
};

/**
 * Signs and verifies access tokens: HS256 JWTs whose `sub` is the user id. Issue and expiry times
 * come from the `Clock`, not from the system time inside the JWT library.
 */
@Injectable()
export class TokenService {
  private readonly jwt: JwtService;
  private readonly ttl: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly clock: Clock,
  ) {
    this.jwt = new JwtService({
      secret: env.JWT_SECRET,
      verifyOptions: { algorithms: [ALGORITHM] },
    });
    this.ttl = ttlSeconds(env.JWT_TTL);
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, iat: this.seconds() },
      { algorithm: ALGORITHM, expiresIn: this.ttl },
    );
  }

  /** The user id of a valid token; a bad signature, an expired or malformed token all throw. */
  async verify(token: string): Promise<string> {
    const { sub } = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
      clockTimestamp: this.seconds(),
    });
    if (typeof sub !== 'string' || sub === '') throw new Error('The token has no subject');
    return sub;
  }

  private seconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }
}
