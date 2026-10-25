// PostToolUse hook: formats the file that was just edited or written with the project's Prettier.
// A hook must never get in the way of the work, so every failure ends in a silent exit 0.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const EXTENSIONS = new Set(['.ts', '.mjs', '.json', '.md', '.yml', '.yaml']);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'generated',
  'migrations',
]);
const SKIPPED_FILES = new Set(['package-lock.json']);

try {
  const { tool_input: input } = JSON.parse(readFileSync(0, 'utf8'));
  const file = path.resolve(root, input.file_path);
  const relative = path.relative(root, file);
  const inProject = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  const skipped =
    SKIPPED_FILES.has(path.basename(file)) ||
    relative.split(path.sep).some((part) => SKIPPED_DIRECTORIES.has(part));

  if (inProject && !skipped && EXTENSIONS.has(path.extname(file))) {
    spawnSync('npx', ['--no-install', 'prettier', '--write', file], { cwd: root, stdio: 'ignore' });
  }
} catch {
  // Not JSON, no file path, Prettier missing: nothing to do.
}
