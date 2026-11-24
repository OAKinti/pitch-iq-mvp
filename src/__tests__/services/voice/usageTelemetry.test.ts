import * as fs from 'fs';
import * as path from 'path';
import {
  buildServerPrompt,
  handleDebrief,
  parseDebriefRequest,
  type CompletionResult,
  type DebriefDeps,
} from '../../../../supabase/functions/_shared/voiceCore';
import {
  formatUsageLogLine,
  parseUsageLogLine,
  toUsageRecord,
  type DebriefUsageRecord,
} from '../../../../supabase/functions/_shared/usageTelemetry';
import { buildDebriefRequest } from '../../../services/voice/debriefPrompt';
import { archetype, badges, ballResult, ovr } from '../fixtures';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const rawBody = JSON.stringify(
  buildDebriefRequest({
    persona: 'captain',
    result: ballResult,
    ovr,
    badges,
    topArchetype: archetype,
  }),
);
const MONTH = '2031-07-01';
const UPSTREAM = 'upstream-secret-detail-XYZ';

function mkDeps(
  complete: CompletionResult,
  tts: string | null = 'https://signed/a.mp3',
): DebriefDeps {
  return {
    reserveChars: async () => MONTH,
    refundChars: async () => undefined,
    complete: async () => complete,
    tts: async () => tts,
  };
}

const rec = (over: Partial<Record<string, unknown>> = {}): string =>
  JSON.stringify({
    evt: 'debrief_usage',
    v: 1,
    inputTokens: 10,
    outputTokens: 5,
    ttsChars: 20,
    ttsOk: true,
    ...over,
  });

describe('SEC-9 response shape', () => {
  it('ok body has exactly ok,text,audioUrl,usage and usage exactly inputTokens,outputTokens', async () => {
    const out = await handleDebrief(
      rawBody,
      'user-1',
      mkDeps({ kind: 'ok', text: 'Great reps today.', inputTokens: 120, outputTokens: 30 }),
    );
    expect(out.status).toBe(200);
    const b = out.body as unknown as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(['audioUrl', 'ok', 'text', 'usage']);
    const usage = b.usage as Record<string, number>;
    expect(Object.keys(usage).sort()).toEqual(['inputTokens', 'outputTokens']);
    for (const v of Object.values(usage)) {
      expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });

  it('no response body contains prompt text, the reserved month or upstream error detail', async () => {
    const parsed = parseDebriefRequest(rawBody);
    if (!parsed.ok) throw new Error('fixture request must parse');
    const system = buildServerPrompt(parsed.value).system;
    const slice = system.slice(10, 50);
    expect(slice).toHaveLength(40);

    const outcomes: CompletionResult[] = [
      { kind: 'ok', text: 'Good session.', inputTokens: 10, outputTokens: 5 },
      { kind: 'refused' },
      { kind: 'rate_limited' },
      { kind: 'llm_error' },
    ];
    const bodies: unknown[] = [];
    for (const c of outcomes)
      bodies.push((await handleDebrief(rawBody, 'user-uid-77', mkDeps(c))).body);
    const capped: DebriefDeps = {
      ...mkDeps({ kind: 'llm_error' }),
      reserveChars: async () => null,
    };
    bodies.push((await handleDebrief(rawBody, 'user-uid-77', capped)).body);
    bodies.push(
      (await handleDebrief('not json', 'user-uid-77', mkDeps({ kind: 'llm_error' }))).body,
    );
    const throwing: DebriefDeps = {
      ...mkDeps({ kind: 'llm_error' }),
      complete: async () => {
        throw new Error(UPSTREAM);
      },
    };
    bodies.push((await handleDebrief(rawBody, 'user-uid-77', throwing)).body);

    expect(bodies).toHaveLength(7);
    for (const b of bodies) {
      const s = JSON.stringify(b);
      expect(s).not.toContain(slice);
      expect(s).not.toContain(MONTH);
      expect(s).not.toContain('user-uid-77');
      expect(s).not.toContain(UPSTREAM);
      const keys = Object.keys(b as object).sort();
      expect(keys.join() === 'ok,reason' || keys.join() === 'audioUrl,ok,text,usage').toBe(true);
    }
  });
});

describe('toUsageRecord / formatUsageLogLine', () => {
  it('maps an ok result and flags TTS success from audioUrl', () => {
    const ok = {
      status: 200,
      body: {
        ok: true,
        text: 'abcde',
        audioUrl: 'https://x',
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    };
    expect(toUsageRecord(ok)).toEqual({
      evt: 'debrief_usage',
      v: 1,
      inputTokens: 7,
      outputTokens: 3,
      ttsChars: 5,
      ttsOk: true,
    });
    const noAudio = { status: 200, body: { ...ok.body, audioUrl: null } };
    expect(toUsageRecord(noAudio)?.ttsOk).toBe(false);
  });

  it('works on a real handleDebrief result', async () => {
    const out = await handleDebrief(
      rawBody,
      'u',
      mkDeps({ kind: 'ok', text: 'Nice work.', inputTokens: 50, outputTokens: 9 }, null),
    );
    expect(toUsageRecord(out)).toEqual({
      evt: 'debrief_usage',
      v: 1,
      inputTokens: 50,
      outputTokens: 9,
      ttsChars: 10,
      ttsOk: false,
    });
  });

  it('toUsageRecord returns null and never throws for non-200, ok:false, malformed and NaN-usage results', () => {
    const good = {
      ok: true,
      text: 'hi',
      audioUrl: null,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const cases: unknown[] = [
      { status: 502, body: good },
      { status: 200, body: { ok: false, reason: 'refused' } },
      { status: 200, body: null },
      { status: 200, body: 'str' },
      { status: 200, body: { ...good, text: '' } },
      { status: 200, body: { ...good, text: 'x'.repeat(401) } },
      { status: 200, body: { ...good, text: 5 } },
      { status: 200, body: { ...good, usage: undefined } },
      { status: 200, body: { ...good, usage: null } },
      { status: 200, body: { ...good, usage: { inputTokens: NaN, outputTokens: 1 } } },
      { status: 200, body: { ...good, usage: { inputTokens: 1, outputTokens: -1 } } },
      { status: 200, body: { ...good, usage: { inputTokens: 1.5, outputTokens: 1 } } },
      { status: 200, body: { ...good, usage: { inputTokens: Infinity, outputTokens: 1 } } },
      null,
      undefined,
    ];
    for (const c of cases) {
      expect(() => toUsageRecord(c as never)).not.toThrow();
      expect(toUsageRecord(c as never)).toBeNull();
    }
    const hostile = {
      status: 200,
      get body(): unknown {
        throw new Error('boom');
      },
    };
    expect(toUsageRecord(hostile)).toBeNull();
  });

  it('log line has exactly evt,v,inputTokens,outputTokens,ttsChars,ttsOk', () => {
    const r: DebriefUsageRecord = {
      evt: 'debrief_usage',
      v: 1,
      inputTokens: 1,
      outputTokens: 2,
      ttsChars: 3,
      ttsOk: true,
    };
    const line = formatUsageLogLine(r);
    expect(line.startsWith('{"evt":"debrief_usage"')).toBe(true);
    expect(line).not.toContain('\n');
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(obj)).toEqual([
      'evt',
      'v',
      'inputTokens',
      'outputTokens',
      'ttsChars',
      'ttsOk',
    ]);
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'evt') expect(['number', 'boolean']).toContain(typeof v);
    }
  });

  it('formatUsageLogLine never throws', () => {
    const cyc = {} as Record<string, unknown>;
    cyc.self = cyc;
    expect(() => formatUsageLogLine(null as never)).not.toThrow();
    expect(formatUsageLogLine({ inputTokens: 1n } as never)).toBe('');
  });
});

describe('parseUsageLogLine', () => {
  it('round-trips bare, prefixed and escaped lines', () => {
    const r: DebriefUsageRecord = {
      evt: 'debrief_usage',
      v: 1,
      inputTokens: 700,
      outputTokens: 150,
      ttsChars: 380,
      ttsOk: false,
    };
    const bare = formatUsageLogLine(r);
    expect(parseUsageLogLine(bare)).toEqual(r);
    expect(parseUsageLogLine(`2026-11-24T10:00:00Z INFO ${bare} (12ms)`)).toEqual(r);
    const escaped = bare.split('"').join('\\"');
    expect(parseUsageLogLine(escaped)).toEqual(r);
    expect(parseUsageLogLine(`"event_message":"${escaped}"`)).toEqual(r);
  });

  it('parseUsageLogLine rejects extra keys, wrong types and out-of-range values', () => {
    const bad = [
      rec({ extra: 1 }),
      rec({ userId: 'abc' }),
      JSON.stringify({ evt: 'debrief_usage', v: 1, inputTokens: 1, outputTokens: 1, ttsChars: 1 }),
      rec({ evt: 'other' }),
      rec({ v: 2 }),
      rec({ inputTokens: '10' }),
      rec({ ttsOk: 'true' }),
      rec({ ttsOk: 1 }),
      rec({ inputTokens: -1 }),
      rec({ outputTokens: 1.5 }),
      rec({ ttsChars: 401 }),
      rec({ ttsChars: -1 }),
      rec({ ttsChars: null }),
      '[]',
      '{"evt":',
      'no json here',
      '',
      '}{',
    ];
    for (const l of bad) {
      expect(parseUsageLogLine(l)).toBeNull();
    }
    expect(parseUsageLogLine(rec({ ttsChars: 400 }))).not.toBeNull();
    expect(() => parseUsageLogLine(undefined as never)).not.toThrow();
    expect(parseUsageLogLine(undefined as never)).toBeNull();
  });
});

describe('source hygiene', () => {
  it('usageTelemetry.ts has zero imports and no Deno reference', () => {
    const src = read('supabase/functions/_shared/usageTelemetry.ts');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bDeno\b/);
  });

  it('voice-debrief index logs only string literals or formatUsageLogLine', () => {
    const src = read('supabase/functions/voice-debrief/index.ts');
    const calls = src.match(/console\.\w+\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      expect(c).toMatch(/^console\.\w+\((?:formatUsageLogLine\(\w+\)|'[^'\\]*'|"[^"\\]*")\);$/);
    }
    expect(src).toContain('toUsageRecord(out)');
  });

  it('telemetry source never mentions strava or wearables', () => {
    const src = read('supabase/functions/_shared/usageTelemetry.ts');
    expect(src).not.toMatch(/strava|wearable/i);
  });
});
