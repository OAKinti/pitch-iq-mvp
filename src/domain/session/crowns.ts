import type { Crowns, GroupMemberStat, RivalryObjective } from '../../types/contracts';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Day number (UTC days since epoch) of the caller's local calendar date. */
function localDayNumber(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

export function computeCrowns(members: readonly GroupMemberStat[], now: Date): Crowns {
  const today = localDayNumber(now);
  let performance: string | null = null;
  let bestOvr = -Infinity;
  let consistency: string | null = null;
  let bestDays = 0;
  for (const m of members) {
    if (m.bestOvr > bestOvr) {
      bestOvr = m.bestOvr;
      performance = m.userId;
    }
    const days = new Set<number>();
    for (const d of m.activeDays) {
      const n = Date.parse(`${d}T00:00:00Z`) / DAY_MS;
      if (n > today - WINDOW_DAYS && n <= today) days.add(n);
    }
    if (days.size > bestDays) {
      bestDays = days.size;
      consistency = m.userId;
    }
  }
  return { performance, consistency };
}

export function computeRivalry(me: GroupMemberStat, rival: GroupMemberStat): RivalryObjective {
  const ahead = me.bestOvr > rival.bestOvr;
  const gap = ahead ? 0 : round1(rival.bestOvr - me.bestOvr + 0.1);
  const progress = ahead ? 1 : Math.min(1, Math.max(0, me.bestOvr / (rival.bestOvr + 0.1)));
  return {
    userId: me.userId,
    rivalId: rival.userId,
    gap,
    progress,
    description: ahead
      ? `You lead ${rival.displayName} — defend it`
      : `Gain ${gap.toFixed(1)} OVR to pass ${rival.displayName}`,
  };
}
