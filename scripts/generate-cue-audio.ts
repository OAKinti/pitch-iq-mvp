/* Generates Tier 1 cue clips via ElevenLabs REST (no websocket). Run: npx --yes tsx scripts/generate-cue-audio.ts [--dry-run] [--force] */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planCueClips, renderCueSourcesModule } from '../src/services/audio/cueClips';
import type { CoachPersona } from '../src/types/contracts';

const VOICE_ENV: Record<CoachPersona, string> = {
  captain: 'ELEVENLABS_VOICE_CAPTAIN',
  drill_sergeant: 'ELEVENLABS_VOICE_DRILL_SERGEANT',
  hype: 'ELEVENLABS_VOICE_HYPE',
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const force = args.includes('--force');
  const plan = planCueClips();

  if (dry) {
    for (const c of plan) console.log(`plan ${c.fileName} ${JSON.stringify(c.text)}`);
    console.log(`${plan.length} clips planned (dry run, no network, nothing written)`);
    return 0;
  }

  const required = ['ELEVENLABS_API_KEY', ...Object.values(VOICE_ENV)];
  const missing = required.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}`);
    return 2;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY as string;

  const outDir = join(process.cwd(), 'assets', 'audio', 'cues');
  mkdirSync(outDir, { recursive: true });
  let failures = 0;
  for (const c of plan) {
    const target = join(outDir, c.fileName);
    if (existsSync(target) && !force) {
      console.log(`skip ${c.fileName} (exists)`);
      continue;
    }
    const voiceId = process.env[VOICE_ENV[c.persona]] as string;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: c.text, model_id: 'eleven_flash_v2_5' }),
      },
    );
    if (!res.ok) {
      console.error(`fail ${c.fileName} HTTP ${res.status}`);
      failures++;
      continue;
    }
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`wrote ${c.fileName}`);
  }
  if (failures > 0) return 1;

  writeFileSync(
    join(process.cwd(), 'src', 'services', 'audio', 'cueSources.ts'),
    renderCueSourcesModule(plan),
  );
  console.log('regenerated src/services/audio/cueSources.ts');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : 'unexpected error');
    process.exit(1);
  },
);
