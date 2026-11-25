// Server-side voice logic: pure, import-free, no Deno globals (jest-tested from src/__tests__).
// index.ts files wire this to Anthropic / ElevenLabs / Supabase RPCs.
// DebriefRequestShape / DebriefResponseShape are structural copies of src/types/contracts.ts
// (DebriefRequest / DebriefResponse); parity is proven by the round-trip test.

export const MAX_BODY_BYTES = 8192;
export const MAX_PROMPT_CHARS = 6000;
export const DEBRIEF_MAX_CHARS = 400;
export const DEBRIEF_RESERVE_CHARS = 400;
export const QA_MAX_SECONDS_PER_CALL = 120;

const MAX_BADGES = 7;
const MAX_WEARABLES = 7;

export type PersonaShape = 'captain' | 'drill_sergeant' | 'hype';
export type DebriefFailureReasonShape =
  | 'monthly_cap'
  | 'refused'
  | 'invalid_request'
  | 'invalid_source'
  | 'legacy_prompt_rejected'
  | 'body_too_large'
  | 'unauthorized'
  | 'rate_limited'
  | 'llm_error'
  | 'profile_required'
  | 'parental_consent_required';

/** D-9C: result of public.voice_tier2_status (migration 004). */
export type Tier2Status = 'ok' | 'profile_required' | 'parental_consent_required';

export type DebriefMetricsShape =
  | {
      drill: 'ball_mastery';
      touches: number;
      touchesPerMinute: number;
      footBalance: number;
      rhythmCv: number;
      hipSway: number;
    }
  | {
      drill: 'agility_shuttle';
      totalTimeS: number;
      legs: number;
      peakSpeedMps: number;
      meanTurnTimeMs: number;
      splitCv: number;
      fatigueIndex: number;
    };

export interface DebriefWearableShape {
  source: 'healthkit' | 'health_connect' | 'whoop';
  date: string;
  restingHr: number | null;
  hrv: number | null;
  sleepMin: number | null;
  recovery: number | null;
  strain: number | null;
}

export interface DebriefRequestShape {
  v: 2;
  persona: PersonaShape;
  metrics: DebriefMetricsShape;
  ovr: {
    value: number;
    band: 'developing' | 'standard' | 'elite';
    position: 'GK' | 'DEF' | 'MID' | 'FWD';
    attributes: {
      pace: number;
      agility: number;
      ballControl: number;
      balance: number;
      rhythm: number;
      endurance: number;
    };
  };
  badges: string[];
  archetype: { name: string; similarity: number } | null;
  wearables: DebriefWearableShape[];
}

export type DebriefResponseShape =
  | {
      ok: true;
      text: string;
      audioUrl: string | null;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; reason: DebriefFailureReasonShape };

type ParseFailureReason =
  'invalid_request' | 'invalid_source' | 'legacy_prompt_rejected' | 'body_too_large';

const PERSONAS: readonly string[] = ['captain', 'drill_sergeant', 'hype'];
const BANDS: readonly string[] = ['developing', 'standard', 'elite'];
const POSITIONS: readonly string[] = ['GK', 'DEF', 'MID', 'FWD'];
const SAFE_SOURCES: readonly string[] = ['healthkit', 'health_connect', 'whoop'];
const BADGE_IDS: readonly string[] = [
  'metronome',
  'quick_feet',
  'two_footed',
  'rock_solid',
  'brake_master',
  'engine',
  'burst',
];
const ATTRIBUTE_KEYS = [
  'pace',
  'agility',
  'ballControl',
  'balance',
  'rhythm',
  'endurance',
] as const;
const ARCHETYPE_NAME = /^[A-Za-z][A-Za-z .'-]{0,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ───────────────────────────── helpers ───────────────────────────── */

function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(o: Obj, key: string, min: number, max: number): number | null {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function nullableNum(o: Obj, key: string, min: number, max: number): number | null | undefined {
  const v = o[key];
  if (v === null || v === undefined) return null;
  return num(o, key, min, max) ?? undefined; // undefined = invalid
}

function parseMetrics(raw: unknown): DebriefMetricsShape | null {
  if (!isObj(raw)) return null;
  if (raw.drill === 'ball_mastery') {
    const touches = num(raw, 'touches', 0, 2000);
    const touchesPerMinute = num(raw, 'touchesPerMinute', 0, 600);
    const footBalance = num(raw, 'footBalance', 0, 1);
    const rhythmCv = num(raw, 'rhythmCv', 0, 10);
    const hipSway = num(raw, 'hipSway', 0, 100);
    if (
      touches === null ||
      touchesPerMinute === null ||
      footBalance === null ||
      rhythmCv === null ||
      hipSway === null
    )
      return null;
    return { drill: 'ball_mastery', touches, touchesPerMinute, footBalance, rhythmCv, hipSway };
  }
  if (raw.drill === 'agility_shuttle') {
    const totalTimeS = num(raw, 'totalTimeS', 0, 600);
    const legs = num(raw, 'legs', 0, 100);
    const peakSpeedMps = num(raw, 'peakSpeedMps', 0, 15);
    const meanTurnTimeMs = num(raw, 'meanTurnTimeMs', 0, 10000);
    const splitCv = num(raw, 'splitCv', 0, 10);
    const fatigueIndex = num(raw, 'fatigueIndex', -10, 10);
    if (
      totalTimeS === null ||
      legs === null ||
      peakSpeedMps === null ||
      meanTurnTimeMs === null ||
      splitCv === null ||
      fatigueIndex === null
    )
      return null;
    return {
      drill: 'agility_shuttle',
      totalTimeS,
      legs,
      peakSpeedMps,
      meanTurnTimeMs,
      splitCv,
      fatigueIndex,
    };
  }
  return null;
}

function parseOvr(raw: unknown): DebriefRequestShape['ovr'] | null {
  if (!isObj(raw)) return null;
  const value = num(raw, 'value', 0, 100);
  if (value === null) return null;
  if (typeof raw.band !== 'string' || !BANDS.includes(raw.band)) return null;
  if (typeof raw.position !== 'string' || !POSITIONS.includes(raw.position)) return null;
  if (!isObj(raw.attributes)) return null;
  const a: Record<string, number> = {};
  for (const k of ATTRIBUTE_KEYS) {
    const n = num(raw.attributes, k, 0, 100);
    if (n === null) return null;
    a[k] = n;
  }
  return {
    value,
    band: raw.band as DebriefRequestShape['ovr']['band'],
    position: raw.position as DebriefRequestShape['ovr']['position'],
    attributes: a as DebriefRequestShape['ovr']['attributes'],
  };
}

/** Returns a wearable, 'invalid_source' for a non-whitelisted source, or null for any other problem. */
function parseWearable(raw: unknown): DebriefWearableShape | 'invalid_source' | null {
  if (!isObj(raw)) return null;
  if (typeof raw.source !== 'string') return null;
  if (!SAFE_SOURCES.includes(raw.source)) return 'invalid_source';
  if (typeof raw.date !== 'string' || !ISO_DATE.test(raw.date)) return null;
  const restingHr = nullableNum(raw, 'restingHr', 20, 250);
  const hrv = nullableNum(raw, 'hrv', 0, 500);
  const sleepMin = nullableNum(raw, 'sleepMin', 0, 1440);
  const recovery = nullableNum(raw, 'recovery', 0, 100);
  const strain = nullableNum(raw, 'strain', 0, 21);
  if (
    restingHr === undefined ||
    hrv === undefined ||
    sleepMin === undefined ||
    recovery === undefined ||
    strain === undefined
  )
    return null;
  return {
    source: raw.source as DebriefWearableShape['source'],
    date: raw.date,
    restingHr,
    hrv,
    sleepMin,
    recovery,
    strain,
  };
}

/* ───────────────────────────── parsing ───────────────────────────── */

export function parseDebriefRequest(
  rawBody: string,
):
  | { ok: true; value: DebriefRequestShape }
  | { ok: false; status: 400 | 413; reason: ParseFailureReason } {
  const fail = (reason: ParseFailureReason) => ({
    ok: false as const,
    status: (reason === 'body_too_large' ? 413 : 400) as 400 | 413,
    reason,
  });
  if (typeof rawBody !== 'string') return fail('invalid_request');
  if (utf8ByteLength(rawBody) > MAX_BODY_BYTES) return fail('body_too_large');

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail('invalid_request');
  }
  if (!isObj(body)) return fail('invalid_request');
  if ('system' in body || 'user' in body) return fail('legacy_prompt_rejected');
  if (body.v !== 2) return fail('invalid_request');
  if (typeof body.persona !== 'string' || !PERSONAS.includes(body.persona))
    return fail('invalid_request');

  const metrics = parseMetrics(body.metrics);
  const ovr = parseOvr(body.ovr);
  if (!metrics || !ovr) return fail('invalid_request');

  if (!Array.isArray(body.badges) || body.badges.length > MAX_BADGES)
    return fail('invalid_request');
  const badges: string[] = [];
  for (const b of body.badges) {
    if (typeof b !== 'string' || !BADGE_IDS.includes(b) || badges.includes(b))
      return fail('invalid_request');
    badges.push(b);
  }

  let archetype: DebriefRequestShape['archetype'] = null;
  if (body.archetype !== null && body.archetype !== undefined) {
    if (!isObj(body.archetype)) return fail('invalid_request');
    const name = body.archetype.name;
    const similarity = num(body.archetype, 'similarity', 0, 1);
    if (typeof name !== 'string' || !ARCHETYPE_NAME.test(name) || similarity === null)
      return fail('invalid_request');
    archetype = { name, similarity };
  }

  const rawWearables = body.wearables === undefined ? [] : body.wearables;
  if (!Array.isArray(rawWearables) || rawWearables.length > MAX_WEARABLES)
    return fail('invalid_request');
  const wearables: DebriefWearableShape[] = [];
  let badRecord = false;
  for (const w of rawWearables) {
    const parsed = parseWearable(w);
    if (parsed === 'invalid_source') return fail('invalid_source');
    if (parsed === null) badRecord = true;
    else wearables.push(parsed);
  }
  if (badRecord) return fail('invalid_request');

  return {
    ok: true,
    value: {
      v: 2,
      persona: body.persona as PersonaShape,
      metrics,
      ovr,
      badges,
      archetype,
      wearables,
    },
  };
}

/* ───────────────────────────── prompt ───────────────────────────── */

const PERSONA_VOICE: Record<PersonaShape, string> = {
  captain: 'You are "The Captain", a calm, composed team leader. Speak steadily and encouragingly.',
  drill_sergeant:
    'You are "The Drill Sergeant", intense and demanding but never abusive. Short, punchy sentences.',
  hype: 'You are "The Hype Coach", bursting with energy and enthusiasm. Celebrate effort.',
};

export function buildServerPrompt(req: DebriefRequestShape): { system: string; user: string } {
  const system = [
    PERSONA_VOICE[req.persona],
    'You are a soccer coach giving a short spoken debrief after a drill.',
    `Reply with 2 to 3 sentences, at most ${DEBRIEF_MAX_CHARS} characters in total, plain text only.`,
    'Include exactly one concrete drill tip the player can try next session.',
    'Never make medical claims or diagnose injuries, and never mention health conditions.',
    'Do not ask for or mention personal information, names, or identifiers.',
    'Use only the JSON data provided by the user message.',
  ].join(' ');

  const user = JSON.stringify({
    metrics: req.metrics,
    ovr: req.ovr,
    badges: req.badges,
    archetype: req.archetype,
    wearables: req.wearables,
  });
  return { system, user };
}

/* ───────────────────────────── debrief handler ───────────────────────────── */

export type CompletionResult =
  | { kind: 'ok'; text: string; inputTokens: number; outputTokens: number }
  | { kind: 'refused' }
  | { kind: 'rate_limited' }
  | { kind: 'llm_error' };

export interface DebriefDeps {
  /**
   * D-9C: Tier 2 sends drill/wearable data to Anthropic + ElevenLabs (third parties). Under-13 users
   * need verifiable parental consent first. Checked before any reserve or provider call; a rejection
   * propagates (fail closed, the edge function answers 502).
   */
  tier2Status(userId: string): Promise<Tier2Status>;
  /** Month (YYYY-MM-01) reserved, or null when the monthly cap would be exceeded. */
  reserveChars(userId: string, chars: number): Promise<string | null>;
  refundChars(userId: string, month: string, chars: number): Promise<void>;
  complete(prompt: { system: string; user: string }): Promise<CompletionResult>;
  /** Signed URL, or null when TTS is unavailable. */
  tts(text: string, persona: string): Promise<string | null>;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const i = cut.lastIndexOf(' ');
  return (i > max / 2 ? cut.slice(0, i) : cut).trim();
}

export async function handleDebrief(
  rawBody: string,
  userId: string,
  deps: DebriefDeps,
): Promise<{ status: number; body: DebriefResponseShape }> {
  const parsed = parseDebriefRequest(rawBody);
  if (!parsed.ok) return { status: parsed.status, body: { ok: false, reason: parsed.reason } };
  const req = parsed.value;

  const tier2 = await deps.tier2Status(userId);
  if (tier2 !== 'ok') return { status: 200, body: { ok: false, reason: tier2 } };

  const month = await deps.reserveChars(userId, DEBRIEF_RESERVE_CHARS);
  if (month === null) return { status: 200, body: { ok: false, reason: 'monthly_cap' } };

  const refund = async (chars: number): Promise<void> => {
    if (chars <= 0) return;
    try {
      await deps.refundChars(userId, month, chars);
    } catch {
      // best effort: never mask the user-visible outcome
    }
  };

  let result: CompletionResult;
  try {
    result = await deps.complete(buildServerPrompt(req));
  } catch {
    result = { kind: 'llm_error' };
  }

  if (result.kind !== 'ok') {
    await refund(DEBRIEF_RESERVE_CHARS);
    if (result.kind === 'refused') return { status: 200, body: { ok: false, reason: 'refused' } };
    if (result.kind === 'rate_limited')
      return { status: 429, body: { ok: false, reason: 'rate_limited' } };
    return { status: 502, body: { ok: false, reason: 'llm_error' } };
  }

  const text = truncateAtWord(result.text.trim(), DEBRIEF_MAX_CHARS);
  if (text.length === 0) {
    await refund(DEBRIEF_RESERVE_CHARS);
    return { status: 200, body: { ok: false, reason: 'refused' } };
  }
  await refund(DEBRIEF_RESERVE_CHARS - text.length);

  let audioUrl: string | null = null;
  try {
    audioUrl = await deps.tts(text, req.persona);
  } catch {
    audioUrl = null;
  }

  return {
    status: 200,
    body: {
      ok: true,
      text,
      audioUrl,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    },
  };
}

/* ───────────────────────────── Q&A handler ───────────────────────────── */

export interface QaDeps {
  /** D-9C: same gate as debriefs; a non-ok status grants nothing. */
  tier2Status(userId: string): Promise<Tier2Status>;
  consumeQa(userId: string, seconds: number): Promise<{ granted: number; remaining: number }>;
}

export async function handleQa(
  rawBody: string,
  userId: string,
  deps: QaDeps,
): Promise<{
  status: 200 | 400 | 413;
  body:
    | { ok: true; grantedSeconds: number; remainingSeconds: number }
    | { ok: false; reason: 'invalid_request' | 'body_too_large' | Exclude<Tier2Status, 'ok'> };
}> {
  if (typeof rawBody !== 'string')
    return { status: 400, body: { ok: false, reason: 'invalid_request' } };
  if (utf8ByteLength(rawBody) > MAX_BODY_BYTES)
    return { status: 413, body: { ok: false, reason: 'body_too_large' } };
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, reason: 'invalid_request' } };
  }
  if (!isObj(body)) return { status: 400, body: { ok: false, reason: 'invalid_request' } };
  const seconds = body.seconds;
  if (
    typeof seconds !== 'number' ||
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > QA_MAX_SECONDS_PER_CALL
  ) {
    return { status: 400, body: { ok: false, reason: 'invalid_request' } };
  }
  const tier2 = await deps.tier2Status(userId);
  if (tier2 !== 'ok') return { status: 200, body: { ok: false, reason: tier2 } };
  const { granted, remaining } = await deps.consumeQa(userId, seconds);
  return { status: 200, body: { ok: true, grantedSeconds: granted, remainingSeconds: remaining } };
}
