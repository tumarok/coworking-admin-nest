import type { ExecutionContext } from '@nestjs/common';
import { parseEnv } from '../config/env.js';
import { ResetEnabledGuard } from './reset-enabled.guard.js';

const guardWith = (ENABLE_RESET: string) =>
  new ResetEnabledGuard(
    parseEnv({
      DATABASE_URL: 'x',
      JWT_SECRET: 'a-secret-of-at-least-thirty-two-characters',
      ENABLE_RESET,
    }),
  );

const context = {
  switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: '/api/v1/__reset' }) }),
} as unknown as ExecutionContext;

describe('ResetEnabledGuard', () => {
  it('lets the request through when reset is enabled', () => {
    expect(guardWith('true').canActivate(context)).toBe(true);
  });

  it('answers like an unknown route when it is not', () => {
    expect(() => guardWith('false').canActivate(context)).toThrow(
      expect.objectContaining({
        status: 404,
        response: { message: 'No route for POST /__reset' },
      }),
    );
  });
});
