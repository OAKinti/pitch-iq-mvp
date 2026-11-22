#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|Write|MultiEdit): run the repo-local Prettier on the
 * modified file when it is TS/TSX/JS/MJS/JSON. Never blocks (always exit 0).
 * Uses node + prettier's JS entry directly — no shell, so paths with spaces work.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  const file = payload.tool_input?.file_path;
  if (!file) process.exit(0);
  const ext = extname(file).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'].includes(ext)) process.exit(0);

  const root = resolve(
    process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  );
  const abs = resolve(payload.cwd || root, file);
  if (!existsSync(abs)) process.exit(0);

  // Prefer the prettier installed next to the file (worktrees), then the project root.
  const candidates = [];
  let dir = dirname(abs);
  while (true) {
    candidates.push(join(dir, 'node_modules', 'prettier', 'bin', 'prettier.cjs'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'));
  const bin = candidates.find((c) => existsSync(c));
  if (!bin) process.exit(0);

  const res = spawnSync(process.execPath, [bin, '--write', '--log-level', 'warn', abs], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (res.status !== 0 && res.stderr) console.error(`prettier: ${res.stderr.trim().slice(0, 500)}`);
} catch (err) {
  console.error(`auto-format hook skipped: ${err.message}`);
}
process.exit(0);
