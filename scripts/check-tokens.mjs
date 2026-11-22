#!/usr/bin/env node
/**
 * Design-token lint. Fails (exit 1) if src/screens or src/components contain:
 *   - raw hex colors  (#abc, #aabbcc, #aabbccdd)
 *   - rgb()/rgba()/hsl() color literals
 *   - numeric literals on spacing/sizing/typography style keys (0 is allowed)
 * Comments are stripped before scanning. Cross-platform (Node ≥ 18).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const targets = ['src/screens', 'src/components'].map((d) => join(root, d));

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_FN = /\b(?:rgba?|hsla?)\s*\(/g;
const SPACING_KEYS =
  '(?:padding|margin)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|gap|rowGap|columnGap|top|bottom|left|right|width|height|minWidth|minHeight|maxWidth|maxHeight|borderRadius|border(?:Top|Bottom|Left|Right)?Width|fontSize|lineHeight|letterSpacing|elevation|shadowRadius';
const MAGIC = new RegExp(`\\b(${SPACING_KEYS})\\s*:\\s*(-?\\d*\\.?\\d+)\\b`, 'g');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return ['.ts', '.tsx'].includes(extname(p)) ? [p] : [];
  });
}

function stripComments(src) {
  // Replace comments with same-length whitespace so line numbers stay correct.
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

const violations = [];
const files = targets.flatMap(walk);
for (const file of files) {
  const text = stripComments(readFileSync(file, 'utf8'));
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const loc = `${relative(root, file).replace(/\\/g, '/')}:${i + 1}`;
    for (const m of line.matchAll(HEX)) violations.push(`${loc}  raw hex color ${m[0]}`);
    for (const m of line.matchAll(COLOR_FN)) violations.push(`${loc}  raw color function ${m[0]}`);
    for (const m of line.matchAll(MAGIC)) {
      if (Number(m[2]) !== 0) violations.push(`${loc}  magic value ${m[1]}: ${m[2]}`);
    }
  });
}

if (violations.length) {
  console.error(`✖ design-token lint: ${violations.length} violation(s)\n` + violations.join('\n'));
  console.error('\nUse tokens from src/theme/tokens.ts (colors, spacing, radii, sizes, typography).');
  process.exit(1);
}
console.log(`✔ design-token lint: ${files.length} file(s) in src/screens + src/components, 0 violations`);
