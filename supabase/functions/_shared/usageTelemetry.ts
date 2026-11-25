// Debrief usage telemetry (D4.1a). Zero imports, no runtime globals: runs in the edge runtime and jest.
// A log line carries numbers and one boolean only (SEC-10). No function here throws (FAIL-10).

export interface DebriefUsageRecord {
  readonly evt: 'debrief_usage';
  readonly v: 1;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ttsChars: number;
  readonly ttsOk: boolean;
}

const MAX_TTS_CHARS = 400;
const KEYS = ['evt', 'v', 'inputTokens', 'outputTokens', 'ttsChars', 'ttsOk'];

function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/** The single validation guard shared by toUsageRecord and parseUsageLogLine. */
function validRecord(x: unknown): DebriefUsageRecord | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  if (o.evt !== 'debrief_usage' || o.v !== 1) return null;
  if (!isCount(o.inputTokens) || !isCount(o.outputTokens)) return null;
  if (!isCount(o.ttsChars) || o.ttsChars > MAX_TTS_CHARS) return null;
  if (typeof o.ttsOk !== 'boolean') return null;
  return {
    evt: 'debrief_usage',
    v: 1,
    inputTokens: o.inputTokens,
    outputTokens: o.outputTokens,
    ttsChars: o.ttsChars,
    ttsOk: o.ttsOk,
  };
}

export function toUsageRecord(result: {
  status: number;
  body: unknown;
}): DebriefUsageRecord | null {
  try {
    if (!result || result.status !== 200) return null;
    const b = result.body as Record<string, unknown> | null;
    if (typeof b !== 'object' || b === null || b.ok !== true) return null;
    const text = b.text;
    if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TTS_CHARS) return null;
    const usage = b.usage as Record<string, unknown> | null | undefined;
    if (typeof usage !== 'object' || usage === null) return null;
    return validRecord({
      evt: 'debrief_usage',
      v: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ttsChars: text.length,
      ttsOk: typeof b.audioUrl === 'string' && b.audioUrl.length > 0,
    });
  } catch {
    return null;
  }
}

export function formatUsageLogLine(record: DebriefUsageRecord): string {
  try {
    return JSON.stringify({
      evt: record.evt,
      v: record.v,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      ttsChars: record.ttsChars,
      ttsOk: record.ttsOk,
    });
  } catch {
    return '';
  }
}

export function parseUsageLogLine(line: string): DebriefUsageRecord | null {
  try {
    if (typeof line !== 'string') return null;
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const slice = line.slice(start, end + 1);
    const candidates = [slice];
    if (slice.includes('\\"')) candidates.push(slice.split('\\"').join('"'));
    // A JSON-wrapped log export ({"event_message":"{\"evt\":\"debrief_usage\",...}"}) has an
    // outer object; the usage record itself is flat (no nested braces), so locate it directly.
    const inner = /\{\\?"evt\\?"\s*:\s*\\?"debrief_usage\\?"[^{}]*\}/.exec(line);
    if (inner) candidates.push(inner[0].split('\\"').join('"'));
    for (const c of candidates) {
      try {
        const rec = validRecord(JSON.parse(c));
        if (rec) return rec;
      } catch {
        // try next shape
      }
    }
    return null;
  } catch {
    return null;
  }
}
