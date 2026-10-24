import { seededApp, type SeededApp } from './support/seeded-app.js';

// The plan asks for a reset under 300 ms because every e2e test of the frontends starts with one.
// The `timing` project runs after the others, when nothing else loads the machine. A shared CI
// runner is too slow and noisy to hold to the limit, so there the time is only reported.
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

    if (process.env.CI === undefined) expect(elapsed).toBeLessThan(300);
    else process.stdout.write(`POST /__reset took ${Math.round(elapsed)} ms\n`);
  });
});
