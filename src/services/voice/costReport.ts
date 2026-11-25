import {
  AVG_DEBRIEF_INPUT_TOKENS,
  AVG_DEBRIEF_OUTPUT_TOKENS,
  DEBRIEF_MAX_CHARS,
  estimateDebriefCostUsd,
} from './costModel';

export interface DebriefUsageSample {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ttsChars: number;
  readonly ttsOk: boolean;
}

export const COST_REPORT_TOLERANCE = 0.1;
export const DEFAULT_DEBRIEFS_PER_MONTH = 40; // 16 000-char cap / 400 chars

export interface DebriefCostReport {
  readonly count: number;
  readonly ttsFailures: number;
  readonly meanInputTokens: number;
  readonly meanOutputTokens: number;
  readonly meanTtsChars: number;
  readonly actualUsdPerDebrief: number;
  readonly modelUsdPerDebrief: number;
  readonly deltaPct: number;
  readonly overModel: boolean;
  readonly projectedMonthlyUsd: number;
}

export function summarizeDebriefUsage(
  samples: readonly DebriefUsageSample[],
  opts?: { debriefsPerMonth?: number },
): DebriefCostReport | null {
  const n = samples.length;
  if (n === 0) return null;
  const perMonth = opts?.debriefsPerMonth ?? DEFAULT_DEBRIEFS_PER_MONTH;

  let inTok = 0;
  let outTok = 0;
  let chars = 0;
  let usd = 0;
  let failures = 0;
  for (const s of samples) {
    inTok += s.inputTokens;
    outTok += s.outputTokens;
    chars += s.ttsChars;
    if (!s.ttsOk) failures += 1;
    usd += estimateDebriefCostUsd(s.ttsOk ? s.ttsChars : 0, s.inputTokens, s.outputTokens);
  }

  const actual = usd / n;
  const model = estimateDebriefCostUsd(
    DEBRIEF_MAX_CHARS,
    AVG_DEBRIEF_INPUT_TOKENS,
    AVG_DEBRIEF_OUTPUT_TOKENS,
  );
  return {
    count: n,
    ttsFailures: failures,
    meanInputTokens: inTok / n,
    meanOutputTokens: outTok / n,
    meanTtsChars: chars / n,
    actualUsdPerDebrief: actual,
    modelUsdPerDebrief: model,
    deltaPct: ((actual - model) / model) * 100,
    overModel: actual > model * (1 + COST_REPORT_TOLERANCE),
    projectedMonthlyUsd: actual * perMonth,
  };
}

export function renderCostReport(report: DebriefCostReport): string {
  const usd = (n: number): string => `$${n.toFixed(5)}`;
  const sign = report.deltaPct >= 0 ? '+' : '';
  return [
    'Debrief cost report',
    `debriefs: ${report.count}`,
    `tts failures: ${report.ttsFailures}`,
    `mean input tokens: ${report.meanInputTokens.toFixed(1)}`,
    `mean output tokens: ${report.meanOutputTokens.toFixed(1)}`,
    `mean tts chars: ${report.meanTtsChars.toFixed(1)}`,
    `actual per debrief: ${usd(report.actualUsdPerDebrief)}`,
    `model per debrief: ${usd(report.modelUsdPerDebrief)}`,
    `delta vs model: ${sign}${report.deltaPct.toFixed(1)}%`,
    `projected monthly: ${usd(report.projectedMonthlyUsd)}`,
    `status: ${report.overModel ? 'OVER MODEL' : 'within model'}`,
  ].join('\n');
}
