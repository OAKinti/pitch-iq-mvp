import { act, screen } from '@testing-library/react-native';
import { DemoRepository } from '../../services/supabase/repository';
import type { PitchIqRepository } from '../../services/supabase/repository';
import type { GroupMemberStat } from '../../types/contracts';
import { renderNavigator } from './helpers';

const stat = (userId: string, displayName: string, bestOvr: number): GroupMemberStat => ({
  userId,
  displayName,
  bestOvr,
  activeDays: ['2026-11-20'],
});

function deferredRepo() {
  let resolveList: (m: GroupMemberStat[]) => void = () => undefined;
  let push: (m: GroupMemberStat[]) => void = () => undefined;
  const list = new Promise<GroupMemberStat[]>((r) => {
    resolveList = r;
  });
  const repository: PitchIqRepository = Object.assign(new DemoRepository(), {
    listGroupMembers: () => list,
    subscribeToGroup: (_g: string, cb: (m: GroupMemberStat[]) => void) => {
      push = cb;
      return () => undefined;
    },
  });
  return {
    repository,
    resolveList: (m: GroupMemberStat[]) => resolveList(m),
    push: (m: GroupMemberStat[]) => push(m),
  };
}

describe('GroupSessionScreen snapshot ordering (CON-8)', () => {
  it('late initial list never overwrites a subscription snapshot', async () => {
    const d = deferredRepo();
    await renderNavigator({ initialRoute: 'GroupSession', repository: d.repository });
    await act(async () => {
      d.push([stat('fresh-1', 'Fresh One', 90)]);
    });
    expect(screen.getByTestId('leaderboard-row-fresh-1')).toBeTruthy();
    await act(async () => {
      d.resolveList([stat('stale-1', 'Stale One', 50)]);
      await Promise.resolve();
    });
    expect(screen.getByTestId('leaderboard-row-fresh-1')).toBeTruthy();
    expect(screen.queryByTestId('leaderboard-row-stale-1')).toBeNull();
  });

  it('initial list is shown when no snapshot arrived', async () => {
    const d = deferredRepo();
    await renderNavigator({ initialRoute: 'GroupSession', repository: d.repository });
    await act(async () => {
      d.resolveList([stat('init-1', 'Init One', 60)]);
      await Promise.resolve();
    });
    expect(screen.getByTestId('leaderboard-row-init-1')).toBeTruthy();
  });
});
