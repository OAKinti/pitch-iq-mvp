import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgeBracket,
  CoachPersona,
  ConsentRecord,
  DrillResult,
  GroupMemberStat,
  OvrResult,
  PlayerPosition,
} from '../../types/contracts';
import type { AppConfig } from '../config';
import { buildInviteUrl, INVITE_CODE_RE } from '../invites/inviteLink';
import { getSupabaseClient } from './client';

export interface ProfileInput {
  displayName: string;
  ageBracket: AgeBracket;
  position: PlayerPosition | null;
  persona: CoachPersona;
}

export type SyncStatus = 'ok' | 'offline' | 'error';

export type JoinFailureReason =
  | 'invite_invalid'
  | 'parental_consent_required'
  | 'profile_required'
  | 'not_authenticated'
  | 'offline';
export type JoinResult = { ok: true; groupId: string } | { ok: false; reason: JoinFailureReason };

/** Postgres exception text arrives in `message`; map by substring. Anything unknown is treated as offline. */
function mapJoinError(message: string): JoinFailureReason {
  for (const reason of [
    'parental_consent_required',
    'profile_required',
    'not_authenticated',
    'invite_invalid',
  ] as const) {
    if (message.includes(reason)) return reason;
  }
  return 'offline';
}

/** Parental verification is server-only (service_role); the client may never record it. */
function assertClientConsent(consent: ConsentRecord): void {
  if (consent.type === 'parental_verified') {
    throw new Error('recordConsent refused: parental_verified can only be set by the server');
  }
}

export interface PitchIqRepository {
  /** Upsert on id; age_bracket is only written on first insert (the server ignores later changes). */
  saveProfile(userId: string, profile: ProfileInput): Promise<void>;
  saveDrillResult(userId: string, result: DrillResult, ovr: OvrResult): Promise<void>;
  recordConsent(userId: string, consent: ConsentRecord): Promise<void>;
  listGroupMembers(groupId: string): Promise<GroupMemberStat[]>;
  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void;
  createGroupInvite(groupId: string): Promise<{ code: string; url: string }>;
  joinGroupByInvite(code: string): Promise<JoinResult>;
}

export const DEMO_GROUP_ID = 'demo-group-sunday-league';
export const DEMO_INVITE_CODE = 'DEMSQUAD23';
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
  {
    userId: 'demo-maya',
    displayName: 'Maya Rivera',
    bestOvr: 78.4,
    daysAgo: [0, 1, 3, 4, 6, 9, 12, 15, 21, 30, 44, 60, 75],
  },
  { userId: 'demo-jonas', displayName: 'Jonas Weber', bestOvr: 83.1, daysAgo: [2, 9, 20, 41, 70] },
  {
    userId: 'demo-amara',
    displayName: 'Amara Okafor',
    bestOvr: 71.9,
    daysAgo: [0, 2, 5, 7, 10, 14, 19, 33, 50, 66, 88],
  },
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

  async saveProfile(_userId: string, _profile: ProfileInput): Promise<void> {
    // Demo mode: the profile lives in app state and local storage only.
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

  async recordConsent(_userId: string, consent: ConsentRecord): Promise<void> {
    assertClientConsent(consent);
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

  async createGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    if (groupId !== DEMO_GROUP_ID) throw new Error('createGroupInvite failed: not_a_member');
    return { code: DEMO_INVITE_CODE, url: buildInviteUrl(DEMO_INVITE_CODE) };
  }

  async joinGroupByInvite(code: string): Promise<JoinResult> {
    return code.trim().toUpperCase() === DEMO_INVITE_CODE
      ? { ok: true, groupId: DEMO_GROUP_ID }
      : { ok: false, reason: 'invite_invalid' };
  }
}

interface MemberRow {
  user_id: string;
  display_name: string | null;
}
interface ResultRow {
  user_id: string;
  ovr: number | string;
  submitted_at: string;
}

export class SupabaseRepository implements PitchIqRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** AUTH-2: writes are owned by auth.uid(); the demo placeholder id must never reach the server. */
  private assertRealUser(userId: string): void {
    if (userId === DEMO_USER_ID) throw new Error('refusing to write with the demo user id');
  }

  async saveProfile(userId: string, profile: ProfileInput): Promise<void> {
    this.assertRealUser(userId);
    const inserted = await this.client.from('profiles').insert({
      id: userId,
      display_name: profile.displayName,
      age_bracket: profile.ageBracket,
      position: profile.position,
      persona: profile.persona,
    });
    if (!inserted.error) return;
    if (inserted.error.code !== '23505') {
      throw new Error(`saveProfile failed: ${inserted.error.message}`);
    }
    // Row exists: update only the user-editable columns (age_bracket is column-revoked, migration 004).
    const updated = await this.client
      .from('profiles')
      .update({
        display_name: profile.displayName,
        position: profile.position,
        persona: profile.persona,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (updated.error) throw new Error(`saveProfile failed: ${updated.error.message}`);
  }

  async saveDrillResult(userId: string, result: DrillResult, ovr: OvrResult): Promise<void> {
    this.assertRealUser(userId);
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
    assertClientConsent(consent);
    this.assertRealUser(userId);
    const { error } = await this.client.from('consents').insert({
      user_id: userId,
      consent_type: consent.type,
      policy_version: consent.policyVersion,
      granted_at: consent.grantedAt,
    });
    // 23505: this (user, type, policy_version) is already recorded; insert-only, so that is success.
    if (error && error.code !== '23505') throw new Error(`recordConsent failed: ${error.message}`);
  }

  async listGroupMembers(groupId: string): Promise<GroupMemberStat[]> {
    // Names come from the members-only RPC (migration 007): co-members never read profile rows,
    // and an unverified under-13 is returned as 'Player'.
    const membersRes = await this.client.rpc('squad_member_names', { p_group_id: groupId });
    if (membersRes.error) throw new Error(`listGroupMembers failed: ${membersRes.error.message}`);
    const rows = (membersRes.data ?? []) as unknown as MemberRow[];

    const resultsRes = await this.client
      .from('group_session_results')
      .select('user_id, ovr, submitted_at, group_sessions!inner(group_id)')
      .eq('group_sessions.group_id', groupId);
    if (resultsRes.error) throw new Error(`listGroupMembers failed: ${resultsRes.error.message}`);
    const results = (resultsRes.data ?? []) as unknown as ResultRow[];

    const stats = rows.map((row) => {
      const mine = results.filter((r) => r.user_id === row.user_id);
      const days = new Set(mine.map((r) => r.submitted_at.slice(0, 10)));
      return {
        userId: row.user_id,
        displayName: row.display_name || 'Player',
        bestOvr: mine.reduce((best, r) => Math.max(best, Number(r.ovr)), 0),
        activeDays: [...days].sort(),
      };
    });
    // Canonical order (CON-7): ascending userId, plain compare, independent of row order.
    return stats.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  }

  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void {
    let closed = false;
    let started = 0;
    let delivered = 0;
    // State-based convergence: every trigger refetches; latest-wins delivery (CON-5).
    const refresh = (): void => {
      const n = ++started;
      this.listGroupMembers(groupId)
        .then((members) => {
          if (closed || n <= delivered) return;
          delivered = n;
          onChange(members);
        })
        .catch(() => undefined);
    };
    const channel = this.client
      .channel(`group:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_session_results' },
        // Payload is a trigger only, never data (SEC-12).
        () => refresh(),
      )
      .subscribe((status: string) => {
        // First join and every rejoin after CHANNEL_ERROR / TIMED_OUT (REC-4).
        if (status === 'SUBSCRIBED' && !closed) refresh();
      });
    return () => {
      if (closed) return;
      closed = true;
      void this.client.removeChannel(channel);
    };
  }

  async createGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    const { data, error } = await this.client.rpc('create_group_invite', { p_group_id: groupId });
    if (error) throw new Error(`createGroupInvite failed: ${error.message}`);
    if (typeof data !== 'string' || !INVITE_CODE_RE.test(data)) {
      throw new Error('createGroupInvite failed: malformed code');
    }
    return { code: data, url: buildInviteUrl(data) };
  }

  async joinGroupByInvite(code: string): Promise<JoinResult> {
    try {
      const { data, error } = await this.client.rpc('join_group_by_invite', { p_code: code });
      if (error) return { ok: false, reason: mapJoinError(String(error.message ?? '')) };
      if (typeof data !== 'string' || data.length === 0)
        return { ok: false, reason: 'invite_invalid' };
      return { ok: true, groupId: data };
    } catch {
      return { ok: false, reason: 'offline' };
    }
  }
}

export function createRepository(
  config: AppConfig,
  deps: { client?: SupabaseClient | null; clock?: () => number } = {},
): PitchIqRepository {
  const client = deps.client !== undefined ? deps.client : getSupabaseClient(config);
  return client ? new SupabaseRepository(client) : new DemoRepository(deps.clock);
}
