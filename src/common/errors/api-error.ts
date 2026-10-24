import { HttpException } from '@nestjs/common';
import type { ApiErrorBody } from '../../contract/index.js';

/** An error with the exact body the client receives (`ApiErrorBody`). */
export class ApiError extends HttpException {
  constructor(status: number, body: ApiErrorBody) {
    super(body, status);
  }
}

export const unauthorized = (message = 'Authentication required') => new ApiError(401, { message });

export const notFound = (what: string) => new ApiError(404, { message: `${what} not found` });

export const conflict = (message: string, extra: Omit<ApiErrorBody, 'message'> = {}) =>
  new ApiError(409, { message, ...extra });

export const invalid = (fieldErrors: Record<string, string>, message = 'Validation failed') =>
  new ApiError(422, { message, fieldErrors });
