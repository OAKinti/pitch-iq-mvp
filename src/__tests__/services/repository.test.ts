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
    // Member list read goes through the squad_member_names RPC (migration 007).
    rpc: (fn: string) => {
      calls.push({ table: fn, op: 'rpc' });
      return Promise.resolve(opts.responses[fn === 'squad_member_names' ? 'group_members' : fn] ?? { data: [], error: null });
    },
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
        { user_id: 'a', display_name: 'Ann' },
        { user_id: 'b', display_name: 'Bo' },
        { user_id: 'c', display_name: null },
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
          group_members: { data: [{ user_id: 'a', display_name: null }], error: null },
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

describe('SupabaseRepository identity and profile writes (S2)', () => {
  type Err = { message: string; code?: string } | null;
  type Call = { table: string; op: string; arg?: unknown; eq?: unknown };
  function recordingClient(errors: { insert?: Err; update?: Err } = {}) {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => ({
        insert: (row: unknown) => {
          calls.push({ table, op: 'insert', arg: row });
          return Promise.resolve({ data: null, error: errors.insert ?? null });
        },
        update: (row: unknown) => {
          const call: Call = { table, op: 'update', arg: row };
          calls.push(call);
          return {
            eq: (col: string, val: unknown) => {
              call.eq = [col, val];
              return Promise.resolve({ data: null, error: errors.update ?? null });
            },
          };
        },
      }),
    } as unknown as SupabaseClient;
    return { client, calls };
  }
  const profile = {
    displayName: 'Player',
    ageBracket: 'teen_13_17',
    position: 'MID',
    persona: 'captain',
  } as const;
  const consent = { type: 'camera_skeletal_tracking', policyVersion: 'v', grantedAt: 't' } as const;

  it('AUTH-2: demo user id is never sent to Supabase', async () => {
    const f = recordingClient();
    const repo = new SupabaseRepository(f.client);
    await expect(repo.saveProfile(DEMO_USER_ID, profile)).rejects.toThrow('demo user id');
    await expect(repo.saveDrillResult(DEMO_USER_ID, ballResult, ovr)).rejects.toThrow(
      'demo user id',
    );
    await expect(repo.recordConsent(DEMO_USER_ID, consent)).rejects.toThrow('demo user id');
    expect(f.calls).toHaveLength(0);
  });

  it('AUTH-2: writes carry the session user id', async () => {
    const f = recordingClient();
    const repo = new SupabaseRepository(f.client);
    await repo.saveProfile('uid-1', profile);
    await repo.saveDrillResult('uid-1', ballResult, ovr);
    await repo.recordConsent('uid-1', consent);
    expect(f.calls[0]).toMatchObject({
      table: 'profiles',
      op: 'insert',
      arg: { id: 'uid-1', age_bracket: 'teen_13_17', persona: 'captain', position: 'MID' },
    });
    expect(f.calls[1]?.arg).toMatchObject({ user_id: 'uid-1' });
    expect(f.calls[2]?.arg).toMatchObject({ user_id: 'uid-1' });
  });

  it('saveProfile on an existing row updates editable columns only (never age_bracket)', async () => {
    const f = recordingClient({ insert: { message: 'dup', code: '23505' } });
    await new SupabaseRepository(f.client).saveProfile('uid-1', { ...profile, persona: 'hype' });
    const update = f.calls.find((c) => c.op === 'update');
    expect(update?.eq).toEqual(['id', 'uid-1']);
    expect(Object.keys(update?.arg as object).sort()).toEqual([
      'display_name',
      'persona',
      'position',
      'updated_at',
    ]);
    expect(update?.arg).toMatchObject({ persona: 'hype' });
  });

  it('saveProfile surfaces insert and update failures', async () => {
    await expect(
      new SupabaseRepository(recordingClient({ insert: { message: 'rls' } }).client).saveProfile(
        'u',
        profile,
      ),
    ).rejects.toThrow('saveProfile failed: rls');
    await expect(
      new SupabaseRepository(
        recordingClient({
          insert: { message: 'dup', code: '23505' },
          update: { message: 'denied' },
        }).client,
      ).saveProfile('u', profile),
    ).rejects.toThrow('saveProfile failed: denied');
  });

  it('recordConsent treats an already-recorded consent (unique violation) as success', async () => {
    const f = recordingClient({ insert: { message: 'dup', code: '23505' } });
    await expect(
      new SupabaseRepository(f.client).recordConsent('uid-1', consent),
    ).resolves.toBeUndefined();
  });

  it('AUTH-5: parental_verified is refused client-side without calling the server', async () => {
    const f = recordingClient();
    const pv = { type: 'parental_verified', policyVersion: 'v', grantedAt: 't' } as const;
    await expect(new SupabaseRepository(f.client).recordConsent('uid-1', pv)).rejects.toThrow(
      'parental_verified',
    );
    await expect(new DemoRepository().recordConsent('u', pv)).rejects.toThrow('parental_verified');
    expect(f.calls).toHaveLength(0);
  });

  it('DemoRepository.saveProfile resolves', async () => {
    await expect(new DemoRepository().saveProfile('u', profile)).resolves.toBeUndefined();
  });
});

describe('invite links (repository)', () => {
  const rpcClient = (impl: (fn: string, args: unknown) => unknown) =>
    ({ rpc: jest.fn(async (fn: string, args: unknown) => impl(fn, args)) }) as unknown as SupabaseClient;

  it('INV-3 demo repository: creates and joins the demo invite, rejects others', async () => {
    const repo = new DemoRepository();
    const { code, url } = await repo.createGroupInvite(DEMO_GROUP_ID);
    expect(url).toBe(`pitchiq://join/${code}`);
    expect(await repo.joinGroupByInvite(` ${code.toLowerCase()} `)).toEqual({
      ok: true,
      groupId: DEMO_GROUP_ID,
    });
    expect(await repo.joinGroupByInvite('ZZZZZZZZZZ')).toEqual({ ok: false, reason: 'invite_invalid' });
    await expect(repo.createGroupInvite('other')).rejects.toThrow('not_a_member');
  });

  it('INV-3 supabase: create calls the RPC and builds the url', async () => {
    const client = rpcClient(() => ({ data: 'ABCDEFGHJK', error: null }));
    const out = await new SupabaseRepository(client).createGroupInvite('g1');
    expect(out).toEqual({ code: 'ABCDEFGHJK', url: 'pitchiq://join/ABCDEFGHJK' });
    expect(client.rpc).toHaveBeenCalledWith('create_group_invite', { p_group_id: 'g1' });
  });

  it('INV-3 supabase: create rejects on RPC error or malformed code', async () => {
    await expect(
      new SupabaseRepository(rpcClient(() => ({ data: null, error: { message: 'not_a_member' } }))).createGroupInvite('g'),
    ).rejects.toThrow('not_a_member');
    await expect(
      new SupabaseRepository(rpcClient(() => ({ data: 'bad', error: null }))).createGroupInvite('g'),
    ).rejects.toThrow('malformed');
  });

  it('INV-3 supabase: join success returns the group id', async () => {
    const client = rpcClient(() => ({ data: 'group-uuid', error: null }));
    expect(await new SupabaseRepository(client).joinGroupByInvite('ABCDEFGHJK')).toEqual({
      ok: true,
      groupId: 'group-uuid',
    });
    expect(client.rpc).toHaveBeenCalledWith('join_group_by_invite', { p_code: 'ABCDEFGHJK' });
  });

  it.each([
    ['not_authenticated', 'not_authenticated'],
    ['profile_required', 'profile_required'],
    ['parental_consent_required', 'parental_consent_required'],
    ['invite_invalid', 'invite_invalid'],
    ['connection reset', 'offline'],
  ])('INV-3 supabase: error %s maps to %s', async (message, reason) => {
    const repo = new SupabaseRepository(rpcClient(() => ({ data: null, error: { message } })));
    expect(await repo.joinGroupByInvite('ABCDEFGHJK')).toEqual({ ok: false, reason });
  });

  it('INV-3 supabase: empty data is invalid; a thrown RPC is offline', async () => {
    expect(
      await new SupabaseRepository(rpcClient(() => ({ data: null, error: null }))).joinGroupByInvite('X'),
    ).toEqual({ ok: false, reason: 'invite_invalid' });
    const boom = rpcClient(() => {
      throw new Error('network');
    });
    expect(await new SupabaseRepository(boom).joinGroupByInvite('X')).toEqual({ ok: false, reason: 'offline' });
  });
});
