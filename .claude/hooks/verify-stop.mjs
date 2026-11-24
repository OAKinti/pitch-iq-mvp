#!/usr/bin/env node
/**
 * Stop hook: refuse to end the turn while TypeScript fails to compile.
 *  - Skips when stop_hook_active is true (prevents infinite re-entry loops).
 *  - Skips when there is no package.json or node_modules (fresh clone / cloud cold start).
 *  - Skips when git reports no uncommitted .ts/.tsx/tsconfig/package files.
 * Exit 2 = block stop and feed errors back to Claude. Exit 0 = allow stop.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  process.exit(0);
}
if (payload.stop_hook_active) process.exit(0);

const root = resolve(
  process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
);
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(join(root, 'package.json')) || !existsSync(tsc)) process.exit(0);

// Skip the ~1 min typecheck when no TypeScript input is uncommitted (most stops in a long session).
// If git itself fails, fall through and typecheck.
const dirty = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all', '--', '*.ts', '*.tsx', 'tsconfig.json', 'package.json', 'package-lock.json'],
  { cwd: root, encoding: 'utf8', timeout: 20000 },
);
if (dirty.status === 0 && !dirty.stdout.trim()) process.exit(0);

const res = spawnSync(process.execPath, [tsc, '--noEmit', '-p', join(root, 'tsconfig.json')], {
  cwd: root,
  encoding: 'utf8',
  timeout: 170000,
});

if (res.status === 0) process.exit(0);

const out = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n');
console.error(
  `verify-stop hook: \`npm run typecheck\` failed (${out.length} line(s)). Fix these before stopping:\n` +
    out.slice(0, 40).join('\n'),
);
process.exit(2);
