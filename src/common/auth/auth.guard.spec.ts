import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemClock } from '../clock/clock.js';
import { parseEnv } from '../../config/env.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { Public } from './public.decorator.js';
import { TokenService } from './token.service.js';

class Open {
  @Public()
  handler() {
    return undefined;
  }
}

class Closed {
  handler() {
    return undefined;
  }
}

const tokens = new TokenService(
  parseEnv({ DATABASE_URL: 'x', JWT_SECRET: 'a-secret-of-at-least-thirty-two-characters' }),
  new SystemClock(),
);
const guard = new AuthGuard(new Reflector(), tokens);

const contextOf = (target: typeof Open | typeof Closed, authorization?: string) => {
  const request = { headers: { authorization } } as AuthenticatedRequest;
  const context = {
    getHandler: () =>
      Object.getOwnPropertyDescriptor(target.prototype, 'handler')?.value as () => void,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('AuthGuard', () => {
  it('lets public routes through without a token', async () => {
    expect(await guard.canActivate(contextOf(Open).context)).toBe(true);
  });

  it('puts the user id on the request for a valid token', async () => {
    const { context, request } = contextOf(Closed, `Bearer ${await tokens.sign('usr_admin')}`);

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.userId).toBe('usr_admin');
  });

  it('reads the scheme without regard to case', async () => {
    const token = await tokens.sign('usr_admin');

    expect(await guard.canActivate(contextOf(Closed, `bearer   ${token}`).context)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['a bare token', 'abc'],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a scheme without a token', 'Bearer '],
    ['a token the service rejects', 'Bearer demo-token.usr_admin'],
  ])('answers 401 for %s', async (_name, header) => {
    await expect(guard.canActivate(contextOf(Closed, header).context)).rejects.toMatchObject({
      status: 401,
      response: { message: 'Authentication required' },
    });
  });
});
