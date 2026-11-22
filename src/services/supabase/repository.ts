import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsentRecord, DrillResult, GroupMemberStat, OvrResult } from '../../types/contracts';
import type { AppConfig } from '../config';
import { getSupabaseClient } from './client';

export interface PitchIqRepository {
  saveDrillResult(userId: string, result: DrillResult, ovr: OvrResult): Promise<void>;
  recordConsent(userId: string, consent: ConsentRecord): Promise<void>;
  listGroupMembers(groupId: string): Promise<GroupMemberStat[]>;
  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void;
}

export const DEMO_GROUP_ID = 'demo-group-sunday-league';
export const DEMO_USER_ID = 'demo-you';
const DAY_MS = 86_400_000;

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Fictional players; offsets are "days ago" within the last 90 days. */
const SEED: readonly {
  userId: string;
  displayName: string;
  bestOvr: number;
  daysAgo: readonly number[];
}[] = [
  { userId: 'demo-maya', displayName: 'Maya Rivera', bestOvr: 78.4, daysAgo: [0, 1, 3, 4, 6, 9, 12, 15, 21, 30, 44, 60, 75] },
  { userId: 'demo-jonas', displayName: 'Jonas Weber', bestOvr: 83.1, daysAgo: [2, 9, 20, 41, 70] },
  { userId: 'demo-amara', displayName: 'Amara Okafor', bestOvr: 71.9, daysAgo: [0, 2, 5, 7, 10, 14, 19, 33, 50, 66, 88] },
  { userId: 'demo-kenji', displayName: 'Kenji Tanaka', bestOvr: 66.2, daysAgo: [1, 8, 29, 57] },
  { userId: DEMO_USER_ID, displayName: 'You', bestOvr: 0, daysAgo: [] },
];

export class DemoRepository implements PitchIqRepository {
  private members: GroupMemberStat[];
  private listeners = new Set<{ groupId: string; cb: (m: GroupMemberStat[]) => void }>();
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
    const now = clock();
    this.members = SEED.map((s) => ({
      userId: s.userId,
      displayName: s.displayName,
      bestOvr: s.bestOvr,
      activeDays: s.daysAgo.map((d) => isoDay(now - d * DAY_MS)),
    }));
  }

  private snapshot(): GroupMemberStat[] {
    return this.members.map((m) => ({ ...m, activeDays: [...m.activeDays] }));
  }

  async saveDrillResult(_userId: string, _result: DrillResult, ovr: OvrResult): Promise<void> {
    const day = isoDay(this.clock());
    this.members = this.members.map((m) =>
      m.userId !== DEMO_USER_ID
        ? m
        : {
            ...m,
            bestOvr: Math.max(m.bestOvr, ovr.ovr),
            activeDays: m.activeDays.includes(day) ? m.activeDays : [...m.activeDays, day],
          },
    );
    for (const l of this.listeners) if (l.groupId === DEMO_GROUP_ID) l.cb(this.snapshot());
  }

  async recordConsent(_userId: string, _consent: ConsentRecord): Promise<void> {
    // Demo mode: consents live in app state only.
  }

  async listGroupMembers(groupId: string): Promise<GroupMemberStat[]> {
    return groupId === DEMO_GROUP_ID ? this.snapshot() : [];
  }

  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void {
    const entry = { groupId, cb: onChange };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }
}

interface MemberRow {
  user_id: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
}
interface ResultRow {
  user_id: string;
  ovr: number | string;
  submitted_at: string;
}

export class SupabaseRepository implements PitchIqRepository {
  constructor(private readonly client: SupabaseClient) {}

  async saveDrillResult(userId: string, result: DrillResult, ovr: OvrResult): Promise<void> {
    const { error } = await this.client.from('drill_sessions').insert({
      user_id: userId,
      sport: result.sport,
      drill_type: result.drillType,
      started_at: result.startedAt,
      metrics: result.metrics,
      ovr: ovr.ovr,
    });
    if (error) throw new Error(`saveDrillResult failed: ${error.message}`);
  }

  async recordConsent(userId: string, consent: ConsentRecord): Promise<void> {
    const { error } = await this.client.from('consents').insert({
      user_id: userId,
      consent_type: consent.type,
      policy_version: consent.policyVersion,
      granted_at: consent.grantedAt,
    });
    if (error) throw new Error(`recordConsent failed: ${error.message}`);
  }

  async listGroupMembers(groupId: string): Promise<GroupMemberStat[]> {
    const membersRes = await this.client
      .from('group_members')
      .select('user_id, profiles(display_name)')
      .eq('group_id', groupId);
    if (membersRes.error) throw new Error(`listGroupMembers failed: ${membersRes.error.message}`);
    const rows = (membersRes.data ?? []) as unknown as MemberRow[];

    const resultsRes = await this.client
      .from('group_session_results')
      .select('user_id, ovr, submitted_at, group_sessions!inner(group_id)')
      .eq('group_sessions.group_id', groupId);
    if (resultsRes.error) throw new Error(`listGroupMembers failed: ${resultsRes.error.message}`);
    const results = (resultsRes.data ?? []) as unknown as ResultRow[];

    return rows.map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const mine = results.filter((r) => r.user_id === row.user_id);
      const days = new Set(mine.map((r) => r.submitted_at.slice(0, 10)));
      return {
        userId: row.user_id,
        displayName: profile?.display_name ?? 'Player',
        bestOvr: mine.reduce((best, r) => Math.max(best, Number(r.ovr)), 0),
        activeDays: [...days].sort(),
      };
    });
  }

  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void {
    const channel = this.client
      .channel(`group:${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_session_results' }, () => {
        void this.listGroupMembers(groupId)
          .then(onChange)
          .catch(() => undefined);
      })
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}

export function createRepository(
  config: AppConfig,
  deps: { client?: SupabaseClient | null; clock?: () => number } = {},
): PitchIqRepository {
  const client = deps.client !== undefined ? deps.client : getSupabaseClient(config);
  return client ? new SupabaseRepository(client) : new DemoRepository(deps.clock);
}
