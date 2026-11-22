import {
  ATTRIBUTE_KEYS,
  ELITE_BAND_FLOOR,
  type AgilityShuttleMetrics,
  type AttributeVector,
  type BallMasteryMetrics,
  type DrillMetrics,
  type PlayerPosition,
} from '../../types/contracts';
import { NEUTRAL_ATTRIBUTE, deriveAttributes, interpolateAnchors } from '../../domain/rating/attributes';
import { POSITION_WEIGHTS, compressEliteBand, computeOvr } from '../../domain/rating/ovr';
import { BADGE_CATALOG, evaluateBadges } from '../../domain/rating/badges';
import { PRO_ARCHETYPES, cosineSimilarity, matchArchetypes } from '../../domain/rating/archetypes';

const bm = (o: Partial<BallMasteryMetrics> = {}): BallMasteryMetrics => ({
  drillType: 'ball_mastery',
  touches: 50,
  leftTouches: 25,
  rightTouches: 25,
  touchesPerMinute: 100,
  rhythmCv: 0.2,
  footBalance: 0.8,
  hipSway: 0.05,
  touchTimestampsMs: [],
  durationMs: 30_000,
  ...o,
});
const sh = (o: Partial<AgilityShuttleMetrics> = {}): AgilityShuttleMetrics => ({
  drillType: 'agility_shuttle',
  totalTimeMs: 9600,
  splitTimesMs: [1600, 1600, 1600, 1600, 1600, 1600],
  peakSpeedMps: 5.5,
  meanTurnTimeMs: 450,
  splitCv: 0.02,
  fatigueIndex: 0.08,
  ...o,
});
const vec = (n: number): AttributeVector => ({
  pace: n, agility: n, ballControl: n, balance: n, rhythm: n, endurance: n,
});

describe('attributes', () => {
  it('interpolates anchors exactly and linearly', () => {
    const a = deriveAttributes([bm({ touchesPerMinute: 90 }), sh()]);
    expect(a.ballControl).toBeCloseTo(75, 9);
    expect(a.pace).toBeCloseTo(75, 9);
    expect(a.agility).toBeCloseTo(75, 9);
    expect(a.endurance).toBeCloseTo(75, 9);
    expect(a.rhythm).toBeCloseTo(55 + (0.25 - 0.2) / (0.25 - 0.15) * 20, 9);
    expect(deriveAttributes([bm({ touchesPerMinute: 105 })]).ballControl).toBeCloseTo(82.5, 9);
    expect(deriveAttributes([sh({ meanTurnTimeMs: 550 })]).agility).toBeCloseTo(65, 9);
  });
  it('balance is the mean of foot-balance and hip-sway ratings', () => {
    const a = deriveAttributes([bm({ footBalance: 0.8, hipSway: 0.05 })]);
    expect(a.balance).toBeCloseTo((70 + 70) / 2, 9);
    const b = deriveAttributes([bm({ footBalance: 1, hipSway: 0.02 })]);
    expect(b.balance).toBeCloseTo(95, 9);
  });
  it('holds end values outside the anchor range and clamps', () => {
    expect(deriveAttributes([bm({ touchesPerMinute: 0 })]).ballControl).toBe(35);
    expect(deriveAttributes([bm({ touchesPerMinute: 500 })]).ballControl).toBe(99);
    expect(deriveAttributes([sh({ fatigueIndex: -0.2 })]).endurance).toBe(99);
    expect(deriveAttributes([sh({ fatigueIndex: 5 })]).endurance).toBe(30);
    expect(deriveAttributes([sh({ peakSpeedMps: 20 })]).pace).toBe(99);
    expect(interpolateAnchors(1e9, [[0, 10], [1, 20]])).toBe(20);
  });
  it('missing drills are neutral (50)', () => {
    const none = deriveAttributes([]);
    for (const k of ATTRIBUTE_KEYS) expect(none[k]).toBe(NEUTRAL_ATTRIBUTE);
    const onlyBm = deriveAttributes([bm()]);
    expect(onlyBm.pace).toBe(50);
    expect(onlyBm.agility).toBe(50);
    expect(onlyBm.endurance).toBe(50);
    const onlySh = deriveAttributes([sh()]);
    expect(onlySh.ballControl).toBe(50);
    expect(onlySh.rhythm).toBe(50);
    expect(onlySh.balance).toBe(50);
  });
  it('takes the best value per attribute across results', () => {
    const results: DrillMetrics[] = [
      bm({ touchesPerMinute: 60 }),
      bm({ touchesPerMinute: 120 }),
      bm({ touchesPerMinute: 30 }),
      sh({ peakSpeedMps: 4 }),
      sh({ peakSpeedMps: 7 }),
    ];
    const a = deriveAttributes(results);
    expect(a.ballControl).toBe(90);
    expect(a.pace).toBe(90);
  });
  it('treats rhythm from fewer than 3 touches as worst case, not perfect', () => {
    const a = deriveAttributes([bm({ touches: 2, rhythmCv: 0 })]);
    expect(a.rhythm).toBe(30);
  });
});

describe('OVR', () => {
  const positions: PlayerPosition[] = ['GK', 'DEF', 'MID', 'FWD'];
  it('weights sum to 1 per position', () => {
    for (const p of positions) {
      const sum = ATTRIBUTE_KEYS.reduce((s, k) => s + POSITION_WEIGHTS[p][k], 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });
  it('elite compression is continuous at 95, monotonic and bounded', () => {
    expect(compressEliteBand(95)).toBe(95);
    expect(compressEliteBand(95 + 1e-9)).toBeCloseTo(95, 6);
    expect(compressEliteBand(50)).toBe(50);
    let prev = -Infinity;
    for (let r = 0; r <= 300; r += 0.5) {
      const c = compressEliteBand(r);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(compressEliteBand(99.9)).toBeLessThan(99.9);
    expect(compressEliteBand(200)).toBeLessThan(99.9);
    expect(compressEliteBand(200)).toBeGreaterThan(99.89);
    // slope 1 just above the join
    expect((compressEliteBand(95.01) - 95) / 0.01).toBeCloseTo(1, 2);
  });
  it('computes OVR from hand-built vectors using the weight table', () => {
    const attrs: AttributeVector = { pace: 80, agility: 70, ballControl: 60, balance: 50, rhythm: 40, endurance: 30 };
    for (const p of positions) {
      const w = POSITION_WEIGHTS[p];
      const raw =
        w.pace * 80 + w.agility * 70 + w.ballControl * 60 + w.balance * 50 + w.rhythm * 40 + w.endurance * 30;
      const r = computeOvr(attrs, p);
      expect(r.ovr).toBe(Math.round(raw * 10) / 10);
      expect(r.position).toBe(p);
      expect(r.sport).toBe('soccer');
      expect(r.attributes).toBe(attrs);
    }
  });
  it('assigns bands at the thresholds', () => {
    expect(computeOvr(vec(59.9), 'MID').band).toBe('developing');
    expect(computeOvr(vec(60), 'MID').band).toBe('standard');
    expect(computeOvr(vec(94.9), 'MID').band).toBe('standard');
    expect(computeOvr(vec(95), 'MID').band).toBe('elite');
    expect(computeOvr(vec(0), 'MID').band).toBe('developing');
  });
  it('never exceeds 99.9 and never goes below 0', () => {
    expect(computeOvr(vec(99.9), 'FWD').ovr).toBeLessThanOrEqual(99.9);
    expect(computeOvr(vec(500), 'FWD').ovr).toBe(99.9);
    expect(computeOvr(vec(-40), 'FWD').ovr).toBe(0);
    expect(ELITE_BAND_FLOOR).toBe(95);
  });
});

describe('badges', () => {
  const earned = (m: DrillMetrics): string[] => evaluateBadges([m]).map((b) => b.id);
  it('catalogue entries are labelled', () => {
    for (const [id, b] of Object.entries(BADGE_CATALOG)) {
      expect(b.id).toBe(id);
      expect(b.label.length).toBeGreaterThan(2);
      expect(b.description.length).toBeGreaterThan(10);
    }
  });
  it('metronome: cv <= 0.08 and >= 20 touches', () => {
    expect(earned(bm({ rhythmCv: 0.08, touches: 20 }))).toContain('metronome');
    expect(earned(bm({ rhythmCv: 0.081, touches: 20 }))).not.toContain('metronome');
    expect(earned(bm({ rhythmCv: 0.08, touches: 19 }))).not.toContain('metronome');
  });
  it('quick_feet: >= 100 touches/min', () => {
    expect(earned(bm({ touchesPerMinute: 100 }))).toContain('quick_feet');
    expect(earned(bm({ touchesPerMinute: 99.9 }))).not.toContain('quick_feet');
  });
  it('two_footed: balance >= 0.9 and >= 20 touches', () => {
    expect(earned(bm({ footBalance: 0.9, touches: 20 }))).toContain('two_footed');
    expect(earned(bm({ footBalance: 0.89, touches: 20 }))).not.toContain('two_footed');
    expect(earned(bm({ footBalance: 0.9, touches: 19 }))).not.toContain('two_footed');
  });
  it('rock_solid: hipSway <= 0.03', () => {
    expect(earned(bm({ hipSway: 0.03 }))).toContain('rock_solid');
    expect(earned(bm({ hipSway: 0.031 }))).not.toContain('rock_solid');
  });
  it('brake_master: meanTurnTime <= 350 ms', () => {
    expect(earned(sh({ meanTurnTimeMs: 350 }))).toContain('brake_master');
    expect(earned(sh({ meanTurnTimeMs: 351 }))).not.toContain('brake_master');
  });
  it('engine: fatigue <= 0.05 and >= 4 splits', () => {
    expect(earned(sh({ fatigueIndex: 0.05, splitTimesMs: [1, 1, 1, 1] }))).toContain('engine');
    expect(earned(sh({ fatigueIndex: 0.051 }))).not.toContain('engine');
    expect(earned(sh({ fatigueIndex: 0, splitTimesMs: [1, 1, 1] }))).not.toContain('engine');
  });
  it('burst: peak speed >= 6.5 m/s', () => {
    expect(earned(sh({ peakSpeedMps: 6.5 }))).toContain('burst');
    expect(earned(sh({ peakSpeedMps: 6.49 }))).not.toContain('burst');
  });
  it('is drill-specific, catalogue-ordered, de-duplicated and independent of everything but metrics', () => {
    const results: DrillMetrics[] = [
      bm({ rhythmCv: 0.05, touchesPerMinute: 120, footBalance: 1, hipSway: 0.01 }),
      bm({ rhythmCv: 0.05 }),
      sh({ meanTurnTimeMs: 300, fatigueIndex: 0, peakSpeedMps: 7 }),
    ];
    const ids = evaluateBadges(results).map((b) => b.id);
    expect(ids).toEqual(['metronome', 'quick_feet', 'two_footed', 'rock_solid', 'brake_master', 'engine', 'burst']);
    expect(evaluateBadges(results)).toEqual(evaluateBadges(results));
    expect(evaluateBadges([])).toEqual([]);
  });
});

describe('archetypes', () => {
  it('has six generic archetypes with names and taglines', () => {
    expect(PRO_ARCHETYPES.map((a) => a.id)).toEqual([
      'maestro', 'speedster', 'engine', 'wall', 'magician', 'sweeper_keeper',
    ]);
    for (const a of PRO_ARCHETYPES) {
      expect(a.name.length).toBeGreaterThan(3);
      expect(a.tagline.length).toBeGreaterThan(10);
    }
  });
  it('identical shape gives similarity 1 regardless of level', () => {
    for (const a of PRO_ARCHETYPES) {
      const shifted = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, a.profile[k] + 10])) as AttributeVector;
      expect(cosineSimilarity(a.profile, shifted)).toBeCloseTo(1, 12);
      expect(cosineSimilarity(a.profile, a.profile)).toBeCloseTo(1, 12);
    }
  });
  it('is -1 for an inverted shape and 0 for a flat vector', () => {
    const p = PRO_ARCHETYPES[0]!.profile;
    const mean = ATTRIBUTE_KEYS.reduce((s, k) => s + p[k], 0) / 6;
    const inverted = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 2 * mean - p[k]])) as AttributeVector;
    expect(cosineSimilarity(p, inverted)).toBeCloseTo(-1, 12);
    expect(cosineSimilarity(vec(50), p)).toBe(0);
    expect(cosineSimilarity(p, vec(50))).toBe(0);
  });
  it('orders by similarity and respects k', () => {
    const speedy: AttributeVector = { pace: 95, agility: 80, ballControl: 60, balance: 55, rhythm: 60, endurance: 70 };
    const top = matchArchetypes(speedy);
    expect(top).toHaveLength(3);
    expect(top[0]!.archetype.id).toBe('speedster');
    expect(top[0]!.similarity).toBeGreaterThan(top[1]!.similarity);
    expect(top[1]!.similarity).toBeGreaterThanOrEqual(top[2]!.similarity);
    expect(matchArchetypes(speedy, 1)).toHaveLength(1);
    expect(matchArchetypes(speedy, 6)).toHaveLength(6);
    expect(matchArchetypes(speedy, 99)).toHaveLength(6);
    expect(matchArchetypes(speedy, 0)).toEqual([]);
  });
  it('breaks ties by id ascending', () => {
    const ids = matchArchetypes(vec(70), 6).map((m) => m.archetype.id);
    expect(ids).toEqual(['engine', 'maestro', 'magician', 'speedster', 'sweeper_keeper', 'wall']);
  });
});
