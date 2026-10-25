import type { OpenAPIObject } from '@nestjs/swagger';
import type { Router } from 'express';
import * as z from 'zod';
import { buildOpenApiDocument } from '../src/common/openapi/openapi-document.js';
import { ROUTE_SCHEMAS } from './support/response-schemas.js';
import { testApp, type TestApp } from './support/test-app.js';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;

// What Express keeps of a route it has mounted.
interface MountedLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const PREFIX = '/api/v1';
// Routes a client does not need a token for.
const PUBLIC = new Set(['POST /auth/login', 'POST /__reset']);
const METHODS = ['get', 'post', 'patch', 'delete'] as const;

// The routes Express has mounted below the API prefix, in the notation of OpenAPI. The probe routes
// belong to the transport tests, and `/docs` and `/health` are outside the prefix.
const mountedRoutes = (api: TestApp): string[] => {
  const router = (api.app.getHttpAdapter().getInstance() as { router: Router }).router;
  return (router.stack as unknown as MountedLayer[])
    .flatMap(({ route }) =>
      route
        ? Object.keys(route.methods).map((method) => `${method.toUpperCase()} ${route.path}`)
        : [],
    )
    .filter((route) => route.includes(` ${PREFIX}/`) && !route.includes(`${PREFIX}/probe`))
    .map((route) => route.replace(PREFIX, '').replaceAll(/:(\w+)/g, '{$1}'));
};

const refOf = (value: unknown) => /#\/components\/schemas\/(\w+)/.exec(JSON.stringify(value))?.[1];

describe('the OpenAPI document and the routes', () => {
  let api: TestApp;
  let document: OpenAPIObject;

  beforeAll(async () => {
    api = await testApp();
    document = buildOpenApiDocument(api.app);
  });

  afterAll(async () => {
    await api.close();
  });

  const documented = () => {
    return Object.entries(document.paths)
      .filter(([route]) => route.startsWith(PREFIX) && !route.startsWith(`${PREFIX}/probe`))
      .flatMap(([route, item]) =>
        METHODS.flatMap((method) => {
          const operation = item[method];
          return operation
            ? [{ key: `${method.toUpperCase()} ${route.slice(PREFIX.length)}`, operation }]
            : [];
        }),
      );
  };
  const operationOf = (method: string, path: string): OperationObject => {
    const found = documented().find((entry) => entry.key === `${method} ${path}`);
    if (!found) throw new Error(`${method} ${path} is not documented`);
    return found.operation;
  };

  it('has an operation for every mounted route, and no other', () => {
    const mounted = mountedRoutes(api).sort();

    expect(
      documented()
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(mounted);
  });

  it('has a schema for every mounted route, and no other', () => {
    expect(ROUTE_SCHEMAS.map((route) => `${route.method} ${route.path}`).sort()).toEqual(
      mountedRoutes(api).sort(),
    );
  });

  describe.each(ROUTE_SCHEMAS.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s',
    (_name, route) => {
      const operation = () => operationOf(route.method, route.path);

      it('describes its success response by the contract schema', () => {
        const successes = Object.entries(operation().responses).filter(([status]) =>
          status.startsWith('2'),
        );

        expect(successes).toHaveLength(1);
        const [[status, response]] = successes;
        if (route.success === null) {
          expect(status).toBe('204');
          expect(JSON.stringify(response)).not.toContain('application/json');
        } else {
          expect(status).toBe(
            route.method === 'POST' && !route.path.includes('/', 1) ? '201' : '200',
          );
          const id = z.globalRegistry.get(route.success)?.id;
          expect(id).toBeDefined();
          expect(refOf(response)).toBe(id);
        }
      });

      it('describes every failure by the error schema', () => {
        const failures = Object.entries(operation().responses).filter(
          ([status]) => Number(status) >= 400,
        );

        expect(failures.length > 0).toBe(route.path !== '/__reset');

        for (const [, response] of failures) expect(refOf(response)).toBe('ApiError');
      });

      it('asks for a token exactly where the guard does', () => {
        const secured = !PUBLIC.has(`${route.method} ${route.path}`);

        expect(operation().security).toEqual(secured ? [{ bearer: [] }] : undefined);
        if (secured) expect(Object.keys(operation().responses)).toContain('401');
      });

      it('describes the request it reads', () => {
        const { requestBody, parameters = [] } = operation();
        const takesBody =
          (route.method === 'POST' || route.method === 'PATCH') && route.path !== '/__reset';
        const takesPath = route.path.includes('{id}');
        const takesQuery = route.method === 'GET' && !takesPath && route.path !== '/auth/me';

        expect(requestBody !== undefined).toBe(takesBody);
        expect(parameters.some((p) => 'in' in p && p.in === 'path')).toBe(takesPath);
        expect(parameters.some((p) => 'in' in p && p.in === 'query')).toBe(takesQuery);
      });
    },
  );
});
