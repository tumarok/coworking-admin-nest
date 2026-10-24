import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '../../contract/index.js';
import { noRouteBody } from './no-route.js';

const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ApiErrorBody).message === 'string';

/** Only the keys of the contract: framework exceptions also carry `statusCode` and `error`. */
const toBody = (payload: unknown, fallback: string): ApiErrorBody => {
  if (!isApiErrorBody(payload)) return { message: fallback };
  const { message, fieldErrors, conflicts } = payload;
  return { message, ...(fieldErrors && { fieldErrors }), ...(conflicts && { conflicts }) };
};

/**
 * Turns every failure into the error body of the contract. A request that matched no route is
 * answered before authentication, as the mock API does: `No route for <METHOD> <path>` below the
 * API prefix and `Not found` anywhere else.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // Nest raises NotFoundException for a request that matched no route; other failures on such
    // a request (a decoding error, say) must not hide behind "No route for".
    if (!request.route && exception instanceof NotFoundException) {
      response.status(404).json(noRouteBody(request));
      return;
    }

    if (exception instanceof HttpException) {
      response
        .status(exception.getStatus())
        .json(toBody(exception.getResponse(), exception.message));
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ message: 'Internal server error' } satisfies ApiErrorBody);
  }
}
