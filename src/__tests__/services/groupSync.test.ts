import { SupabaseRepository } from '../../services/supabase/repository';
import type { GroupMemberStat } from '../../types/contracts';
import { createFakeRealtimeServer, type ClientHandle } from './fakeRealtime';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function seed() {
  const server = createFakeRealtimeServer();
  server.addMember('u-c', 'Cara');
  server.addMember('u-a', 'Ann');
  server.addMember('u-b', 'Bo');
  server.addResult('u-a', 70, '2026-11-20T10:00:00Z');
  server.addResult('u-b', 70, '2026-11-21T10:00:00Z');
  server.addResult('u-c', 55, '2026-11-21T12:00:00Z');
  return server;
}

function attach(handle: ClientHandle) {
  const onChange = jest.fn<void, [GroupMemberStat[]]>();
  const off = new SupabaseRepository(handle.client).subscribeToGroup('g', onChange);
  const last = (): GroupMemberStat[] | undefined => onChange.mock.calls.at(-1)?.[0];
  return { onChange, off, last };
}

describe('group leaderboard convergence (two clients, fake Realtime)', () => {
  it('forged event payload never reaches onChange', async () => {
    const server = seed();
    const a = server.connect();
    const sub = attach(a);
    a.status('SUBSCRIBED');
    await settle();
    sub.onChange.mockClear();
    a.emit({ new: { user_id: 'evil', ovr: 99, group_id: 'other' }, eventType: 'INSERT' });
    await settle();
    expect(sub.onChange).toHaveBeenCalledTimes(1);
    expect(sub.last()).toEqual(server.truth());
    expect(JSON.stringify(sub.last())).not.toContain('evil');
  });

  it('client that missed updates converges on rejoin', async () => {
    const server = seed();
    const a = server.connect();
    const b = server.connect();
    const subA = attach(a);
    const subB = attach(b);
    a.status('SUBSCRIBED');
    b.status('SUBSCRIBED');
    await settle();
    b.status('CHANNEL_ERROR');
    server.addResult('u-a', 81, '2026-11-22T09:00:00Z');
    a.emit();
    server.addMember('u-d', 'Dee');
    server.addResult('u-d', 90, '2026-11-22T10:00:00Z');
    a.emit();
    server.removeMember('u-c');
    a.emit();
    await settle();
    expect(subB.last()).not.toEqual(server.truth());
    b.status('TIMED_OUT');
    b.status('SUBSCRIBED');
    await settle();
    expect(subA.last()).toEqual(server.truth());
    expect(subB.last()).toEqual(server.truth());
    expect(subB.last()).toEqual(subA.last());
  });

  it('leave silences in-flight fetches and removes the channel once', async () => {
    const server = seed();
    const a = server.connect();
    const sub = attach(a);
    a.status('SUBSCRIBED');
    await settle();
    a.deferQueries();
    sub.onChange.mockClear();
    a.emit();
    expect(a.pendingFetches()).toBe(1);
    sub.off();
    sub.off();
    await a.resolveAll();
    server.addResult('u-a', 99, '2026-11-23T10:00:00Z');
    a.emit();
    a.status('SUBSCRIBED');
    await settle();
    expect(sub.onChange).not.toHaveBeenCalled();
    expect(a.removeChannelCalls()).toBe(1);
  });

  it('a fresh subscribe after leave converges', async () => {
    const server = seed();
    const a = server.connect();
    const first = attach(a);
    a.status('SUBSCRIBED');
    await settle();
    first.off();
    server.addResult('u-b', 88, '2026-11-23T10:00:00Z');
    const second = attach(a);
    expect(a.channelCount()).toBe(2);
    a.status('SUBSCRIBED');
    await settle();
    expect(second.last()).toEqual(server.truth());
  });

  it('stale fetch resolving after a newer one is dropped', async () => {
    const server = seed();
    const a = server.connect();
    const sub = attach(a);
    a.deferQueries();
    a.emit(); // fetch 1 reads the old state
    server.addResult('u-c', 95, '2026-11-22T10:00:00Z');
    a.emit(); // fetch 2 reads the new state
    expect(a.pendingFetches()).toBe(2);
    await a.resolveAllReversed();
    await settle();
    expect(sub.onChange).toHaveBeenCalledTimes(1);
    expect(sub.last()).toEqual(server.truth());
    expect(sub.last()?.find((m) => m.userId === 'u-c')?.bestOvr).toBe(95);
  });

  it('duplicate and reordered events converge on both clients', async () => {
    const server = seed();
    const a = server.connect();
    const b = server.connect();
    const subA = attach(a);
    const subB = attach(b);
    a.status('SUBSCRIBED');
    b.status('SUBSCRIBED');
    await settle();
    server.addResult('u-a', 77, '2026-11-22T10:00:00Z');
    server.addResult('u-b', 66, '2026-11-22T11:00:00Z');
    server.addResult('u-c', 99, '2026-11-22T12:00:00Z');
    const events = [{ id: 1 }, { id: 2 }, { id: 3 }];
    a.deliver(events);
    a.emitTwice(events[0]);
    b.deliver([...events].reverse());
    b.emitTwice(events[2]);
    b.deliver([events[1], events[1], events[0]]);
    await settle();
    expect(subA.last()).toEqual(server.truth());
    expect(subB.last()).toEqual(server.truth());
    expect(subA.last()).toEqual(subB.last());
  });

  it('row order changes neither the snapshot nor the ranked order on tied bestOvr', async () => {
    const server = seed(); // u-a and u-b tie at 70
    const rank = (m: GroupMemberStat[] | undefined) =>
      [...(m ?? [])].sort((x, y) => y.bestOvr - x.bestOvr).map((x) => x.userId);
    const snaps: GroupMemberStat[][] = [];
    for (const order of ['asc', 'desc', 'shuffled'] as const) {
      const h = server.connect();
      h.rowOrder(order);
      const sub = attach(h);
      h.status('SUBSCRIBED');
      await settle();
      const snap = sub.last();
      expect(snap).toEqual(server.truth());
      snaps.push(snap ?? []);
    }
    expect(snaps[1]).toEqual(snaps[0]);
    expect(snaps[2]).toEqual(snaps[0]);
    expect(rank(snaps[0])).toEqual(['u-a', 'u-b', 'u-c']);
    expect(rank(snaps[1])).toEqual(rank(snaps[0]));
    expect(rank(snaps[2])).toEqual(rank(snaps[0]));
  });

  it('failed refetch keeps the last snapshot and the next event recovers', async () => {
    const server = seed();
    const a = server.connect();
    const sub = attach(a);
    a.status('SUBSCRIBED');
    await settle();
    const before = sub.last();
    a.deferQueries();
    server.addResult('u-c', 97, '2026-11-22T10:00:00Z');
    a.emit();
    await a.rejectNext();
    await settle();
    expect(sub.onChange).toHaveBeenCalledTimes(1);
    expect(sub.last()).toBe(before);
    a.status('CLOSED');
    await settle();
    expect(sub.onChange).toHaveBeenCalledTimes(1);
    await a.resolveAll();
    a.emit();
    await settle();
    expect(sub.onChange).toHaveBeenCalledTimes(2);
    expect(sub.last()).toEqual(server.truth());
  });
});
