import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error.js';
import { noRouteBody } from '../common/errors/no-route.js';
import { ENV, type Env } from '../config/env.js';

/**
 * Makes `POST /__reset` answer like a route that does not exist unless `ENABLE_RESET=true`: an open
 * endpoint that wipes the database must not be reachable in production.
 */
@Injectable()
export class ResetEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.env.ENABLE_RESET) return true;
    throw new ApiError(404, noRouteBody(context.switchToHttp().getRequest<Request>()));
  }
}
