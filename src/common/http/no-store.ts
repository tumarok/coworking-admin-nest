import type { RequestHandler } from 'express';

/** Responses are live data, never to be cached by a browser or a proxy. */
export const noStore = (): RequestHandler => (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
};
