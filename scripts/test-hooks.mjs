#!/usr/bin/env node
/**
 * Self-test for .claude/hooks/*.mjs. Feeds real hook payloads over stdin and
 * asserts exit codes. Run: `node scripts/test-hooks.mjs` (exit 0 = all pass).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
const hook = (name, payload) =>
  spawnSync(process.execPath, [join(root, '.claude', 'hooks', name)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env,
    timeout: 200000,
  });

const outside = join(parse(root).root, 'definitely-not-this-project', 'x.ts');
const siblingPrefix = `${root}-evil${root.includes('\\') ? '\\' : '/'}x.ts`;
const flipCase = (p) => (/^[a-z]:/i.test(p) ? (p[0] === p[0].toUpperCase() ? p[0].toLowerCase() : p[0].toUpperCase()) + p.slice(1) : p);

const cases = [
  ['write inside project', 'Write', join(root, 'src', 'x.ts'), 0],
  ['write inside (drive-letter case flipped)', 'Write', flipCase(join(root, 'src', 'x.ts')), process.platform === 'win32' || !/^[a-z]:/i.test(root) ? 0 : 2],
  ['write inside worktree', 'Write', join(root, '.claude', 'worktrees', 'slice-a', 'src', 'a.ts'), 0],
  ['edit outside project', 'Edit', outside, 2],
  ['write to sibling dir sharing the prefix', 'Write', siblingPrefix, 2],
  ['read .env', 'Read', join(root, '.env'), 2],
  ['write .env.local', 'Write', join(root, '.env.local'), 2],
  ['write .env.example (allowed)', 'Write', join(root, '.env.example'), 0],
  ['read file outside project (allowed)', 'Read', outside, 0],
];

let failed = 0;
const report = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}${detail ? `  (${detail})` : ''}`);
};

for (const [label, tool, file, expected] of cases) {
  const r = hook('project-boundary.mjs', { tool_name: tool, tool_input: { file_path: file } });
  report(r.status === expected, `project-boundary: ${label}`, `exit ${r.status}, expected ${expected}`);
}
const garbage = hook('project-boundary.mjs', 'not json');
report(garbage.status === 0, 'project-boundary: malformed payload fails open', `exit ${garbage.status}`);

// auto-format
const fmtFile = join(root, 'src', '__hook_fmt_probe.ts');
writeFileSync(fmtFile, 'const   x  =  {a:1}\n');
const fmt = hook('auto-format.mjs', { tool_input: { file_path: fmtFile } });
const formatted = readFileSync(fmtFile, 'utf8');
rmSync(fmtFile);
report(fmt.status === 0 && formatted === 'const x = { a: 1 };\n', 'auto-format: prettier rewrites TS file', JSON.stringify(formatted));

// verify-stop
const loopGuard = hook('verify-stop.mjs', { stop_hook_active: true });
report(loopGuard.status === 0, 'verify-stop: stop_hook_active short-circuits', `exit ${loopGuard.status}`);
const clean = hook('verify-stop.mjs', {});
report(clean.status === 0, 'verify-stop: clean typecheck allows stop', `exit ${clean.status}`);
const probe = join(root, 'src', '__hook_stop_probe.ts');
writeFileSync(probe, 'export const x: number = "nope";\n');
const broken = hook('verify-stop.mjs', {});
rmSync(probe);
report(broken.status === 2 && /TS2322/.test(broken.stderr), 'verify-stop: type error blocks stop (exit 2)', `exit ${broken.status}`);

console.log(`\n${failed ? `${failed} hook test(s) FAILED` : 'all hook tests passed'}`);
process.exit(failed ? 1 : 0);
