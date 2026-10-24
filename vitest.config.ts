import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  test: {
    globals: true,
    projects: [
      { plugins, test: { name: 'unit', globals: true, include: ['src/**/*.spec.ts'] } },
      { plugins, test: { name: 'e2e', globals: true, include: ['test/**/*.e2e-spec.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/generated/**', 'src/**/*.spec.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
