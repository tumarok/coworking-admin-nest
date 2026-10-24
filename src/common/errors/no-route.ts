import type { Request } from 'express';
import type { ApiErrorBody } from '../../contract/index.js';
import { API_PREFIX } from '../http/api-prefix.js';

const PREFIX = `/${API_PREFIX}`;

/**
 * The body for a request nothing answers: `No route for <METHOD> <path>` below the API prefix, with
 * the path as the client wrote it, and `Not found` anywhere else.
 */
export const noRouteBody = (request: Pick<Request, 'method' | 'path'>): ApiErrorBody =>
  request.path.startsWith(PREFIX)
    ? { message: `No route for ${request.method} ${request.path.slice(PREFIX.length) || '/'}` }
    : { message: 'Not found' };
