import { seededApp, type SeededApp } from './support/seeded-app.js';

// Every e2e test of the frontends starts with a reset, so it has to stay quick: a second or more
// would add minutes to a suite. A reset takes about 100-200 ms on an idle machine and up to 300 ms
// with a browser busy next to it, so the limit leaves room for that. The `timing` project runs after
// the others. A shared CI runner is too slow and noisy to hold to any limit, so there the time is
// only reported.
describe('POST /__reset speed', () => {
  let api: SeededApp;

  beforeAll(async () => {
    api = await seededApp({ ENABLE_RESET: 'true' });
  });

  afterAll(async () => {
    await api.close();
  });

  it('is fast enough to run before every e2e test', async () => {
    await api.http.post('/api/v1/__reset').expect(204);
    const started = performance.now();
    await api.http.post('/api/v1/__reset').expect(204);
    const elapsed = performance.now() - started;

    if (process.env.CI === undefined) expect(elapsed).toBeLessThan(600);
    else process.stdout.write(`POST /__reset took ${Math.round(elapsed)} ms\n`);
  });
});
