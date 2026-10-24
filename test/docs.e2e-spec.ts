import { buildOpenApiDocument } from '../src/common/openapi/openapi-document.js';
import { testApp, type TestApp } from './support/test-app.js';

describe('API documentation', () => {
  let api: TestApp;

  beforeAll(async () => {
    api = await testApp();
  });

  afterAll(async () => {
    await api.close();
  });

  describe('GET /docs', () => {
    it('serves the API reference page', async () => {
      const { status, headers, text } = await api.http.get('/docs');

      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/^text\/html/);
      expect(text).toContain('Coworking Admin API');
    });

    it('allows the reference scripts from its CDN on this page only', async () => {
      const docs = await api.http.get('/docs');
      const other = await api.http.get('/api/v1/auth/me');

      expect(docs.headers['content-security-policy']).toContain(
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      );
      expect(other.headers['content-security-policy']).toContain("script-src 'self'");
      expect(other.headers['content-security-policy']).not.toContain('jsdelivr');
    });

    it('answers a trailing slash', async () => {
      expect((await api.http.get('/docs/')).status).toBe(200);
    });
  });

  describe('the OpenAPI document', () => {
    const document = () => buildOpenApiDocument(api.app);
    const responses = (path: string, method: 'get' | 'post' | 'patch' | 'delete') => {
      const operation = document().paths[path][method];
      return Object.fromEntries(
        Object.entries(operation?.responses ?? {}).map(([status, response]) => [
          status,
          JSON.stringify(response),
        ]),
      );
    };

    it('is OpenAPI 3.1 with bearer authentication', () => {
      const { openapi, components } = document();

      expect(openapi).toBe('3.1.0');
      expect(components?.securitySchemes).toMatchObject({
        bearer: { type: 'http', scheme: 'bearer' },
      });
    });

    it('describes the contract schemas as components', () => {
      const schemas = document().components?.schemas ?? {};

      expect(Object.keys(schemas)).toEqual(
        expect.arrayContaining([
          'ApiError',
          'Booking',
          'BookingInput',
          'BookingPage',
          'BulkBookingRequest',
          'BulkBookingResult',
          'Location',
          'LocationInput',
          'LocationPage',
          'Member',
          'MemberInput',
          'MemberPage',
          'Room',
          'RoomInput',
          'RoomPage',
          'User',
        ]),
      );
      expect(schemas.LocationInput).toMatchObject({
        required: ['name', 'city', 'address', 'timezone', 'opensAt', 'closesAt', 'status'],
        properties: { name: { type: 'string', minLength: 2, maxLength: 80 } },
      });
    });

    it('documents every location route with its success and error bodies', () => {
      const { paths } = document();

      expect(Object.keys(paths['/api/v1/locations'] ?? {})).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/v1/locations/{id}'] ?? {})).toEqual([
        'get',
        'patch',
        'delete',
      ]);
      expect(Object.keys(responses('/api/v1/locations', 'get'))).toEqual(['200', '401', '422']);
      expect(Object.keys(responses('/api/v1/locations', 'post'))).toEqual(['201', '401', '422']);
      expect(Object.keys(responses('/api/v1/locations/{id}', 'get'))).toEqual([
        '200',
        '401',
        '404',
      ]);
      expect(Object.keys(responses('/api/v1/locations/{id}', 'patch'))).toEqual([
        '200',
        '401',
        '404',
        '422',
      ]);
      expect(Object.keys(responses('/api/v1/locations/{id}', 'delete'))).toEqual([
        '204',
        '401',
        '404',
        '409',
      ]);
      expect(responses('/api/v1/locations/{id}', 'delete')['204']).not.toContain(
        'application/json',
      );
      expect(responses('/api/v1/locations', 'post')['201']).toContain(
        '#/components/schemas/Location',
      );
    });

    it('documents every room route with its success and error bodies', () => {
      const { paths } = document();

      expect(Object.keys(paths['/api/v1/rooms'] ?? {})).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/v1/rooms/{id}'] ?? {})).toEqual(['get', 'patch', 'delete']);
      expect(Object.keys(responses('/api/v1/rooms', 'get'))).toEqual(['200', '401', '422']);
      expect(Object.keys(responses('/api/v1/rooms', 'post'))).toEqual(['201', '401', '422']);
      expect(Object.keys(responses('/api/v1/rooms/{id}', 'get'))).toEqual(['200', '401', '404']);
      expect(Object.keys(responses('/api/v1/rooms/{id}', 'patch'))).toEqual([
        '200',
        '401',
        '404',
        '422',
      ]);
      expect(Object.keys(responses('/api/v1/rooms/{id}', 'delete'))).toEqual([
        '204',
        '401',
        '404',
        '409',
      ]);
      expect(responses('/api/v1/rooms/{id}', 'delete')['204']).not.toContain('application/json');
      expect(responses('/api/v1/rooms', 'post')['201']).toContain('#/components/schemas/Room');
    });

    it('documents every member route with its success and error bodies', () => {
      const { paths } = document();

      expect(Object.keys(paths['/api/v1/members'] ?? {})).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/v1/members/{id}'] ?? {})).toEqual(['get', 'patch', 'delete']);
      expect(Object.keys(responses('/api/v1/members', 'get'))).toEqual(['200', '401', '422']);
      expect(Object.keys(responses('/api/v1/members', 'post'))).toEqual(['201', '401', '422']);
      expect(Object.keys(responses('/api/v1/members/{id}', 'get'))).toEqual(['200', '401', '404']);
      expect(Object.keys(responses('/api/v1/members/{id}', 'patch'))).toEqual([
        '200',
        '401',
        '404',
        '422',
      ]);
      expect(Object.keys(responses('/api/v1/members/{id}', 'delete'))).toEqual([
        '204',
        '401',
        '404',
        '409',
      ]);
      expect(responses('/api/v1/members/{id}', 'delete')['204']).not.toContain('application/json');
      expect(responses('/api/v1/members', 'post')['201']).toContain('#/components/schemas/Member');
    });

    it('documents every booking route with its success and error bodies', () => {
      const { paths } = document();

      expect(Object.keys(paths['/api/v1/bookings'] ?? {})).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/v1/bookings/{id}'] ?? {})).toEqual(['get', 'patch']);
      expect(Object.keys(paths['/api/v1/bookings/bulk'] ?? {})).toEqual(['post']);
      expect(Object.keys(paths['/api/v1/bookings/{id}/status'] ?? {})).toEqual(['post']);
      expect(Object.keys(responses('/api/v1/bookings', 'get'))).toEqual(['200', '401', '422']);
      expect(Object.keys(responses('/api/v1/bookings', 'post'))).toEqual([
        '201',
        '401',
        '409',
        '422',
      ]);
      expect(Object.keys(responses('/api/v1/bookings/{id}', 'get'))).toEqual(['200', '401', '404']);
      expect(Object.keys(responses('/api/v1/bookings/{id}', 'patch'))).toEqual([
        '200',
        '401',
        '404',
        '409',
        '422',
      ]);
      expect(responses('/api/v1/bookings', 'post')['201']).toContain(
        '#/components/schemas/Booking',
      );
      expect(Object.keys(responses('/api/v1/bookings/bulk', 'post'))).toEqual([
        '200',
        '401',
        '422',
      ]);
      expect(Object.keys(responses('/api/v1/bookings/{id}/status', 'post'))).toEqual([
        '200',
        '401',
        '404',
        '409',
        '422',
      ]);
      expect(responses('/api/v1/bookings/bulk', 'post')['200']).toContain(
        '#/components/schemas/BulkBookingResult',
      );
      expect(responses('/api/v1/bookings/{id}/status', 'post')['200']).toContain(
        '#/components/schemas/Booking',
      );
    });

    it('describes the body of a booking status change, which a pipe does not validate', () => {
      const body = document().paths['/api/v1/bookings/{id}/status'].post?.requestBody;
      const schema =
        body && 'content' in body ? body.content['application/json'].schema : undefined;

      expect(schema).toMatchObject({ type: 'object', required: ['status'] });
    });

    it('describes the body of a bulk request by its component', () => {
      const body = document().paths['/api/v1/bookings/bulk'].post?.requestBody;

      expect(JSON.stringify(body)).toContain('#/components/schemas/BulkBookingRequest');
    });

    it('lists the query of the bookings list', () => {
      const parameters = document().paths['/api/v1/bookings'].get?.parameters ?? [];

      expect(
        parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined)),
      ).toEqual(['page', 'limit', 'q', 'from', 'to', 'status', 'locationId', 'roomId', 'memberId']);
    });

    it('describes the body of a booking PATCH, which a pipe does not validate', () => {
      const body = document().paths['/api/v1/bookings/{id}'].patch?.requestBody;
      const schema =
        body && 'content' in body ? body.content['application/json'].schema : undefined;

      expect(schema).toMatchObject({
        type: 'object',
        required: expect.arrayContaining(['roomId', 'memberId', 'startsAt', 'endsAt']),
      });
    });

    it('lists the query of the rooms list', () => {
      const parameters = document().paths['/api/v1/rooms'].get?.parameters ?? [];

      expect(
        parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined)),
      ).toEqual(['page', 'limit', 'q', 'locationId', 'type', 'status', 'minCapacity']);
    });

    it('lists the query of the members list', () => {
      const parameters = document().paths['/api/v1/members'].get?.parameters ?? [];

      expect(
        parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined)),
      ).toEqual(['page', 'limit', 'q', 'plan', 'status']);
    });

    it('lists the query of the locations list', () => {
      const parameters = document().paths['/api/v1/locations'].get?.parameters ?? [];

      expect(
        parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined)),
      ).toEqual(['page', 'limit', 'q', 'city', 'status']);
    });

    it('describes the body of a PATCH, which a pipe does not validate', () => {
      const body = document().paths['/api/v1/locations/{id}'].patch?.requestBody;

      expect(JSON.stringify(body)).toContain('"required":["name","city"');
    });

    it('describes the body of a room PATCH, which a pipe does not validate', () => {
      const body = document().paths['/api/v1/rooms/{id}'].patch?.requestBody;

      expect(JSON.stringify(body)).toContain('"required":["locationId","name"');
    });

    it('describes the body of a member PATCH, which a pipe does not validate', () => {
      const body = document().paths['/api/v1/members/{id}'].patch?.requestBody;

      expect(JSON.stringify(body)).toContain('"required":["firstName","lastName"');
    });

    it('does not ask for a token to sign in', () => {
      const { paths } = document();

      expect(paths['/api/v1/auth/login'].post?.security).toBeUndefined();
      expect(Object.keys(responses('/api/v1/auth/login', 'post'))).toEqual(['200', '401', '422']);
      expect(paths['/api/v1/auth/me'].get?.security).toEqual([{ bearer: [] }]);
    });
  });
});
