import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { unauthorized } from '../errors/api-error.js';
import { IS_PUBLIC } from './public.decorator.js';
import { TokenService } from './token.service.js';

export type AuthenticatedRequest = Request & { userId?: string };

// The scheme is case-insensitive, as the mock API reads it.
const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Requires `Authorization: Bearer <token>` on every route that is not `@Public()`. Whatever is
 * wrong with the token, the answer is the same 401. Requests that match no route never get here:
 * they are answered 404 first, like the mock API does.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (token === undefined) throw unauthorized();
    try {
      request.userId = await this.tokens.verify(token);
    } catch {
      throw unauthorized();
    }
    return true;
  }
}
