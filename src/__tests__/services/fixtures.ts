import type { DrillResult, OvrResult, Badge, ArchetypeMatch } from '../../types/contracts';

export const ballResult: DrillResult = {
  id: 'r1',
  sport: 'soccer',
  drillType: 'ball_mastery',
  startedAt: '2026-11-22T10:00:00.000Z',
  metrics: {
    drillType: 'ball_mastery',
    touches: 62,
    leftTouches: 30,
    rightTouches: 32,
    touchesPerMinute: 124,
    rhythmCv: 0.12,
    footBalance: 0.94,
    hipSway: 0.03,
    touchTimestampsMs: [500, 1000],
    durationMs: 30000,
  },
};

export const shuttleResult: DrillResult = {
  id: 'r2',
  sport: 'soccer',
  drillType: 'agility_shuttle',
  startedAt: '2026-11-22T11:00:00.000Z',
  metrics: {
    drillType: 'agility_shuttle',
    totalTimeMs: 9800,
    splitTimesMs: [1500, 1600, 1650, 1700, 1700, 1650],
    peakSpeedMps: 5.4,
    meanTurnTimeMs: 320,
    splitCv: 0.05,
    fatigueIndex: 0.1,
  },
};

export const ovr: OvrResult = {
  sport: 'soccer',
  position: 'MID',
  ovr: 72.5,
  band: 'standard',
  attributes: { pace: 70, agility: 68, ballControl: 75, balance: 72, rhythm: 80, endurance: 66 },
};

export const badges: Badge[] = [{ id: 'metronome', label: 'Metronome', description: 'Steady rhythm' }];

export const archetype: ArchetypeMatch = {
  archetype: {
    id: 'a1',
    name: 'The Playmaker',
    tagline: 'Vision',
    profile: ovr.attributes,
  },
  similarity: 0.91,
};
