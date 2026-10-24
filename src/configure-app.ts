import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/errors/api-exception.filter.js';
import { jsonBody } from './common/http/json-body.js';
import { noStore } from './common/http/no-store.js';
import { parseQuery } from './common/http/parse-query.js';
import { requestLogger } from './common/logging/request-logger.js';
import { ContractValidationPipe } from './common/validation/contract-validation.pipe.js';
import { ENV, type Env } from './config/env.js';

/**
 * The Express adapter with the routing rules of the mock API. Express reads these settings when
 * it builds its router, so they belong on the instance Nest is created with.
 */
export const createHttpAdapter = (): ExpressAdapter => {
  const server = express();
  server.set('case sensitive routing', true);
  server.set('etag', false);
  server.set('query parser', parseQuery);
  return new ExpressAdapter(server);
};

/**
 * Everything else that shapes HTTP behaviour, shared by `main.ts` and the tests so they cannot drift.
 * The application must be created with `createHttpAdapter()` and `bodyParser: false`: the body is
 * read by `jsonBody`.
 */
export const configureApp = (app: NestExpressApplication): void => {
  const env = app.get<Env>(ENV);

  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
  }

  app.use(helmet());
  app.use(noStore());
  app.use(requestLogger());
  app.use(...jsonBody());

  app.useGlobalPipes(new ContractValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
};
