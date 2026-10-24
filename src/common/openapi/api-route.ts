import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type * as z from 'zod';
import { apiErrorSchema } from '../../contract/index.js';
import { inlineSchema } from './components.js';

const SUCCESSES = { 200: 'OK', 201: 'Created', 204: 'No content' } as const;

const FAILURES = {
  401: 'Not authenticated',
  404: 'The entity does not exist',
  409: 'The request conflicts with the current state',
  422: 'Validation failed',
} as const;

export interface ApiRouteOptions {
  summary: string;
  /** The success status and the contract schema of the body (none for 204). */
  success: { status: 200 | 201 | 204; schema?: z.ZodType };
  /** The request body, for a route that validates it in the service and so has no schema on `@Body`. */
  body?: z.ZodType;
  /** The failures besides 401, which every route behind the guard has (list 401 for a failed sign-in). */
  failures?: readonly (401 | 404 | 409 | 422)[];
  /** A route without `@Public()` needs a token. */
  authenticated?: boolean;
}

/**
 * Documents a route in the OpenAPI document from the contract: summary, success body, request body
 * and the error bodies. Query and body schemas given to `@Query` and `@Body` are picked up by
 * Nest itself, so they are not repeated here.
 */
export const ApiRoute = ({
  summary,
  success,
  body,
  failures = [],
  authenticated = true,
}: ApiRouteOptions) => {
  const errors = [...new Set([...(authenticated ? ([401] as const) : []), ...failures])];
  return applyDecorators(
    ApiOperation({ summary }),
    ApiResponse({
      status: success.status,
      description: SUCCESSES[success.status],
      standardSchema: success.schema,
    }),
    ...(authenticated ? [ApiBearerAuth()] : []),
    ...(body ? [ApiBody({ schema: inlineSchema(body) as SchemaObject })] : []),
    ...errors.map((status) =>
      ApiResponse({ status, description: FAILURES[status], standardSchema: apiErrorSchema }),
    ),
  );
};
