#!/usr/bin/env node
/**
 * COPPA 2026 / Illinois BIPA / Strava-terms / unit-economics invariant checks.
 * Static analysis only — complements (never replaces) the Jest enforcement tests.
 * Exit 1 on any failure. Cross-platform (Node ≥ 18).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const rel = (p) => relative(root, p).replace(/\\/g, '/');
const read = (p) => readFileSync(join(root, p), 'utf8');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

function walk(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) return walk(rel(p));
    return ['.ts', '.tsx'].includes(extname(p)) ? [p] : [];
  });
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
const srcFiles = walk('src').filter((f) => !rel(f).includes('__tests__'));

/* 1. Migration invariants */
const migDir = join(root, 'supabase/migrations');
const sql = existsSync(migDir)
  ? readdirSync(migDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(migDir, f), 'utf8'))
      .join('\n')
      .replace(/--[^\n]*/g, '')
  : '';
const tables = [...sql.matchAll(/create table\s+(?:if not exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
const rls = new Set(
  [...sql.matchAll(/alter table\s+public\.(\w+)\s+enable row level security/gi)].map((m) => m[1]),
);
const missingRls = tables.filter((t) => !rls.has(t));
check('RLS enabled on every table', tables.length > 0 && missingRls.length === 0,
  missingRls.length ? `missing: ${missingRls.join(', ')}` : `${tables.length} tables`);
check('raw_video_expires_at defaults to ≤ 90 days',
  /raw_video_expires_at\s+timestamptz\s+not null\s+default\s+\(now\(\)\s*\+\s*interval\s+'90 days'\)/i.test(sql));
check('raw_video_expires_at hard CHECK ≤ created_at + 90 days',
  /check\s*\(\s*raw_video_expires_at\s*<=\s*created_at\s*\+\s*interval\s+'90 days'\s*\)/i.test(sql));
check('raw video purge function present', /function\s+public\.purge_expired_raw_videos/i.test(sql));
check('under-13 profiles forced private',
  /age_bracket\s*<>\s*'under_13'\s+or\s+visibility\s*=\s*'private'/i.test(sql));
const ingestEnum = sql.match(/create type public\.ingestion_source as enum \(([^)]*)\)/i);
check('wearable ingestion enum excludes strava', ingestEnum && !/strava/i.test(ingestEnum[1]));
check('no birthdate column stored', !/\b(birth_?date|date_of_birth|dob)\b/i.test(sql));

/* 2. BIPA: no facial geometry / voiceprint code or packages */
const pkg = JSON.parse(read('package.json'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const faceDeps = deps.filter((d) => /face|voiceprint|speaker-?id/i.test(d));
check('no face-detection / voiceprint packages', faceDeps.length === 0, faceDeps.join(', '));
const BIOMETRIC = /\b(FaceLandmarker|FaceDetector|faceDetector|FaceMesh|faceMesh|faceprint|voiceprint|speakerEmbedding)\b/;
const bioHits = srcFiles.filter((f) => BIOMETRIC.test(stripComments(readFileSync(f, 'utf8')))).map(rel);
check('no facial-geometry / voiceprint code in src', bioHits.length === 0, bioHits.join(', '));
const contracts = existsSync(join(root, 'src/types/contracts.ts')) ? read('src/types/contracts.ts') : '';
check('face landmarks 1–10 redacted in contract',
  /PRIVACY_REDACTED_LANDMARKS[^=]*=\s*\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/.test(contracts));

/* 3. Strava write-only isolation */
const importsStrava = (s) => /from\s+['"][^'"]*strava[^'"]*['"]|require\(\s*['"][^'"]*strava/i.test(s);
const stravaLeaks = srcFiles
  .filter((f) => {
    const r = rel(f);
    if (r.startsWith('src/services/wearables/') || r === 'src/services/index.ts') return false;
    return importsStrava(readFileSync(f, 'utf8'));
  })
  .map(rel);
check('Strava imported only inside src/services/wearables', stravaLeaks.length === 0, stravaLeaks.join(', '));
const stravaFiles = srcFiles.filter((f) => /strava/i.test(rel(f)));
const stravaReads = stravaFiles.filter((f) => {
  const s = stripComments(readFileSync(f, 'utf8'));
  return /method\s*:\s*['"]GET['"]|\/athlete\/activities|\/activities\/\$\{|\/streams\b|\.get\(/i.test(s);
});
check('Strava adapter issues no read (GET) requests', stravaReads.length === 0, stravaReads.map(rel).join(', '));

/* 4. Secrets never shipped to the client */
const secretPublic = /EXPO_PUBLIC_(ANTHROPIC|ELEVENLABS|WHOOP|STRAVA_CLIENT_SECRET|OPENAI|SERVICE_ROLE)/i;
const secretHits = [...srcFiles, join(root, '.env.example')]
  .filter((f) => existsSync(f) && secretPublic.test(readFileSync(f, 'utf8')))
  .map(rel);
check('no secret keys exposed via EXPO_PUBLIC_*', secretHits.length === 0, secretHits.join(', '));

/* 5. Unit economics: no continuous live voice agents in drills */
const liveVoice = /wss:\/\/api\.elevenlabs\.io|convai|conversational-ai|realtime-voice|live-voice-agent/i;
const liveHits = srcFiles.filter((f) => liveVoice.test(readFileSync(f, 'utf8'))).map(rel);
check('no continuous live-voice agent wiring', liveHits.length === 0, liveHits.join(', '));

/* 6. UI gates (only once Slice C exists) */
const onboarding = 'src/screens/OnboardingScreen.tsx';
if (existsSync(join(root, onboarding))) {
  const s = read(onboarding);
  check('age gate has no pre-populated birthdate', !/defaultValue\s*=/.test(s) && /useState(?:<[^>]*>)?\(\s*['"]{2}\s*\)/.test(s));
}
const combine = 'src/screens/CombineDrillScreen.tsx';
if (existsSync(join(root, combine))) {
  check('Combine screen gated on camera_skeletal_tracking consent', /camera_skeletal_tracking/.test(read(combine)));
}

/* Report */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} compliance checks passed`);
process.exit(failed ? 1 : 0);
