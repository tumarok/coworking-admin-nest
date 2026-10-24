import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_JWT_SECRET } from './test/support/constants.js';

// esbuild does not emit decorator metadata, which Nest needs for constructor injection, so SWC
// compiles the TypeScript.
const plugins = [
  swc.vite({
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
    module: { type: 'es6' },
  }),
];

// The environment every test starts from; a test changes single values with `withEnv`.
const env = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5433/coworking_test',
  JWT_SECRET: TEST_JWT_SECRET,
  ENABLE_RESET: 'false',
  CORS_ORIGINS: '',
};

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          globals: true,
          env,
          include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
        },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          globals: true,
          env,
          include: ['test/**/*.e2e-spec.ts'],
          globalSetup: ['test/setup/global-setup.ts'],
          // The first run pulls the image and a slow runner needs time to start PostgreSQL.
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/database/seed/cli.ts', 'src/generated/**', 'src/**/*.spec.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
