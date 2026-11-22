export const TTS_USD_PER_1K_CHARS = 0.04 as const;
export const HAIKU_MODEL_ID = 'claude-haiku-5-5' as const;
export const HAIKU_INPUT_USD_PER_MTOK = 0.1;
export const HAIKU_OUTPUT_USD_PER_MTOK = 0.5;
export const DEBRIEF_MAX_CHARS = 400 as const;
export const SUBSCRIPTION_USD_PER_MONTH = 14.99;

/** Typical sizes used for monthly projections. */
export const AVG_DEBRIEF_INPUT_TOKENS = 700;
export const AVG_DEBRIEF_OUTPUT_TOKENS = 150;
export const QA_CHARS_PER_MINUTE = 900;
/** Rough LLM tokens consumed per minute of Q&A (question + history in, answer out). */
export const QA_INPUT_TOKENS_PER_MINUTE = 1200;
export const QA_OUTPUT_TOKENS_PER_MINUTE = 250;

export function estimateDebriefCostUsd(
  ttsChars: number,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (ttsChars / 1000) * TTS_USD_PER_1K_CHARS +
    (inputTokens / 1e6) * HAIKU_INPUT_USD_PER_MTOK +
    (outputTokens / 1e6) * HAIKU_OUTPUT_USD_PER_MTOK
  );
}

export function estimateMonthlyVoiceCostUsd(opts: {
  debriefsPerMonth: number;
  avgChars: number;
  qaMinutes: number;
}): number {
  const debriefs =
    opts.debriefsPerMonth *
    estimateDebriefCostUsd(opts.avgChars, AVG_DEBRIEF_INPUT_TOKENS, AVG_DEBRIEF_OUTPUT_TOKENS);
  const qa = estimateDebriefCostUsd(
    opts.qaMinutes * QA_CHARS_PER_MINUTE,
    opts.qaMinutes * QA_INPUT_TOKENS_PER_MINUTE,
    opts.qaMinutes * QA_OUTPUT_TOKENS_PER_MINUTE,
  );
  return debriefs + qa;
}
