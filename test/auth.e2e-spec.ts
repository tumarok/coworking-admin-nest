import { JwtService } from '@nestjs/jwt';
import { loginResponseSchema, userSchema } from '../src/contract/index.js';
import { SEED_NOW, TEST_JWT_SECRET } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import { bearer, signIn } from './support/sign-in.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';

const admin = {
  id: 'usr_admin',
  name: 'Alex Morgan',
  email: 'admin@coworking.test',
  role: 'admin',
};

describe('auth', () => {
  let api: SeededApp;

  beforeAll(async () => {
    api = await seededApp();
  });

  afterAll(async () => {
    await api.close();
  });

  describe('POST /auth/login', () => {
    it('signs the admin in with 200, a token and the user', async () => {
      const { status, body } = await api.http
        .post('/api/v1/auth/login')
        .send({ email: 'admin@coworking.test', password: 'demo1234' });

      expect(status).toBe(200);
      expectContract(loginResponseSchema, body);
      expect(body.user).toEqual(admin);
      expect(body).toEqual({ token: expect.any(String), user: admin });
      expect((body.token as string).split('.')).toHaveLength(3);
    });

    it('signs the manager in', async () => {
      const { body } = await api.http
        .post('/api/v1/auth/login')
        .send({ email: 'manager@coworking.test', password: 'demo1234' });

      expect(body.user).toEqual({
        id: 'usr_manager',
        name: 'Sam Rivera',
        email: 'manager@coworking.test',
        role: 'manager',
      });
    });

    it('does not mind the case of the email', async () => {
      const { status, body } = await api.http
        .post('/api/v1/auth/login')
        .send({ email: 'ADMIN@Coworking.test', password: 'demo1234' });

      expect(status).toBe(200);
      expect(body.user.email).toBe('admin@coworking.test');
    });

    it.each([
      ['a wrong password', { email: 'admin@coworking.test', password: 'nope' }],
      ['an unknown email', { email: 'nobody@coworking.test', password: 'demo1234' }],
      ['a password in another case', { email: 'admin@coworking.test', password: 'DEMO1234' }],
    ])('answers 401 for %s', async (_name, credentials) => {
      const { status, body } = await api.http.post('/api/v1/auth/login').send(credentials);

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Invalid email or password' });
    });

    it('answers 422 for an invalid body, before looking at the credentials', async () => {
      const { status, body } = await api.http
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { email: 'Enter a valid email', password: 'Enter your password' },
      });
    });

    it('answers 422 for a missing body', async () => {
      const { status, body } = await api.http.post('/api/v1/auth/login');

      expect(status).toBe(422);
      expect(body.fieldErrors).toHaveProperty('_');
    });
  });

  describe('GET /auth/me', () => {
    it('answers 401 without a token, which is what readiness probes wait for', async () => {
      const { status, body } = await api.http.get('/api/v1/auth/me');

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });

    it('answers 200 with the user of the token', async () => {
      const token = await signIn(api);

      const { status, body } = await api.http.get('/api/v1/auth/me').set(bearer(token));

      expect(status).toBe(200);
      expect(expectContract(userSchema, body)).toEqual(admin);
    });

    it('takes the scheme in any case', async () => {
      const token = await signIn(api);

      const { status } = await api.http
        .get('/api/v1/auth/me')
        .set('Authorization', `bearer ${token}`);

      expect(status).toBe(200);
    });

    it('answers 401 for a bare token without the scheme', async () => {
      const token = await signIn(api);

      const { status } = await api.http.get('/api/v1/auth/me').set('Authorization', token);

      expect(status).toBe(401);
    });

    it('answers 401 for the mock API token', async () => {
      const { status, body } = await api.http
        .get('/api/v1/auth/me')
        .set(bearer('demo-token.usr_admin'));

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });

    it('answers 401 for a token that belongs to nobody, as the Next.js e2e sends', async () => {
      const { status } = await api.http.get('/api/v1/auth/me').set(bearer('demo-token.nobody'));

      expect(status).toBe(401);
    });

    it('answers 401 for an expired token and for one signed elsewhere', async () => {
      // The application's clock stands at SEED_NOW, so "expired" is relative to that.
      const expired = new JwtService({ secret: TEST_JWT_SECRET }).sign({
        sub: 'usr_admin',
        exp: SEED_NOW.getTime() / 1000 - 10,
      });
      const foreign = new JwtService({ secret: 'x'.repeat(40) }).sign({ sub: 'usr_admin' });

      for (const token of [expired, foreign]) {
        const { status, body } = await api.http.get('/api/v1/auth/me').set(bearer(token));

        expect(status).toBe(401);
        expect(body).toEqual({ message: 'Authentication required' });
      }
    });

    it('answers 401 when the user of a valid token no longer exists', async () => {
      const token = new JwtService({ secret: TEST_JWT_SECRET }).sign({
        sub: 'usr_gone',
      });

      const { status } = await api.http.get('/api/v1/auth/me').set(bearer(token));

      expect(status).toBe(401);
    });
  });

  describe('the guard', () => {
    it('answers 404 before 401 for a route that does not exist', async () => {
      const { status, body } = await api.http.get('/api/v1/nope');

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'No route for GET /nope' });
    });

    it('leaves /health open', async () => {
      const { status } = await api.http.get('/health');

      expect(status).toBe(200);
    });

    it('protects every route that is not marked public', async () => {
      const token = await signIn(api);
      const anonymous = await api.http.get('/api/v1/probe-protected');
      const signedIn = await api.http.get('/api/v1/probe-protected').set(bearer(token));

      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toEqual({ message: 'Authentication required' });
      expect(signedIn.status).toBe(200);
    });
  });
});
