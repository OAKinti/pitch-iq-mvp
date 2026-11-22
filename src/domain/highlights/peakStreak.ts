import type { HighlightWindow } from '../../types/contracts';

/** Densest `windowMs` slice of the drill; ties go to the earliest event-anchored start. */
export function selectPeakStreakWindow(
  eventTimestampsMs: readonly number[],
  totalDurationMs: number,
  windowMs = 15_000,
): HighlightWindow {
  const sorted = [...eventTimestampsMs].sort((a, b) => a - b);
  const countIn = (start: number, end: number): number =>
    sorted.filter((t) => t >= start && t < end).length;

  if (totalDurationMs < windowMs) {
    return {
      startMs: 0,
      endMs: totalDurationMs,
      eventCount: sorted.filter((t) => t >= 0 && t <= totalDurationMs).length,
    };
  }
  const maxStart = totalDurationMs - windowMs;
  let best: HighlightWindow = { startMs: 0, endMs: windowMs, eventCount: 0 };
  for (const t of sorted) {
    const start = Math.min(Math.max(t, 0), maxStart);
    const eventCount = countIn(start, start + windowMs);
    if (eventCount > best.eventCount) best = { startMs: start, endMs: start + windowMs, eventCount };
  }
  return best;
}
