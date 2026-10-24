import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '../../contract/index.js';
import { buildOpenApiDocument } from './openapi-document.js';

// The page loads the reference bundle from the jsDelivr CDN. The version is pinned in the URL and
// the policy admits only that path, so no other package on the CDN can run on this origin.
const SCALAR_VERSION = '1.76.0';
const SCALAR_PATH = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/`;

// What the page needs on top of the default policy (helmet's, set for every other route): the
// bundle, its styles, and the inline script that starts it.
const DOCS_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${SCALAR_PATH}`,
  `style-src 'self' 'unsafe-inline' ${SCALAR_PATH}`,
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

type Render = (req: Request, res: Response) => void;

/**
 * Serves the interactive API reference at `/docs`, public in every environment. The document is
 * built on the first request, when every module is mounted, and the page is kept for the next ones.
 */
export const mountDocs = (app: NestExpressApplication): void => {
  const logger = new Logger('Docs');
  let render: Render | undefined;

  app
    .getHttpAdapter()
    .getInstance()
    .get('/docs', (req: Request, res: Response) => {
      try {
        // Without `withFastify` the handler is the Express one; its type is a union with Fastify's.
        render ??= apiReference({
          content: buildOpenApiDocument(app),
          pageTitle: 'Coworking Admin API',
          bundle: `${SCALAR_PATH}esm.js`,
          withDefaultFonts: false,
          telemetry: false,
          agent: { disabled: true },
        }) as Render;
      } catch (error) {
        // Outside Nest's pipeline, so the error body of the API is written here.
        logger.error(error instanceof Error ? error.stack : String(error));
        res.status(500).json({ message: 'Internal server error' } satisfies ApiErrorBody);
        return;
      }
      res.setHeader('Content-Security-Policy', DOCS_CSP);
      render(req, res);
    });
};
