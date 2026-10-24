import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { unauthorized } from '../errors/api-error.js';
import type { AuthenticatedRequest } from './auth.guard.js';

/** The id of the signed-in user, set by `AuthGuard`; only meaningful on routes that are not public. */
export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { userId } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (userId === undefined) throw unauthorized();
  return userId;
});
