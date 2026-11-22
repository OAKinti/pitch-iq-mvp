import type { GroupMemberStat } from '../../types/contracts';
import { classifyAge, defaultVisibility, requiresParentalConsent } from '../../domain/session/ageGate';
import { computeCrowns, computeRivalry } from '../../domain/session/crowns';
import { selectPeakStreakWindow } from '../../domain/highlights/peakStreak';

const NOW = new Date(2026, 10, 22, 12, 0, 0); // 22 Nov 2026 local

describe('age gate', () => {
  it('classifies brackets with conservative month math', () => {
    expect(classifyAge(2013, 10, NOW)).toBe('teen_13_17'); // turned 13 last month
    expect(classifyAge(2013, 11, NOW)).toBe('under_13'); // turning 13 this month counts as 12
    expect(classifyAge(2013, 12, NOW)).toBe('under_13');
    expect(classifyAge(2008, 10, NOW)).toBe('adult_18_plus');
    expect(classifyAge(2008, 11, NOW)).toBe('teen_13_17');
    expect(classifyAge(1990, 5, NOW)).toBe('adult_18_plus');
    expect(classifyAge(2026, 11, NOW)).toBe('under_13');
    expect(classifyAge(2026, 1, NOW)).toBe('under_13');
  });
  it('rejects invalid, future, and implausible input', () => {
    expect(classifyAge(NaN, 5, NOW)).toBeNull();
    expect(classifyAge(1990.5, 5, NOW)).toBeNull();
    expect(classifyAge(1990, 5.5, NOW)).toBeNull();
    expect(classifyAge(1990, 0, NOW)).toBeNull();
    expect(classifyAge(1990, 13, NOW)).toBeNull();
    expect(classifyAge(2027, 1, NOW)).toBeNull();
    expect(classifyAge(2026, 12, NOW)).toBeNull();
    expect(classifyAge(1900, 1, NOW)).toBeNull();
    expect(classifyAge(1906, 11, NOW)).toBe('adult_18_plus'); // exactly 119 by conservative math
    expect(classifyAge(1905, 12, NOW)).toBe('adult_18_plus'); // 120
    expect(classifyAge(1905, 10, NOW)).toBeNull(); // 121
  });
  it('visibility and parental-consent helpers', () => {
    expect(defaultVisibility('under_13')).toBe('private');
    expect(defaultVisibility('teen_13_17')).toBe('friends');
    expect(defaultVisibility('adult_18_plus')).toBe('friends');
    expect(requiresParentalConsent('under_13')).toBe(true);
    expect(requiresParentalConsent('teen_13_17')).toBe(false);
    expect(requiresParentalConsent('adult_18_plus')).toBe(false);
  });
});

const member = (userId: string, bestOvr: number, activeDays: string[]): GroupMemberStat => ({
  userId, displayName: userId.toUpperCase(), bestOvr, activeDays,
});

describe('crowns', () => {
  it('handles empty input and members with no qualifying days', () => {
    expect(computeCrowns([], NOW)).toEqual({ performance: null, consistency: null });
    expect(computeCrowns([member('a', 70, [])], NOW)).toEqual({ performance: 'a', consistency: null });
  });
  it('performance = highest OVR, ties to the first member', () => {
    const c = computeCrowns([member('a', 70, []), member('b', 82.5, []), member('c', 82.5, [])], NOW);
    expect(c.performance).toBe('b');
  });
  it('consistency counts distinct days in the trailing 90-day window', () => {
    const c = computeCrowns(
      [
        member('a', 60, ['2026-11-22', '2026-11-22', '2026-11-21']), // 2 distinct
        member('b', 60, ['2026-11-20', '2026-11-19', '2026-11-18']), // 3 distinct
      ],
      NOW,
    );
    expect(c.consistency).toBe('b');
  });
  it('window boundary: day 90 ago is excluded, day 89 ago included; future and junk ignored', () => {
    // 2026-11-22 minus 90 days = 2026-08-24 (excluded); minus 89 = 2026-08-25 (included)
    const c = computeCrowns(
      [
        member('old', 50, ['2026-08-24', '2026-08-23', '2026-08-22']),
        member('edge', 50, ['2026-08-25']),
        member('future', 50, ['2026-11-23', '2027-01-01', 'not-a-date']),
      ],
      NOW,
    );
    expect(c.consistency).toBe('edge');
  });
  it('consistency ties go to the first member', () => {
    const c = computeCrowns(
      [member('a', 1, ['2026-11-01']), member('b', 1, ['2026-11-02'])],
      NOW,
    );
    expect(c.consistency).toBe('a');
  });
});

describe('rivalry', () => {
  it('behind: gap = rival - me + 0.1 rounded to 1 dp, progress ratio', () => {
    const r = computeRivalry(member('me', 70, []), { ...member('sam', 72.3, []), displayName: 'Sam' });
    expect(r.gap).toBe(2.4);
    expect(r.progress).toBeCloseTo(70 / 72.4, 12);
    expect(r.description).toBe('Gain 2.4 OVR to pass Sam');
    expect(r.userId).toBe('me');
    expect(r.rivalId).toBe('sam');
  });
  it('ahead: zero gap, full progress, defend message', () => {
    const r = computeRivalry(member('me', 80, []), { ...member('sam', 75, []), displayName: 'Sam' });
    expect(r.gap).toBe(0);
    expect(r.progress).toBe(1);
    expect(r.description).toBe('You lead Sam — defend it');
  });
  it('level counts as behind by 0.1; progress is clamped to [0, 1]', () => {
    expect(computeRivalry(member('me', 70, []), member('s', 70, [])).gap).toBe(0.1);
    expect(computeRivalry(member('me', -5, []), member('s', 70, [])).progress).toBe(0);
    expect(computeRivalry(member('me', 70, []), member('s', 70, [])).progress).toBeLessThan(1);
  });
});

describe('selectPeakStreakWindow', () => {
  it('finds the densest 15 s window', () => {
    const events = [1000, 2000, 20_000, 21_000, 22_000, 23_000, 40_000];
    const w = selectPeakStreakWindow(events, 60_000);
    expect(w).toEqual({ startMs: 20_000, endMs: 35_000, eventCount: 4 });
  });
  it('ties go to the earliest window', () => {
    const w = selectPeakStreakWindow([1000, 2000, 30_000, 31_000], 60_000);
    expect(w.startMs).toBe(1000);
    expect(w.eventCount).toBe(2);
  });
  it('clamps the start so the window stays inside the drill', () => {
    const w = selectPeakStreakWindow([28_000, 29_000, 29_500], 30_000);
    expect(w).toEqual({ startMs: 15_000, endMs: 30_000, eventCount: 3 });
  });
  it('accepts unsorted input and custom windows', () => {
    const w = selectPeakStreakWindow([5000, 1000, 4000, 4500], 20_000, 2000);
    expect(w).toEqual({ startMs: 4000, endMs: 6000, eventCount: 3 });
  });
  it('total shorter than the window returns the whole drill', () => {
    expect(selectPeakStreakWindow([100, 200, 9000], 5000)).toEqual({ startMs: 0, endMs: 5000, eventCount: 2 });
    expect(selectPeakStreakWindow([], 5000)).toEqual({ startMs: 0, endMs: 5000, eventCount: 0 });
  });
  it('no events in a long drill returns the first window with zero events', () => {
    expect(selectPeakStreakWindow([], 60_000)).toEqual({ startMs: 0, endMs: 15_000, eventCount: 0 });
  });
  it('total exactly equal to the window is a single window', () => {
    expect(selectPeakStreakWindow([0, 14_999, 15_000], 15_000)).toEqual({ startMs: 0, endMs: 15_000, eventCount: 2 });
  });
});
