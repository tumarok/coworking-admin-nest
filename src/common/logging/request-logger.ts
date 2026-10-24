import { Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';

/** Logs method, path, status and duration of every request once the response is sent. */
export const requestLogger = (): RequestHandler => {
  const logger = new Logger('HTTP');
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const milliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${milliseconds.toFixed(1)} ms`,
      );
    });
    next();
  };
};
