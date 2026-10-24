// ESLint flat config. Later blocks win, and a block that declares a rule again replaces its
// options instead of merging them.
//
// Layout enforced by the boundaries block (docs: README, "Architecture"):
// - modules/* import common, config, contract and database, never each other;
// - dev -> database, common, config; database -> contract, config, common/clock, common/ids;
// - common -> contract, config; contract -> zod only; main.ts, app.module.ts and
//   configure-app.ts may import anything; test/ may import anything.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ELEMENTS = [
  { type: 'module', pattern: 'src/modules/*', capture: ['module'] },
  { type: 'common', pattern: 'src/common/*', capture: ['area'] },
  { type: 'config', pattern: 'src/config' },
  { type: 'contract', pattern: 'src/contract' },
  { type: 'database', pattern: 'src/database' },
  { type: 'dev', pattern: 'src/dev' },
  { type: 'generated', pattern: 'src/generated' },
  { type: 'test', pattern: 'test' },
];

// Entry files next to the module folders: main.ts, app.module.ts, configure-app.ts.
const FILES = [{ category: 'root', pattern: 'src/*.ts' }];

const types = (...names) => ({ element: { type: names } });
const ownModule = { type: 'module', captured: { module: '{{ from.captured.module }}' } };

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'src/generated/**']),
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Nest modules and DTO holders are decorated classes without members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/contract/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!zod$|\\.{1,2}/)',
              message: 'The contract depends on zod only, so frontends can copy it unchanged.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*', 'test/**/*'],
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': ELEMENTS,
      'boundaries/files': FILES,
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkInternals: true,
          policies: [
            {
              from: { file: { categories: 'root' } },
              allow: [
                { to: types(...ELEMENTS.map((e) => e.type)) },
                { to: { file: { categories: 'root' } } },
              ],
            },
            {
              from: types('test'),
              allow: [
                { to: types(...ELEMENTS.map((e) => e.type)) },
                { to: { file: { categories: 'root' } } },
              ],
            },
            {
              from: types('module'),
              allow: [
                { to: { element: ownModule } },
                { to: types('common', 'config', 'contract', 'database', 'generated') },
              ],
            },
            {
              from: types('dev'),
              allow: { to: types('dev', 'database', 'common', 'config', 'generated') },
            },
            {
              from: types('database'),
              allow: [
                { to: types('database', 'contract', 'config', 'generated') },
                { to: { element: { type: 'common', captured: { area: ['clock', 'ids'] } } } },
              ],
            },
            { from: types('common'), allow: { to: types('common', 'contract', 'config') } },
            { from: types('config'), allow: { to: types('config', 'contract') } },
            { from: types('contract'), allow: { to: types('contract') } },
          ],
        },
      ],
    },
  },
  prettier,
]);
