import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expectContract } from './support/expect-contract.js';
import { schemaOf } from './support/response-schemas.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

interface Step {
  label: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  auth: 'admin' | 'none' | 'garbage';
  status: number;
  response: unknown;
}

// One run through every module, recorded from the mock API at the same seed and clock: the status
// and body it answered to each request. Ids come from one shared counter, so the requests name them
// as they were issued and a different order of calls would fail the run.
const { steps } = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'golden', 'scenario.json'), 'utf8'),
) as { steps: Step[] };

const withoutToken = (body: unknown) =>
  typeof body === 'object' && body !== null && 'token' in body
    ? { ...body, token: '<token>' }
    : body;

describe('the scenario recorded from the mock', () => {
  let api: SeededApp;
  let token: string;

  beforeAll(async () => {
    api = await seededApp({ ENABLE_RESET: 'true' });
    token = await signIn(api);
  });

  afterAll(async () => {
    await api.close();
  });

  it('has the steps of every module', () => {
    const paths = new Set(steps.map((step) => step.path.split('/')[1]));

    expect(steps).toHaveLength(62);
    expect([...paths]).toEqual(
      expect.arrayContaining(['auth', 'locations', 'rooms', 'members', 'bookings', 'dashboard']),
    );
  });

  describe('answers like the mock to', () => {
    it.each(steps.map((step, index) => [`${index + 1}. ${step.label}`, step] as const))(
      '%s',
      async (_name, step) => {
        const headers =
          step.auth === 'admin'
            ? bearer(token)
            : step.auth === 'garbage'
              ? bearer('not-a-token')
              : {};
        const request = api.http[step.method.toLowerCase() as 'get'](`/api/v1${step.path}`)
          .query(step.query)
          .set(headers);

        const { status, body, text } = await (step.body === undefined
          ? request
          : request.send(step.body as object));

        expect(status).toBe(step.status);
        const schema = schemaOf(step.method, step.path, status);
        if (schema) expectContract(schema, body);
        else expect(text).toBe('');
        expect(withoutToken(body)).toEqual(schema ? withoutToken(step.response) : {});
      },
    );
  });
});
