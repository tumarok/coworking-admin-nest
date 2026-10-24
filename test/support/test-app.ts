import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp, createHttpAdapter } from '../../src/configure-app.js';
import { probeImports } from './probe.module.js';

export interface TestApp {
  app: NestExpressApplication;
  http: TestAgent;
  close: () => Promise<void>;
}

/** Runs `work` with environment variables set, then restores them. */
export const withEnv = async <T>(
  values: Record<string, string | undefined>,
  work: () => Promise<T>,
) => {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (source: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await work();
  } finally {
    apply(before);
  }
};

/** The whole application with the probe routes, configured like `main.ts` does. */
export const testApp = async (env: Record<string, string | undefined> = {}): Promise<TestApp> =>
  withEnv(env, async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ...probeImports],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(), {
      bodyParser: false,
      logger: false,
    });
    configureApp(app);
    await app.init();
    return { app, http: request(app.getHttpServer()), close: () => app.close() };
  });
