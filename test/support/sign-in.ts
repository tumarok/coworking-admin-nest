import { expectContract } from './expect-contract.js';
import type { TestApp } from './test-app.js';
import { loginResponseSchema } from '../../src/contract/index.js';

export const DEMO_PASSWORD = 'demo1234';
export const ADMIN_EMAIL = 'admin@coworking.test';

/** Signs in through the API and returns the access token. */
export const signIn = async (
  api: Pick<TestApp, 'http'>,
  email = ADMIN_EMAIL,
  password = DEMO_PASSWORD,
): Promise<string> => {
  const { status, body } = await api.http.post('/api/v1/auth/login').send({ email, password });
  expect(status).toBe(200);
  return expectContract(loginResponseSchema, body).token;
};

/** The header of an authenticated request: `http.get(path).set(bearer(token))`. */
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
