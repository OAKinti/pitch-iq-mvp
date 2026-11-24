import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createRepository,
  DEMO_GROUP_ID,
  DEMO_USER_ID,
  DemoRepository,
  SupabaseRepository,
} from '../../services/supabase/repository';
import { getSupabaseClient, resetSupabaseClientForTests } from '../../services/supabase/client';
import { ballResult, ovr } from './fixtures';

const NOW = Date.parse('2026-11-22T12:00:00Z');

describe('DemoRepository', () => {
  it('seeds 4 fictional players plus You with activeDays in last 90 days', async () => {
    const repo = new DemoRepository(() => NOW);
    const members = await repo.listGroupMembers(DEMO_GROUP_ID);
    expect(members).toHaveLength(5);
    const cutoff = NOW - 90 * 86_400_000;
    for (const m of members) {
      for (const d of m.activeDays) {
        expect(Date.parse(d)).toBeGreaterThanOrEqual(cutoff - 86_400_000);
        expect(Date.parse(d)).toBeLessThanOrEqual(NOW);
      }
    }
    expect(members.find((m) => m.userId === DEMO_USER_ID)?.displayName).toBe('You');
  });

  it('returns nothing for unknown groups', async () => {
    expect(await new DemoRepository(() => NOW).listGroupMembers('nope')).toEqual([]);
  });

  it('saveDrillResult updates You and notifies listeners; unsubscribe stops them', async () => {
    const repo = new DemoRepository(() => NOW);
    const cb = jest.fn();
    const other = jest.fn();
    const off = repo.subscribeToGroup(DEMO_GROUP_ID, cb);
    repo.subscribeToGroup('other-group', other);
    await repo.saveDrillResult('u', ballResult, ovr);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    const you = cb.mock.calls[0][0].find((m: { userId: string }) => m.userId === DEMO_USER_ID);
    expect(you.bestOvr).toBe(72.5);
    expect(you.activeDays).toEqual(['2026-11-22']);
    await repo.saveDrillResult('u', ballResult, { ...ovr, ovr: 60 });
    const you2 = (await repo.listGroupMembers(DEMO_GROUP_ID)).find(
      (m) => m.userId === DEMO_USER_ID,
    );
    expect(you2?.bestOvr).toBe(72.5);
    expect(you2?.activeDays).toHaveLength(1);
    off();
    await repo.saveDrillResult('u', ballResult, ovr);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('recordConsent resolves', async () => {
    await expect(
      new DemoRepository().recordConsent('u', {
        type: 'voice_coach',
        policyVersion: 'v',
        grantedAt: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});

type Resp = { data: unknown; error: { message: string } | null };

function fakeClient(opts: { responses: Record<string, Resp> }) {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  let handler: (() => void) | null = null;
  const removeChannel = jest.fn();
  const chain = (table: string) => {
    const resp = opts.responses[table] ?? { data: [], error: null };
    const q: Record<string, unknown> = {
      insert: (row: unknown) => {
        calls.push({ table, op: 'insert', arg: row });
        return Promise.resolve(resp);
      },
      select: (cols: string) => {
        calls.push({ table, op: 'select', arg: cols });
        return q;
      },
      eq: () => Promise.resolve(resp),
    };
    return q;
  };
  const channel: { on: jest.Mock; subscribe: jest.Mock } = {
    on: jest.fn((_t: string, _f: unknown, cb: () => void): unknown => {
      handler = cb;
      return channel;
    }),
    subscribe: jest.fn(() => channel),
  };
  const client = {
    from: (t: string) => chain(t),
    channel: jest.fn(() => channel),
    removeChannel,
  } as unknown as SupabaseClient;
  return { client, calls, channel, removeChannel, fire: () => handler?.() };
}

describe('SupabaseRepository (fake client)', () => {
  it('inserts drill_sessions and consents', async () => {
    const f = fakeClient({ responses: {} });
    const repo = new SupabaseRepository(f.client);
    await repo.saveDrillResult('u1', ballResult, ovr);
    await repo.recordConsent('u1', {
      type: 'camera_skeletal_tracking',
      policyVersion: '2026-11-22',
      grantedAt: 't',
    });
    expect(f.calls[0]).toMatchObject({ table: 'drill_sessions', op: 'insert' });
    expect((f.calls[0]?.arg as Record<string, unknown>).ovr).toBe(72.5);
    expect(f.calls[1]).toMatchObject({
      table: 'consents',
      arg: { consent_type: 'camera_skeletal_tracking' },
    });
  });

  it('throws on insert errors', async () => {
    const f = fakeClient({
      responses: {
        drill_sessions: { data: null, error: { message: 'boom' } },
        consents: { data: null, error: { message: 'nope' } },
      },
    });
    const repo = new SupabaseRepository(f.client);
    await expect(repo.saveDrillResult('u', ballResult, ovr)).rejects.toThrow('boom');
    await expect(
      repo.recordConsent('u', { type: 'voice_coach', policyVersion: 'v', grantedAt: 't' }),
    ).rejects.toThrow('nope');
  });

  const okResponses: Record<string, Resp> = {
    group_members: {
      data: [
        { user_id: 'a', profiles: { display_name: 'Ann' } },
        { user_id: 'b', profiles: [{ display_name: 'Bo' }] },
        { user_id: 'c', profiles: null },
      ],
      error: null,
    },
    group_session_results: {
      data: [
        { user_id: 'a', ovr: '70.5', submitted_at: '2026-11-20T10:00:00Z' },
        { user_id: 'a', ovr: 75, submitted_at: '2026-11-21T10:00:00Z' },
        { user_id: 'a', ovr: 60, submitted_at: '2026-11-21T18:00:00Z' },
        { user_id: 'b', ovr: 50, submitted_at: '2026-11-19T10:00:00Z' },
      ],
      error: null,
    },
  };

  it('aggregates group members, profiles and results', async () => {
    const repo = new SupabaseRepository(fakeClient({ responses: okResponses }).client);
    const members = await repo.listGroupMembers('g');
    expect(members).toEqual([
      { userId: 'a', displayName: 'Ann', bestOvr: 75, activeDays: ['2026-11-20', '2026-11-21'] },
      { userId: 'b', displayName: 'Bo', bestOvr: 50, activeDays: ['2026-11-19'] },
      { userId: 'c', displayName: 'Player', bestOvr: 0, activeDays: [] },
    ]);
  });

  it('handles null data and errors in list', async () => {
    const empty = new SupabaseRepository(
      fakeClient({ responses: { group_members: { data: null, error: null } } }).client,
    );
    expect(await empty.listGroupMembers('g')).toEqual([]);
    const e1 = new SupabaseRepository(
      fakeClient({ responses: { group_members: { data: null, error: { message: 'm' } } } }).client,
    );
    await expect(e1.listGroupMembers('g')).rejects.toThrow('m');
    const e2 = new SupabaseRepository(
      fakeClient({
        responses: {
          group_members: { data: [], error: null },
          group_session_results: { data: null, error: { message: 'r' } },
        },
      }).client,
    );
    await expect(e2.listGroupMembers('g')).rejects.toThrow('r');
    const noResults = new SupabaseRepository(
      fakeClient({
        responses: {
          group_members: { data: [{ user_id: 'a', profiles: null }], error: null },
          group_session_results: { data: null, error: null },
        },
      }).client,
    );
    expect(await noResults.listGroupMembers('g')).toHaveLength(1);
  });

  it('subscribes to postgres_changes on group_session_results and cleans up', async () => {
    const f = fakeClient({ responses: okResponses });
    const repo = new SupabaseRepository(f.client);
    const onChange = jest.fn();
    const off = repo.subscribeToGroup('g', onChange);
    expect(f.channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'group_session_results' },
      expect.any(Function),
    );
    f.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
    expect(f.removeChannel).toHaveBeenCalled();
  });

  it('refetches on every SUBSCRIBED and stops after unsubscribe', async () => {
    const f = fakeClient({ responses: okResponses });
    const repo = new SupabaseRepository(f.client);
    const onChange = jest.fn();
    const off = repo.subscribeToGroup('g', onChange);
    const statusCb = f.channel.subscribe.mock.calls[0][0] as (s: string) => void;
    const flush = () => new Promise((r) => setTimeout(r, 0));
    statusCb('SUBSCRIBED');
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    statusCb('CHANNEL_ERROR');
    statusCb('TIMED_OUT');
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    statusCb('SUBSCRIBED');
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    // Late fetch after unsubscribe stays silent.
    statusCb('SUBSCRIBED');
    off();
    off();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    statusCb('SUBSCRIBED');
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('swallows refresh errors in the subscription', async () => {
    const f = fakeClient({ responses: { group_members: { data: null, error: { message: 'x' } } } });
    const onChange = jest.fn();
    new SupabaseRepository(f.client).subscribeToGroup('g', onChange);
    f.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('createRepository / getSupabaseClient', () => {
  beforeEach(resetSupabaseClientForTests);

  it('returns DemoRepository in demo mode', () => {
    const repo = createRepository({ demoMode: true, supabaseUrl: null, supabaseAnonKey: null });
    expect(repo).toBeInstanceOf(DemoRepository);
  });

  it('returns null client in demo mode and a singleton otherwise', () => {
    expect(
      getSupabaseClient({
        demoMode: true,
        supabaseUrl: 'https://a.supabase.co',
        supabaseAnonKey: 'k',
      }),
    ).toBeNull();
    expect(
      getSupabaseClient({ demoMode: false, supabaseUrl: null, supabaseAnonKey: null }),
    ).toBeNull();
    const cfg = { demoMode: false, supabaseUrl: 'https://a.supabase.co', supabaseAnonKey: 'k' };
    const c1 = getSupabaseClient(cfg);
    expect(c1).not.toBeNull();
    expect(getSupabaseClient(cfg)).toBe(c1);
    expect(getSupabaseClient({ ...cfg, supabaseUrl: 'https://b.supabase.co' })).not.toBe(c1);
  });

  it('returns SupabaseRepository when a client exists', () => {
    const repo = createRepository({
      demoMode: false,
      supabaseUrl: 'https://a.supabase.co',
      supabaseAnonKey: 'k',
    });
    expect(repo).toBeInstanceOf(SupabaseRepository);
    expect(
      createRepository(
        { demoMode: true, supabaseUrl: null, supabaseAnonKey: null },
        { client: fakeClient({ responses: {} }).client },
      ),
    ).toBeInstanceOf(SupabaseRepository);
  });
});
