import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { testApp, withEnv, type TestApp } from './support/test-app.js';

const location = {
  name: 'Riverside Hub',
  city: 'Kyiv',
  address: '12 Naberezhna St',
  timezone: 'Europe/Kyiv',
  opensAt: '08:00',
  closesAt: '20:00',
  status: 'active',
};

describe('transport', () => {
  let api: TestApp;

  beforeAll(async () => {
    api = await testApp();
  });

  afterAll(async () => {
    await api.close();
  });

  describe('unknown routes', () => {
    it('answers 404 with the method and the path below the prefix', async () => {
      const { status, body } = await api.http.put('/api/v1/probe/items/loc_1');

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'No route for PUT /probe/items/loc_1' });
    });

    it('keeps the path as the client wrote it', async () => {
      const { body } = await api.http.get('/api/v1/probe/a%20b/c');

      expect(body).toEqual({ message: 'No route for GET /probe/a%20b/c' });
    });

    it('names the root of the prefix as /', async () => {
      const { body } = await api.http.get('/api/v1');

      expect(body).toEqual({ message: 'No route for GET /' });
    });

    it('is case sensitive', async () => {
      const { status, body } = await api.http.get('/api/v1/Probe/items/1');

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'No route for GET /Probe/items/1' });
    });

    it('answers "Not found" outside the prefix', async () => {
      for (const path of ['/', '/probe/items/1', '/api', '/API/v1/probe/items/1']) {
        const { status, body } = await api.http.get(path);

        expect(status, path).toBe(404);
        expect(body, path).toEqual({ message: 'Not found' });
      }
    });

    it('treats anything that starts with the prefix as inside it, like the mock', async () => {
      const { body } = await api.http.get('/api/v10/x');

      expect(body).toEqual({ message: 'No route for GET 0/x' });
    });
  });

  describe('routing', () => {
    it('allows a trailing slash', async () => {
      const { status, body } = await api.http.get('/api/v1/probe/items/1/');

      expect(status).toBe(200);
      expect(body).toEqual({ id: '1' });
    });

    it('decodes path parameters', async () => {
      const { body } = await api.http.get('/api/v1/probe/items/a%20b');

      expect(body).toEqual({ id: 'a b' });
    });

    it('answers 204 without a body and without a content type', async () => {
      const response = await api.http.delete('/api/v1/probe/items/1');

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(response.headers['content-type']).toBeUndefined();
    });
  });

  describe('request body', () => {
    it('reads a valid body whatever its content type', async () => {
      const { status, body } = await api.http
        .post('/api/v1/probe/echo')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify(location));

      expect(status).toBe(200);
      expect(body).toEqual(location);
    });

    it.each([
      ['a broken JSON', '{"name":', 'Invalid input: expected object, received undefined'],
      ['an empty body', '', 'Invalid input: expected object, received undefined'],
      ['a JSON string', '"abc"', 'Invalid input: expected object, received string'],
      ['a JSON number', '42', 'Invalid input: expected object, received number'],
      ['a JSON null', 'null', 'Invalid input: expected object, received null'],
    ])('answers 422 for %s instead of 400', async (_name, payload, message) => {
      const { status, body } = await api.http
        .post('/api/v1/probe/echo')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: { _: message } });
    });

    it('still answers 404 for a broken body on an unknown route', async () => {
      const { status, body } = await api.http
        .post('/api/v1/probe/nope')
        .set('Content-Type', 'application/json')
        .send('{"name":');

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'No route for POST /probe/nope' });
    });

    it('reads the bytes as UTF-8 whatever charset the request declares', async () => {
      const { status, body } = await api.http
        .post('/api/v1/probe/echo')
        .set('Content-Type', 'text/plain; charset=latin1')
        .send(JSON.stringify({ ...location, name: 'Zażółć Hub' }));

      expect(status).toBe(200);
      expect(body.name).toBe('Zażółć Hub');
    });

    it('answers 413 for a body over the limit', async () => {
      const { status, body } = await api.http
        .post('/api/v1/probe/echo')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ ...location, name: 'x'.repeat(110_000) }));

      expect(status).toBe(413);
      expect(body).toEqual({ message: 'Request body is too large' });
    });
  });

  describe('validation', () => {
    it('reports every invalid field with the first message of each', async () => {
      const { status, body } = await api.http.post('/api/v1/probe/echo').send({
        name: 'X',
        city: 'Kyiv',
        address: '12 Naberezhna St',
        timezone: 'Mars/Base',
        opensAt: '8am',
        closesAt: '20:00',
      });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          name: 'At least 2 characters',
          timezone:
            'Invalid option: expected one of "Europe/Kyiv"|"Europe/Warsaw"|"Europe/Berlin"|"Europe/Lisbon"|"Europe/London"',
          opensAt: 'Use the HH:mm format',
          status: 'Invalid option: expected one of "active"|"inactive"',
        },
      });
    });

    it('skips the refinement while a field has the wrong type or value', async () => {
      const wrongOrder = { ...location, opensAt: '20:00', closesAt: '08:00' };

      const refined = await api.http.post('/api/v1/probe/echo').send(wrongOrder);
      const broken = await api.http
        .post('/api/v1/probe/echo')
        .send({ ...wrongOrder, timezone: 'Mars/Base' });

      expect(refined.body.fieldErrors).toEqual({
        closesAt: 'Closing time must be after opening time',
      });
      expect(broken.body.fieldErrors).toEqual({ timezone: expect.any(String) });
    });

    it('drops keys the schema does not know', async () => {
      const { body } = await api.http
        .post('/api/v1/probe/echo')
        .send({ ...location, id: 'loc_1', roomCount: 3 });

      expect(body).toEqual(location);
    });

    it('answers 404 before 422 when the body is parsed by the service', async () => {
      const missing = await api.http.patch('/api/v1/probe/items/missing').send({});
      const existing = await api.http.patch('/api/v1/probe/items/loc_1').send({});

      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ message: 'Item not found' });
      expect(existing.status).toBe(422);
      expect(existing.body.fieldErrors).toMatchObject({ name: expect.any(String) });
    });
  });

  describe('query', () => {
    it('applies defaults and coerces numbers', async () => {
      const defaults = await api.http.get('/api/v1/probe/page');
      const given = await api.http.get('/api/v1/probe/page?page=2&limit=5&q=%20loft%20');

      expect(defaults.body).toEqual({ page: 1, limit: 20 });
      expect(given.body).toEqual({ page: 2, limit: 5, q: 'loft' });
    });

    it('treats empty values as absent', async () => {
      const { status, body } = await api.http.get('/api/v1/probe/page?page=&limit=&q=');

      expect(status).toBe(200);
      expect(body).toEqual({ page: 1, limit: 20 });
    });

    it('keeps the last value of a repeated key', async () => {
      const { body } = await api.http.get('/api/v1/probe/page?limit=5&limit=7');

      expect(body).toEqual({ page: 1, limit: 7 });
    });

    it('answers 422 for values out of range', async () => {
      const { status, body } = await api.http.get('/api/v1/probe/page?limit=abc&page=0');

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          page: 'Too small: expected number to be >=1',
          limit: 'Invalid input: expected number, received NaN',
        },
      });
    });
  });

  describe('errors', () => {
    it('passes conflicts through', async () => {
      const { status, body } = await api.http.get('/api/v1/probe/conflict');

      expect(status).toBe(409);
      expect(body).toEqual({
        message: 'The room is already booked for this time',
        conflicts: [
          { id: 'bk_1', startsAt: '2026-11-03T09:00:00Z', endsAt: '2026-11-03T10:00:00Z' },
        ],
      });
    });

    it('hides the cause of an unexpected failure and logs it', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      try {
        const { status, body } = await api.http.get('/api/v1/probe/boom');

        expect(status).toBe(500);
        expect(body).toEqual({ message: 'Internal server error' });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('hunter2'));
      } finally {
        error.mockRestore();
      }
    });
  });

  describe('headers', () => {
    it('sends JSON, forbids caching and drops the ETag', async () => {
      const { headers } = await api.http.get('/api/v1/probe/items/1');

      expect(headers['content-type']).toBe('application/json; charset=utf-8');
      expect(headers['cache-control']).toBe('no-store');
      expect(headers.etag).toBeUndefined();
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    it('sends no CORS headers by default', async () => {
      const { headers } = await api.http
        .get('/api/v1/probe/items/1')
        .set('Origin', 'http://localhost:5173');

      expect(headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('CORS_ORIGINS', () => {
  let api: TestApp;

  beforeAll(async () => {
    api = await testApp({ CORS_ORIGINS: 'http://localhost:5173, http://localhost:4200' });
  });

  afterAll(async () => {
    await api.close();
  });

  it('allows the listed origins only', async () => {
    const allowed = await api.http
      .get('/api/v1/probe/items/1')
      .set('Origin', 'http://localhost:4200');
    const other = await api.http.get('/api/v1/probe/items/1').set('Origin', 'http://evil.test');
    const preflight = await api.http
      .options('/api/v1/probe/items/1')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PATCH');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,DELETE');
  });
});

describe('configuration', () => {
  it('refuses to start without the required variables', async () => {
    const start = withEnv({ JWT_SECRET: undefined, DATABASE_URL: undefined }, () =>
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    );

    await expect(start).rejects.toThrow(/Invalid environment:\nDATABASE_URL: .*\nJWT_SECRET: .*/);
  });
});
