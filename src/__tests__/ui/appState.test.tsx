import React from 'react';
import { AppState as RNAppState } from 'react-native';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AppStateProvider, useAppState, type AppState } from '../../state/AppStateContext';
import { DEMO_USER_ID, type AuthService, type PitchIqRepository } from '../../services';
import { createLocalProfileStore, createMemoryStorage } from '../../services/persist/localProfile';
import { createVoiceCoach } from '../../services/voice/voiceCoach';
import type { VoiceCoach } from '../../services';
import type { JoinResult, ProfileInput } from '../../services/supabase/repository';
import type {
  ConsentRecord,
  Debrief,
  DrillResult,
  GroupMemberStat,
  OvrResult,
} from '../../types/contracts';
import { CAMERA_CONSENT, fixedNow, simulateResult } from './helpers';

const FAKE_CLIENT = { fake: true } as unknown as SupabaseClient;

jest.mock('../../services/supabase/client', () => ({
  getSupabaseClient: jest.fn((config: { demoMode: boolean }) =>
    config.demoMode ? null : FAKE_CLIENT,
  ),
  resetSupabaseClientForTests: jest.fn(),
}));
jest.mock('../../services/voice/voiceCoach', () => {
  const actual = jest.requireActual('../../services/voice/voiceCoach');
  return { ...actual, createVoiceCoach: jest.fn(actual.createVoiceCoach) };
});

const createVoiceCoachMock = createVoiceCoach as jest.MockedFunction<typeof createVoiceCoach>;

let app: AppState;
function Capture() {
  app = useAppState();
  return null;
}

const LIVE_CONFIG = { demoMode: false, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' };

function fakeRepo(): jest.Mocked<PitchIqRepository> {
  return {
    saveProfile: jest.fn<Promise<void>, [string, ProfileInput]>(async () => undefined),
    saveDrillResult: jest.fn<Promise<void>, [string, DrillResult, OvrResult]>(
      async () => undefined,
    ),
    recordConsent: jest.fn<Promise<void>, [string, ConsentRecord]>(async () => undefined),
    listGroupMembers: jest.fn<Promise<GroupMemberStat[]>, [string]>(async () => []),
    subscribeToGroup: jest.fn<() => void, [string, (m: GroupMemberStat[]) => void]>(
      () => () => undefined,
    ),
    createGroupInvite: jest.fn<Promise<{ code: string; url: string }>, [string]>(async () => ({
      code: 'ABCDEFGHJK',
      url: 'pitchiq://join/ABCDEFGHJK',
    })),
    joinGroupByInvite: jest.fn<Promise<JoinResult>, [string]>(async () => ({ ok: true as const, groupId: 'g' })),
  };
}

function fakeAuth(...sessions: (string | null)[]): jest.Mocked<AuthService> {
  let i = 0;
  let current: string | null = null;
  return {
    ensureSession: jest.fn(async () => {
      const next = sessions[Math.min(i, sessions.length - 1)] ?? null;
      i += 1;
      if (next) current = next;
      return next ? { userId: next, isAnonymous: true } : null;
    }),
    currentUserId: jest.fn(() => current),
  };
}

const textDebrief = (text: string): Debrief => ({
  text,
  audioUri: null,
  source: 'template',
  ttsChars: text.length,
  estimatedCostUsd: 0,
});

function fakeVoice(debriefFn: VoiceCoach['debrief']): VoiceCoach {
  const real = createVoiceCoach({ persona: 'captain', transport: null });
  return { ...real, debrief: debriefFn };
}

async function mount(props: Partial<React.ComponentProps<typeof AppStateProvider>> = {}) {
  const localProfile = props.localProfile ?? createLocalProfileStore(createMemoryStorage());
  await render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppStateProvider now={fixedNow} localProfile={localProfile} {...props}>
        <Capture />
      </AppStateProvider>
    </SafeAreaProvider>,
  );
  return localProfile;
}

const flush = () => act(async () => undefined);

beforeEach(async () => {
  await AsyncStorage.clear();
  createVoiceCoachMock.mockClear();
});

describe('AppStateProvider auth and sync', () => {
  it('Demo Mode: session is the demo user and writes use it', async () => {
    const repository = fakeRepo();
    await mount({ repository });
    await flush();
    expect(app.userId).toBe(DEMO_USER_ID);
    expect(app.syncStatus).toBe('ok');
  });

  it('AUTH-2: every repository write uses the session user id, never the demo id', async () => {
    const repository = fakeRepo();
    await mount({ repository, auth: fakeAuth('uid-7') });
    await flush();
    await act(async () => app.setAge('adult_18_plus'));
    await act(async () => app.grantConsent('camera_skeletal_tracking'));
    await act(async () => app.completeDrill(simulateResult('ball_mastery')));
    await flush();

    expect(repository.saveProfile).toHaveBeenCalledWith(
      'uid-7',
      expect.objectContaining({ ageBracket: 'adult_18_plus', persona: 'captain', position: 'MID' }),
    );
    expect(repository.recordConsent).toHaveBeenCalledWith(
      'uid-7',
      expect.objectContaining({ type: 'camera_skeletal_tracking' }),
    );
    expect(repository.saveDrillResult).toHaveBeenCalledWith(
      'uid-7',
      expect.anything(),
      expect.anything(),
    );
    const used = [
      ...repository.saveProfile.mock.calls,
      ...repository.recordConsent.mock.calls,
      ...repository.saveDrillResult.mock.calls,
    ].map((c) => c[0]);
    expect(used).not.toContain(DEMO_USER_ID);
    expect(app.syncStatus).toBe('ok');
  });

  it('writes the profile before its consent', async () => {
    const order: string[] = [];
    const repository = fakeRepo();
    repository.saveProfile.mockImplementation(async () => {
      order.push('profile');
    });
    repository.recordConsent.mockImplementation(async () => {
      order.push('consent');
    });
    await mount({ repository, auth: fakeAuth('uid-1') });
    await flush();
    await act(async () => {
      app.setAge('teen_13_17');
      app.grantConsent('camera_skeletal_tracking');
    });
    await flush();
    expect(order.slice(0, 2)).toEqual(['profile', 'consent']);
  });

  it('queues writes while offline, reports offline, and flushes on the next successful session', async () => {
    const repository = fakeRepo();
    const auth = fakeAuth(null, 'uid-9');
    let handler: ((s: string) => void) | undefined;
    const spy = jest.spyOn(RNAppState, 'addEventListener').mockImplementation(((
      _: string,
      h: (s: string) => void,
    ) => {
      handler = h;
      return { remove: jest.fn() };
    }) as never);

    await mount({ repository, auth });
    await flush();
    expect(app.syncStatus).toBe('offline');
    expect(app.userId).toBeNull();

    await act(async () => app.setAge('adult_18_plus'));
    await act(async () => app.grantConsent('camera_skeletal_tracking'));
    expect(repository.saveProfile).not.toHaveBeenCalled();
    expect(repository.recordConsent).not.toHaveBeenCalled();
    expect(app.syncStatus).toBe('offline');

    await act(async () => handler?.('active'));
    await flush();
    expect(auth.ensureSession).toHaveBeenCalledTimes(2);
    expect(repository.saveProfile).toHaveBeenCalledWith('uid-9', expect.anything());
    expect(repository.recordConsent).toHaveBeenCalledWith('uid-9', expect.anything());
    expect(app.syncStatus).toBe('ok');
    expect(app.userId).toBe('uid-9');

    // Already signed in: foregrounding again does not re-run the session flow.
    await act(async () => handler?.('active'));
    expect(auth.ensureSession).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('AUTH-3: a rejected write surfaces as syncStatus error, then recovers on the next success', async () => {
    const repository = fakeRepo();
    repository.saveDrillResult.mockRejectedValueOnce(new Error('rls denied'));
    await mount({ repository, auth: fakeAuth('uid-3') });
    await flush();
    await act(async () => app.completeDrill(simulateResult('ball_mastery')));
    await flush();
    expect(app.syncStatus).toBe('error');

    await act(async () => app.completeDrill(simulateResult('agility_shuttle')));
    await flush();
    expect(app.syncStatus).toBe('ok');
  });

  it('RACE-2: completeDrill is idempotent per drill result id', async () => {
    const repository = fakeRepo();
    await mount({ repository, auth: fakeAuth('uid-3') });
    await flush();
    const result = simulateResult('ball_mastery');
    await act(async () => {
      app.completeDrill(result);
      app.completeDrill(result);
    });
    await act(async () => app.completeDrill(result));
    await flush();
    expect(app.results).toHaveLength(1);
    expect(repository.saveDrillResult).toHaveBeenCalledTimes(1);
  });

  it('RACE-1: a stale debrief never overwrites a newer drill debrief', async () => {
    const resolvers: ((d: Debrief) => void)[] = [];
    const voiceCoach = fakeVoice(() => new Promise<Debrief>((resolve) => resolvers.push(resolve)));
    await mount({ repository: fakeRepo(), voiceCoach, auth: fakeAuth('uid-3') });
    await flush();
    await act(async () => app.completeDrill({ ...simulateResult('ball_mastery'), id: 'first' }));
    await act(async () =>
      app.completeDrill({ ...simulateResult('agility_shuttle'), id: 'second' }),
    );
    expect(resolvers).toHaveLength(2);

    await act(async () => resolvers[1]?.(textDebrief('newer')));
    expect(app.debrief?.text).toBe('newer');
    await act(async () => resolvers[0]?.(textDebrief('stale')));
    expect(app.debrief?.text).toBe('newer');
  });

  it('a failed debrief request is ignored without clearing state', async () => {
    const voiceCoach = fakeVoice(() => Promise.reject(new Error('boom')));
    await mount({ repository: fakeRepo(), voiceCoach });
    await flush();
    await act(async () => app.completeDrill(simulateResult('ball_mastery')));
    expect(app.debrief).toBeNull();
    expect(app.results).toHaveLength(1);
  });
});

describe('AppStateProvider COPPA and persistence', () => {
  it('COPPA-1: under-13 (unverified) gets a VoiceCoach with transport null; adults get a transport', async () => {
    await mount({ config: LIVE_CONFIG, repository: fakeRepo(), auth: fakeAuth('uid-1') });
    await flush();
    const lastTransport = () => createVoiceCoachMock.mock.calls.at(-1)?.[0].transport;
    expect(lastTransport()).not.toBeNull();

    await act(async () => app.setAge('under_13'));
    expect(lastTransport()).toBeNull();
  });

  it('COPPA-1: an adult keeps a transport once the age is set', async () => {
    await mount({ config: LIVE_CONFIG, repository: fakeRepo(), auth: fakeAuth('uid-1') });
    await act(async () => app.setAge('adult_18_plus'));
    expect(createVoiceCoachMock.mock.calls.at(-1)?.[0].transport).not.toBeNull();
  });

  it('AUTH-4: a persisted age bracket and consents are restored and the age is locked', async () => {
    const localProfile = createLocalProfileStore(createMemoryStorage());
    await localProfile.save({ ageBracket: 'under_13', consents: [CAMERA_CONSENT as never] });
    const repository = fakeRepo();
    await mount({ localProfile, repository, auth: fakeAuth('uid-5') });
    await flush();

    expect(app.hydrated).toBe(true);
    expect(app.ageBracket).toBe('under_13');
    expect(app.ageLocked).toBe(true);
    expect(app.visibility).toBe('private');
    expect(app.hasConsent('camera_skeletal_tracking')).toBe(true);

    await act(async () => app.setAge('adult_18_plus'));
    expect(app.ageBracket).toBe('under_13');
    expect((await localProfile.load()).ageBracket).toBe('under_13');
    // Unsynced local state is re-delivered to the server once a session exists.
    expect(repository.recordConsent).toHaveBeenCalledWith(
      'uid-5',
      expect.objectContaining({ type: 'camera_skeletal_tracking' }),
    );
    expect(repository.saveProfile).toHaveBeenCalledWith(
      'uid-5',
      expect.objectContaining({ ageBracket: 'under_13' }),
    );
  });

  it('first run starts unlocked and persists the bracket and consent locally immediately', async () => {
    const localProfile = await mount({ repository: fakeRepo() });
    await flush();
    expect(app.ageBracket).toBeNull();
    expect(app.ageLocked).toBe(false);
    await act(async () => app.setAge('teen_13_17'));
    await act(async () => app.grantConsent('camera_skeletal_tracking'));
    const stored = await localProfile.load();
    expect(stored.ageBracket).toBe('teen_13_17');
    expect(stored.consents.map((c) => c.type)).toEqual(['camera_skeletal_tracking']);
    expect(stored.onboardedAt).not.toBeNull();
  });

  it('a failing local store never blocks the app', async () => {
    const broken = {
      load: jest.fn(() => Promise.reject(new Error('io'))),
      save: jest.fn(() => Promise.resolve()),
    };
    await mount({ localProfile: broken, repository: fakeRepo() });
    await flush();
    expect(app.hydrated).toBe(true);
    expect(app.ageBracket).toBeNull();
  });

  it('seeded initial state wins over the stored profile', async () => {
    const localProfile = createLocalProfileStore(createMemoryStorage());
    await localProfile.save({ ageBracket: 'under_13', consents: [CAMERA_CONSENT as never] });
    await mount({
      localProfile,
      repository: fakeRepo(),
      initial: { ageBracket: 'adult_18_plus', consents: [] },
    });
    await flush();
    expect(app.ageBracket).toBe('adult_18_plus');
    expect(app.ageLocked).toBe(false);
    expect(app.consents).toEqual([]);
  });
});
