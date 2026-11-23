import type { Badge, BadgeId, DrillMetrics } from '../../types/contracts';

export const BADGE_CATALOG: Readonly<Record<BadgeId, Badge>> = {
  metronome: {
    id: 'metronome',
    label: 'Metronome',
    description: 'Rock-steady touch rhythm (variation 8% or less over 20+ touches).',
  },
  quick_feet: {
    id: 'quick_feet',
    label: 'Quick Feet',
    description: 'Reached 100 or more touches per minute.',
  },
  two_footed: {
    id: 'two_footed',
    label: 'Two-Footed',
    description: 'Balanced left and right foot work (90% or better over 20+ touches).',
  },
  rock_solid: {
    id: 'rock_solid',
    label: 'Rock Solid',
    description: 'Very stable base with minimal hip sway.',
  },
  brake_master: {
    id: 'brake_master',
    label: 'Brake Master',
    description: 'Turns in 350 ms or less.',
  },
  engine: {
    id: 'engine',
    label: 'Engine',
    description: 'Barely slows down: fatigue under 5% across 4+ legs.',
  },
  burst: {
    id: 'burst',
    label: 'Burst',
    description: 'Peak speed of 6.5 m/s or more.',
  },
};

const BADGE_ORDER: readonly BadgeId[] = [
  'metronome',
  'quick_feet',
  'two_footed',
  'rock_solid',
  'brake_master',
  'engine',
  'burst',
];

const EARNED: Record<BadgeId, (m: DrillMetrics) => boolean> = {
  metronome: (m) => m.drillType === 'ball_mastery' && m.rhythmCv <= 0.08 && m.touches >= 20,
  quick_feet: (m) => m.drillType === 'ball_mastery' && m.touchesPerMinute >= 100,
  two_footed: (m) => m.drillType === 'ball_mastery' && m.footBalance >= 0.9 && m.touches >= 20,
  rock_solid: (m) => m.drillType === 'ball_mastery' && m.hipSway <= 0.03,
  brake_master: (m) => m.drillType === 'agility_shuttle' && m.meanTurnTimeMs <= 350,
  engine: (m) =>
    m.drillType === 'agility_shuttle' && m.fatigueIndex <= 0.05 && m.splitTimesMs.length >= 4,
  burst: (m) => m.drillType === 'agility_shuttle' && m.peakSpeedMps >= 6.5,
};

/** Pure function of drill metrics; never reads or influences OVR. Catalogue order, each at most once. */
export function evaluateBadges(metrics: readonly DrillMetrics[]): Badge[] {
  return BADGE_ORDER.filter((id) => metrics.some(EARNED[id])).map((id) => BADGE_CATALOG[id]);
}
