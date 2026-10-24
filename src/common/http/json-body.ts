import { raw, type ErrorRequestHandler, type RequestHandler } from 'express';

export const MAX_BODY_BYTES = '100kb';

/**
 * Decodes the bytes as UTF-8, whatever charset the request declares. An empty, broken or non-JSON
 * body is "no body"; anything else, scalars included, is the body.
 */
export const parseJsonBody = (source: unknown): unknown => {
  if (!Buffer.isBuffer(source)) return undefined;
  try {
    return JSON.parse(source.toString('utf8'));
  } catch {
    return undefined;
  }
};

/**
 * Reads the body of every request whatever its content type, like the mock API: an empty or
 * broken body is `undefined` and the request carries on, so routing, authentication and
 * validation decide the answer.
 */
export const jsonBody = (): [RequestHandler, ErrorRequestHandler, RequestHandler] => {
  const readBytes = raw({ type: () => true, limit: MAX_BODY_BYTES });
  // Express tells an error handler by its four parameters, so `next` must stay in the list.
  const reject: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const { type, status } = error as { type?: string; status?: number };
    if (type === 'entity.too.large') {
      response.status(413).json({ message: 'Request body is too large' });
      return;
    }
    response.status(status ?? 400).json({ message: 'Invalid request body' });
  };
  const toJson: RequestHandler = (request, _response, next) => {
    request.body = parseJsonBody(request.body);
    next();
  };
  return [readBytes, reject, toJson];
};
