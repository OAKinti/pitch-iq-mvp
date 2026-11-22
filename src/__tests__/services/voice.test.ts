import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoachPersona, CueId } from '../../types/contracts';
import { PERSONAS } from '../../services/voice/personas';
import { CUE_AUDIO_MANIFEST, CUE_TEXT, getCachedCue } from '../../services/voice/cueLibrary';
import {
  DEBRIEF_MAX_CHARS,
  HAIKU_MODEL_ID,
  SUBSCRIPTION_USD_PER_MONTH,
  TTS_USD_PER_1K_CHARS,
  estimateDebriefCostUsd,
  estimateMonthlyVoiceCostUsd,
} from '../../services/voice/costModel';
import { buildDebriefPrompt, templateDebrief, truncateAtWord } from '../../services/voice/debriefPrompt';
import { createQaBudget } from '../../services/voice/qaBudget';
import { createEdgeFunctionTransport, type DebriefTransport } from '../../services/voice/transport';
import { createVoiceCoach } from '../../services/voice/voiceCoach';
import { archetype, badges, ballResult, ovr, shuttleResult } from './fixtures';

const PERSONA_IDS: CoachPersona[] = ['captain', 'drill_sergeant', 'hype'];
const CUE_IDS: CueId[] = [
  'calibrate_step_back', 'calibrate_hold_still', 'ready_go', 'out_of_frame', 'back_in_frame',
  'rhythm_good', 'pace_up', 'switch_feet', 'halfway', 'ten_seconds', 'final_push', 'turn_sharp',
  'drill_complete',
];

describe('personas & cues', () => {
  it('defines env names for each persona', () => {
    expect(PERSONAS.captain.elevenLabsVoiceEnv).toBe('ELEVENLABS_VOICE_CAPTAIN');
    expect(PERSONAS.drill_sergeant.elevenLabsVoiceEnv).toBe('ELEVENLABS_VOICE_DRILL_SERGEANT');
    expect(PERSONAS.hype.elevenLabsVoiceEnv).toBe('ELEVENLABS_VOICE_HYPE');
  });

  it('has 39 cue lines, each <= 80 chars and distinct per persona', () => {
    let n = 0;
    for (const id of CUE_IDS) {
      const lines = PERSONA_IDS.map((p) => getCachedCue(id, p).text);
      for (const l of lines) {
        n++;
        expect(l.length).toBeGreaterThan(0);
        expect(l.length).toBeLessThanOrEqual(80);
      }
      expect(new Set(lines).size).toBe(3);
    }
    expect(n).toBe(39);
    expect(Object.keys(CUE_TEXT.captain)).toHaveLength(13);
  });

  it('returns null audioUri until the manifest is filled', () => {
    expect(getCachedCue('ready_go', 'hype').audioUri).toBeNull();
    CUE_AUDIO_MANIFEST.hype.ready_go = 'asset://x.mp3';
    expect(getCachedCue('ready_go', 'hype').audioUri).toBe('asset://x.mp3');
    delete CUE_AUDIO_MANIFEST.hype.ready_go;
  });
});

describe('costModel', () => {
  it('exposes constants', () => {
    expect(TTS_USD_PER_1K_CHARS).toBe(0.04);
    expect(HAIKU_MODEL_ID).toBe('claude-haiku-5-5');
    expect(DEBRIEF_MAX_CHARS).toBe(400);
  });
  it('estimates a single debrief', () => {
    // 400 chars TTS = 0.016, 1000 in = 0.0001, 200 out = 0.0001
    expect(estimateDebriefCostUsd(400, 1000, 200)).toBeCloseTo(0.0162, 6);
    expect(estimateDebriefCostUsd(0, 0, 0)).toBe(0);
  });
  it('keeps a heavy user under $1.50/month (< 10% of $14.99)', () => {
    const cost = estimateMonthlyVoiceCostUsd({ debriefsPerMonth: 30, avgChars: 400, qaMinutes: 10 });
    expect(cost).toBeLessThan(1.5);
    expect(cost).toBeLessThan(SUBSCRIPTION_USD_PER_MONTH * 0.1);
    expect(cost).toBeGreaterThan(0.5);
  });
});

describe('debriefPrompt', () => {
  const input = { persona: 'captain' as const, result: ballResult, ovr, badges, topArchetype: archetype };

  it('builds a safe prompt with compact JSON and no identifiers', () => {
    const { system, user } = buildDebriefPrompt(input);
    expect(system).toContain('2 to 3 sentences');
    expect(system).toContain(String(DEBRIEF_MAX_CHARS));
    expect(system).toMatch(/medical/i);
    const parsed = JSON.parse(user);
    expect(parsed.metrics.touches).toBe(62);
    expect(parsed.badges).toEqual(['metronome']);
    expect(parsed.archetype.name).toBe('The Playmaker');
    expect(user).not.toContain('r1');
  });

  it('includes shuttle metrics and wearable summary', () => {
    const { user } = buildDebriefPrompt({
      ...input,
      persona: 'hype',
      result: shuttleResult,
      topArchetype: undefined,
      wearables: [{ source: 'whoop', date: '2026-11-21', restingHeartRateBpm: 50, hrvRmssdMs: 80, sleepMinutes: null, recoveryScore: 90, strain: null }],
    });
    const p = JSON.parse(user);
    expect(p.metrics.drill).toBe('agility_shuttle');
    expect(p.archetype).toBeNull();
    expect(p.wearables[0].recovery).toBe(90);
  });

  it('uses the persona voice', () => {
    expect(buildDebriefPrompt({ ...input, persona: 'drill_sergeant' }).system).toContain('Drill Sergeant');
    expect(buildDebriefPrompt({ ...input, persona: 'hype' }).system).toContain('Hype Coach');
  });

  it('template debriefs are persona flavoured, deterministic and <= 400 chars', () => {
    for (const p of PERSONA_IDS) {
      for (const r of [ballResult, shuttleResult]) {
        const t = templateDebrief({ ...input, persona: p, result: r });
        expect(t.length).toBeLessThanOrEqual(DEBRIEF_MAX_CHARS);
        expect(t).toBe(templateDebrief({ ...input, persona: p, result: r }));
        expect(t).toContain('72.5');
      }
    }
    expect(templateDebrief({ ...input, badges: [] })).not.toContain('earned');
  });

  it('truncateAtWord cuts at a word boundary', () => {
    expect(truncateAtWord('short', 10)).toBe('short');
    expect(truncateAtWord('alpha beta gamma delta', 13)).toBe('alpha beta');
    expect(truncateAtWord('abcdefghijklmnop', 8)).toBe('abcdefgh');
  });
});

describe('qaBudget', () => {
  it('clamps cap to [5, 10] minutes', () => {
    expect(createQaBudget({ capMinutes: 1 }).capSeconds).toBe(300);
    expect(createQaBudget({ capMinutes: 99 }).capSeconds).toBe(600);
    expect(createQaBudget({ capMinutes: 7 }).capSeconds).toBe(420);
    expect(createQaBudget({ capMinutes: NaN }).capSeconds).toBe(300);
  });
  it('never exceeds the cap', () => {
    const b = createQaBudget({ capMinutes: 5, usedSeconds: 250 });
    expect(b.remainingSeconds()).toBe(50);
    expect(b.canStart()).toBe(true);
    expect(b.consume(30)).toBe(30);
    expect(b.consume(100)).toBe(20);
    expect(b.consume(10)).toBe(0);
    expect(b.canStart()).toBe(false);
    expect(b.remainingSeconds()).toBe(0);
    expect(b.consume(-5)).toBe(0);
    expect(b.consume(NaN)).toBe(0);
  });
  it('clamps usedSeconds', () => {
    expect(createQaBudget({ capMinutes: 5, usedSeconds: 9999 }).remainingSeconds()).toBe(0);
    expect(createQaBudget({ capMinutes: 5, usedSeconds: -5 }).remainingSeconds()).toBe(300);
  });
});

describe('transport', () => {
  const mk = (invoke: jest.Mock) => createEdgeFunctionTransport({ functions: { invoke } } as unknown as SupabaseClient);
  const prompt = { system: 's', user: 'u' };

  it('invokes voice-debrief and maps the response', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: { text: 'hi', audioUrl: 'https://a/b.mp3', usage: { input_tokens: 10, output_tokens: 5 } },
      error: null,
    });
    const r = await mk(invoke).requestDebrief(prompt, 'hype');
    expect(invoke).toHaveBeenCalledWith('voice-debrief', { body: { system: 's', user: 'u', persona: 'hype' } });
    expect(r).toEqual({ text: 'hi', audioUri: 'https://a/b.mp3', inputTokens: 10, outputTokens: 5 });
  });
  it('defaults missing audio/usage', async () => {
    const r = await mk(jest.fn().mockResolvedValue({ data: { text: 'hi' }, error: null })).requestDebrief(prompt, 'captain');
    expect(r).toEqual({ text: 'hi', audioUri: null, inputTokens: 0, outputTokens: 0 });
  });
  it('throws on error, refusal and null text', async () => {
    await expect(mk(jest.fn().mockResolvedValue({ data: null, error: { message: 'bad' } })).requestDebrief(prompt, 'captain')).rejects.toThrow('bad');
    await expect(mk(jest.fn().mockResolvedValue({ data: { text: null, refused: true }, error: null })).requestDebrief(prompt, 'captain')).rejects.toThrow();
    await expect(mk(jest.fn().mockResolvedValue({ data: { text: 'x', refused: true }, error: null })).requestDebrief(prompt, 'captain')).rejects.toThrow();
    await expect(mk(jest.fn().mockResolvedValue({ data: null, error: null })).requestDebrief(prompt, 'captain')).rejects.toThrow();
  });
});

describe('voiceCoach', () => {
  const input = { persona: 'captain' as const, result: ballResult, ovr, badges };

  it('serves cues for its persona and exposes the QA budget', () => {
    const c = createVoiceCoach({ persona: 'hype', transport: null, qaCapMinutes: 8 });
    expect(c.cue('halfway').persona).toBe('hype');
    expect(c.qa.capSeconds).toBe(480);
    expect(createVoiceCoach({ persona: 'hype', transport: null }).qa.capSeconds).toBe(300);
  });

  it('uses the template with null transport', async () => {
    const d = await createVoiceCoach({ persona: 'captain', transport: null }).debrief(input);
    expect(d.source).toBe('template');
    expect(d.estimatedCostUsd).toBe(0);
    expect(d.ttsChars).toBe(d.text.length);
    expect(d.audioUri).toBeNull();
  });

  it('uses the transport and fills cost', async () => {
    const transport: DebriefTransport = {
      requestDebrief: jest.fn().mockResolvedValue({ text: 'Nice work.', audioUri: 'u', inputTokens: 700, outputTokens: 100 }),
    };
    const d = await createVoiceCoach({ persona: 'captain', transport }).debrief(input);
    expect(d.source).toBe('haiku');
    expect(d.audioUri).toBe('u');
    expect(d.ttsChars).toBe(10);
    expect(d.estimatedCostUsd).toBeCloseTo(estimateDebriefCostUsd(10, 700, 100), 10);
  });

  it('truncates long transport text at a word boundary', async () => {
    const long = 'word '.repeat(200);
    const transport: DebriefTransport = {
      requestDebrief: async () => ({ text: long, audioUri: null, inputTokens: 1, outputTokens: 1 }),
    };
    const d = await createVoiceCoach({ persona: 'captain', transport }).debrief(input);
    expect(d.text.length).toBeLessThanOrEqual(DEBRIEF_MAX_CHARS);
    expect(d.text.endsWith('word')).toBe(true);
  });

  it('falls back to the template on transport error, empty text, or unsafe wearables', async () => {
    const failing: DebriefTransport = { requestDebrief: async () => { throw new Error('down'); } };
    expect((await createVoiceCoach({ persona: 'captain', transport: failing }).debrief(input)).source).toBe('template');
    const empty: DebriefTransport = { requestDebrief: async () => ({ text: '', audioUri: null, inputTokens: 0, outputTokens: 0 }) };
    expect((await createVoiceCoach({ persona: 'captain', transport: empty }).debrief(input)).source).toBe('template');
    const ok: DebriefTransport = { requestDebrief: jest.fn() };
    const bad = { ...input, wearables: [{ source: 'strava' }] } as unknown as typeof input;
    expect((await createVoiceCoach({ persona: 'captain', transport: ok }).debrief(bad)).source).toBe('template');
    expect(ok.requestDebrief).not.toHaveBeenCalled();
  });
});
