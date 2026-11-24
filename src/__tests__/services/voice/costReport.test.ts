import * as fs from 'fs';
import * as path from 'path';
import {
  COST_REPORT_TOLERANCE,
  DEFAULT_DEBRIEFS_PER_MONTH,
  renderCostReport,
  summarizeDebriefUsage,
  type DebriefUsageSample,
} from '../../../services/voice/costReport';
import {
  AVG_DEBRIEF_INPUT_TOKENS,
  AVG_DEBRIEF_OUTPUT_TOKENS,
  DEBRIEF_MAX_CHARS,
  estimateDebriefCostUsd,
} from '../../../services/voice/costModel';

const MODEL = estimateDebriefCostUsd(
  DEBRIEF_MAX_CHARS,
  AVG_DEBRIEF_INPUT_TOKENS,
  AVG_DEBRIEF_OUTPUT_TOKENS,
);
const s = (over: Partial<DebriefUsageSample> = {}): DebriefUsageSample => ({
  inputTokens: AVG_DEBRIEF_INPUT_TOKENS,
  outputTokens: AVG_DEBRIEF_OUTPUT_TOKENS,
  ttsChars: DEBRIEF_MAX_CHARS,
  ttsOk: true,
  ...over,
});

describe('summarizeDebriefUsage', () => {
  it('empty samples -> null', () => {
    expect(summarizeDebriefUsage([])).toBeNull();
  });

  it('model cost equals estimateDebriefCostUsd(DEBRIEF_MAX_CHARS, AVG_DEBRIEF_INPUT_TOKENS, AVG_DEBRIEF_OUTPUT_TOKENS)', () => {
    const r = summarizeDebriefUsage([s()]);
    expect(r?.modelUsdPerDebrief).toBe(MODEL);
    expect(r?.actualUsdPerDebrief).toBeCloseTo(MODEL, 12);
    expect(r?.deltaPct).toBeCloseTo(0, 9);
    expect(r?.overModel).toBe(false);
    expect(DEFAULT_DEBRIEFS_PER_MONTH).toBe(40);
    expect(r?.projectedMonthlyUsd).toBeCloseTo(MODEL * 40, 10);
  });

  it('failed TTS is costed at 0 chars', () => {
    const r = summarizeDebriefUsage([s({ ttsOk: false, ttsChars: 300 })]);
    expect(r?.actualUsdPerDebrief).toBeCloseTo(
      estimateDebriefCostUsd(0, AVG_DEBRIEF_INPUT_TOKENS, AVG_DEBRIEF_OUTPUT_TOKENS),
      12,
    );
    expect(r?.ttsFailures).toBe(1);
    expect(r?.meanTtsChars).toBe(300);
  });

  it('computes means and honours debriefsPerMonth', () => {
    const r = summarizeDebriefUsage(
      [
        s({ inputTokens: 100, outputTokens: 10, ttsChars: 100 }),
        s({ inputTokens: 300, outputTokens: 30, ttsChars: 200 }),
      ],
      { debriefsPerMonth: 10 },
    );
    expect(r?.count).toBe(2);
    expect(r?.meanInputTokens).toBe(200);
    expect(r?.meanOutputTokens).toBe(20);
    expect(r?.meanTtsChars).toBe(150);
    const expected =
      (estimateDebriefCostUsd(100, 100, 10) + estimateDebriefCostUsd(200, 300, 30)) / 2;
    expect(r?.actualUsdPerDebrief).toBeCloseTo(expected, 12);
    expect(r?.projectedMonthlyUsd).toBeCloseTo(expected * 10, 10);
  });

  it('overModel flips just above 10 % tolerance', () => {
    expect(COST_REPORT_TOLERANCE).toBe(0.1);
    // Scale input tokens so actual lands just under / over model * 1.10.
    const perTok = estimateDebriefCostUsd(0, 1, 0);
    const extra = (f: number): number => Math.ceil((MODEL * f - MODEL) / perTok);
    const under = summarizeDebriefUsage([
      s({ inputTokens: AVG_DEBRIEF_INPUT_TOKENS + extra(1.099) }),
    ]);
    const over = summarizeDebriefUsage([
      s({ inputTokens: AVG_DEBRIEF_INPUT_TOKENS + extra(1.101) }),
    ]);
    expect(under?.overModel).toBe(false);
    expect(over?.overModel).toBe(true);
    expect(over?.deltaPct).toBeGreaterThan(10);
  });
});

describe('renderCostReport', () => {
  it('rendered report contains aggregates only', () => {
    const over = summarizeDebriefUsage([s({ inputTokens: 200000 })]);
    const ok = summarizeDebriefUsage([s({ ttsChars: 100 })]);
    if (!over || !ok) throw new Error('reports expected');
    const a = renderCostReport(over);
    const b = renderCostReport(ok);
    expect(a).toContain('OVER MODEL');
    expect(b).toContain('within model');
    expect(b).toContain('-');
    expect(a).toContain('debriefs: 1');
    expect(a).not.toMatch(/evt|debrief_usage|\{|\}|https?:/);
    expect(a.split('\n').every((l) => l.length < 60)).toBe(true);
  });
});

describe('cost report script', () => {
  it('cost report script has no fetch, URL or process.env reference', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../../scripts/debrief-cost-report.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bfetch\b/);
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/process\.env/);
    expect(src).toContain('parseUsageLogLine');
  });
});
