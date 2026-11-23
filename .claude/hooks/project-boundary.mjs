#!/usr/bin/env node
/**
 * PreToolUse hook (Read|Edit|Write|MultiEdit|NotebookEdit).
 *  - Blocks writes outside $CLAUDE_PROJECT_DIR (falls back to this repo's root).
 *  - Blocks reading or writing .env secrets anywhere (.env.example is allowed).
 * Exit 2 = block (stderr is shown to Claude). Exit 0 = allow.
 * Cross-platform: Windows (case-insensitive paths, spaces), macOS, Linux, cloud.
 */
import { resolve, sep, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectRoot = resolve(process.env.CLAUDE_PROJECT_DIR || scriptRoot);
const isWin = process.platform === 'win32';
const norm = (p) => {
  const r = resolve(p);
  return isWin ? r.toLowerCase() : r;
};

const SECRET_FILE = /^\.env(\..+)?$/i;
const ALLOWED_ENV = /^\.env\.example$/i;

function isInside(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

try {
  const payload = JSON.parse((await readStdin()) || '{}');
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  const target = input.file_path || input.notebook_path || input.path;
  if (!target) process.exit(0);

  const abs = resolve(payload.cwd || projectRoot, target);
  const name = basename(abs);

  if (SECRET_FILE.test(name) && !ALLOWED_ENV.test(name)) {
    console.error(
      `Blocked by project-boundary hook: ${tool} on secret file "${name}". ` +
        'Secrets stay out of the agent context. Edit .env.example instead, or ask the human to set the value.',
    );
    process.exit(2);
  }

  const isWrite = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool);
  if (isWrite && !isInside(abs, projectRoot)) {
    console.error(
      `Blocked by project-boundary hook: ${tool} outside the project.\n  target:  ${abs}\n  project: ${projectRoot}`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch (err) {
  // Never brick the session on a malformed payload — allow, but say why.
  console.error(`project-boundary hook: could not parse payload (${err.message}); allowing.`);
  process.exit(0);
}
