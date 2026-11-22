import {
  ATTRIBUTE_KEYS,
  RATING_CEILING,
  type AgilityShuttleMetrics,
  type AttributeKey,
  type AttributeVector,
  type BallMasteryMetrics,
  type DrillMetrics,
} from '../../types/contracts';

export const NEUTRAL_ATTRIBUTE = 50 as const;

type Anchor = readonly [metric: number, rating: number];

/** Sorted ascending by metric so one interpolator serves higher- and lower-is-better tables. */
const ascending = (anchors: readonly Anchor[]): readonly Anchor[] =>
  [...anchors].sort((a, b) => a[0] - b[0]);

const BALL_CONTROL = ascending([[30, 35], [60, 55], [90, 75], [120, 90], [150, 99]]);
const RHYTHM = ascending([[0.4, 30], [0.25, 55], [0.15, 75], [0.08, 90], [0.04, 99]]);
const FOOT_BALANCE = ascending([[0.5, 40], [0.8, 70], [1.0, 95]]);
const HIP_SWAY = ascending([[0.1, 40], [0.05, 70], [0.02, 95]]);
const PACE = ascending([[2.5, 35], [4, 55], [5.5, 75], [7, 90], [8.5, 99]]);
const AGILITY = ascending([[900, 35], [650, 55], [450, 75], [300, 90], [200, 99]]);
const ENDURANCE = ascending([[0.3, 30], [0.15, 55], [0.08, 75], [0.03, 90], [0, 99]]);

const MIN_TOUCHES_FOR_RHYTHM = 3;

const clamp = (v: number): number => Math.min(RATING_CEILING, Math.max(0, v));

/** Piecewise-linear interpolation, holding the end values outside the anchor range. */
export function interpolateAnchors(value: number, anchors: readonly Anchor[]): number {
  const first = anchors[0]!;
  if (value <= first[0]) return clamp(first[1]);
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i]!;
    if (value <= hi[0]) {
      const lo = anchors[i - 1]!;
      return clamp(lo[1] + ((value - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
    }
  }
  return clamp(anchors[anchors.length - 1]![1]);
}

function ballMasteryRatings(m: BallMasteryMetrics): Partial<Record<AttributeKey, number>> {
  // Fewer than 3 touches means rhythmCv is undefined (reported as 0): rate it as the worst case.
  const rhythmCv = m.touches < MIN_TOUCHES_FOR_RHYTHM ? Infinity : m.rhythmCv;
  return {
    ballControl: interpolateAnchors(m.touchesPerMinute, BALL_CONTROL),
    rhythm: interpolateAnchors(rhythmCv, RHYTHM),
    balance:
      (interpolateAnchors(m.footBalance, FOOT_BALANCE) + interpolateAnchors(m.hipSway, HIP_SWAY)) / 2,
  };
}

function shuttleRatings(m: AgilityShuttleMetrics): Partial<Record<AttributeKey, number>> {
  return {
    pace: interpolateAnchors(m.peakSpeedMps, PACE),
    agility: interpolateAnchors(m.meanTurnTimeMs, AGILITY),
    endurance: interpolateAnchors(m.fatigueIndex, ENDURANCE),
  };
}

/** Best value per attribute across all supplied results; attributes with no data are NEUTRAL_ATTRIBUTE. */
export function deriveAttributes(metrics: readonly DrillMetrics[]): AttributeVector {
  const best: Record<AttributeKey, number> = {
    pace: -1,
    agility: -1,
    ballControl: -1,
    balance: -1,
    rhythm: -1,
    endurance: -1,
  };
  for (const m of metrics) {
    const ratings = m.drillType === 'ball_mastery' ? ballMasteryRatings(m) : shuttleRatings(m);
    for (const key of ATTRIBUTE_KEYS) best[key] = Math.max(best[key], ratings[key] ?? -1);
  }
  const out = {} as Record<AttributeKey, number>;
  for (const key of ATTRIBUTE_KEYS) out[key] = best[key] < 0 ? NEUTRAL_ATTRIBUTE : best[key];
  return out;
}
