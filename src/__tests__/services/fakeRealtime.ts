import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroupMemberStat } from '../../types/contracts';

export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
export type RowOrder = 'asc' | 'desc' | 'shuffled';

interface MemberRecord {
  userId: string;
  displayName: string;
}
interface ResultRecord {
  userId: string;
  ovr: number;
  submittedAt: string;
}
interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}
interface Pending {
  fetchId: number;
  table: string;
  settle: (rejectWith?: string) => void;
}
interface FakeChannel {
  handler: ((payload?: unknown) => void) | null;
  statusCb: ((status: string) => void) | null;
}

export interface ClientHandle {
  client: SupabaseClient;
  /** Queries issued from now on stay pending until resolved/rejected by the controls. */
  deferQueries(): void;
  /** Resolve the oldest pending fetch (both of its sequential queries). */
  resolveNext(): Promise<void>;
  /** Resolve every pending fetch, newest first. */
  resolveAllReversed(): Promise<void>;
  /** Fail the oldest pending fetch with an error result. */
  rejectNext(): Promise<void>;
  /** Stop deferring and resolve everything pending, oldest first. */
  resolveAll(): Promise<void>;
  emit(payload?: unknown): void;
  emitTwice(payload?: unknown): void;
  deliver(events: readonly unknown[]): void;
  status(status: RealtimeStatus): void;
  rowOrder(order: RowOrder): void;
  pendingFetches(): number;
  removeChannelCalls(): number;
  channelCount(): number;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

function arrange<T>(rows: readonly T[], order: RowOrder): T[] {
  const copy = [...rows];
  if (order === 'desc') return copy.reverse();
  if (order === 'shuffled') {
    // Deterministic interleave: odd positions first, then even positions reversed.
    const odd = copy.filter((_, i) => i % 2 === 1);
    const even = copy.filter((_, i) => i % 2 === 0).reverse();
    return [...odd, ...even];
  }
  return copy;
}

export function createFakeRealtimeServer() {
  let members: MemberRecord[] = [];
  let results: ResultRecord[] = [];

  const addMember = (userId: string, displayName: string = userId): void => {
    members = [...members.filter((m) => m.userId !== userId), { userId, displayName }];
  };
  const removeMember = (userId: string): void => {
    members = members.filter((m) => m.userId !== userId);
  };
  const addResult = (userId: string, ovr: number, submittedAt: string): void => {
    results = [...results, { userId, ovr, submittedAt }];
  };

  const truth = (): GroupMemberStat[] =>
    members
      .map((m) => {
        const mine = results.filter((r) => r.userId === m.userId);
        return {
          userId: m.userId,
          displayName: m.displayName,
          bestOvr: mine.reduce((best, r) => Math.max(best, r.ovr), 0),
          activeDays: [...new Set(mine.map((r) => r.submittedAt.slice(0, 10)))].sort(),
        };
      })
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  const connect = (): ClientHandle => {
    let deferred = false;
    let order: RowOrder = 'asc';
    let fetchCounter = 0;
    let lastMembersFetch = 0;
    let removeCalls = 0;
    const pending: Pending[] = [];
    const channels: FakeChannel[] = [];

    const issue = (table: string): Promise<QueryResult> => {
      // Data is captured when the query is issued, like a server read at that instant.
      const data =
        table === 'group_members'
          ? arrange(members, order).map((m) => ({
              user_id: m.userId,
              display_name: m.displayName,
            }))
          : arrange(results, order).map((r) => ({
              user_id: r.userId,
              ovr: r.ovr,
              submitted_at: r.submittedAt,
            }));
      const fetchId = table === 'group_members' ? ++fetchCounter : lastMembersFetch;
      if (!deferred) return Promise.resolve({ data, error: null });
      return new Promise<QueryResult>((resolve) => {
        pending.push({
          fetchId,
          table,
          settle: (rejectWith) =>
            resolve(
              rejectWith ? { data: null, error: { message: rejectWith } } : { data, error: null },
            ),
        });
      });
    };

    const from = (table: string) => {
      const q = {
        select: () => q,
        eq: () => issue(table),
      };
      return q;
    };

    const take = (fetchId: number): Pending | undefined => {
      const i = pending.findIndex((p) => p.fetchId === fetchId);
      return i < 0 ? undefined : pending.splice(i, 1)[0];
    };

    const settleFetch = async (fetchId: number, rejectWith?: string): Promise<void> => {
      for (let step = 0; step < 2; step += 1) {
        const p = take(fetchId);
        if (!p) return;
        if (p.table === 'group_members') lastMembersFetch = p.fetchId;
        p.settle(rejectWith);
        await flush();
        if (rejectWith) return;
      }
    };

    const fetchIds = (): number[] => [...new Set(pending.map((p) => p.fetchId))];

    const channel = (): unknown => {
      const ch: FakeChannel = { handler: null, statusCb: null };
      channels.push(ch);
      const api = {
        on: (_type: string, _filter: unknown, cb: (payload?: unknown) => void) => {
          ch.handler = cb;
          return api;
        },
        subscribe: (cb: (status: string) => void) => {
          ch.statusCb = cb;
          return api;
        },
      };
      return api;
    };

    const emit = (payload?: unknown): void => {
      for (const ch of channels) ch.handler?.(payload);
    };

    const handle: ClientHandle = {
      client: {
        from,
        // squad_member_names (migration 007) is the member list read; it behaves like the old select.
        rpc: (fn: string) => issue(fn === 'squad_member_names' ? 'group_members' : fn),
        channel,
        removeChannel: () => {
          removeCalls += 1;
          return Promise.resolve('ok');
        },
      } as unknown as SupabaseClient,
      deferQueries: () => {
        deferred = true;
      },
      resolveNext: async () => {
        const id = fetchIds()[0];
        if (id !== undefined) await settleFetch(id);
      },
      resolveAllReversed: async () => {
        for (const id of fetchIds().sort((a, b) => b - a)) await settleFetch(id);
      },
      rejectNext: async () => {
        const id = fetchIds()[0];
        if (id !== undefined) await settleFetch(id, 'fetch failed');
      },
      resolveAll: async () => {
        deferred = false;
        for (const id of fetchIds().sort((a, b) => a - b)) await settleFetch(id);
      },
      emit,
      emitTwice: (payload) => {
        emit(payload);
        emit(payload);
      },
      deliver: (events) => {
        for (const e of events) emit(e);
      },
      status: (status) => {
        for (const ch of channels) ch.statusCb?.(status);
      },
      rowOrder: (o) => {
        order = o;
      },
      pendingFetches: () => fetchIds().length,
      removeChannelCalls: () => removeCalls,
      channelCount: () => channels.length,
    };
    return handle;
  };

  return { connect, addMember, removeMember, addResult, truth };
}

export type FakeRealtimeServer = ReturnType<typeof createFakeRealtimeServer>;
