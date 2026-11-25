import React from 'react';
import { Linking, Share } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DemoRepository, DEMO_INVITE_CODE } from '../../services/supabase/repository';
import { useAppState, type AppState } from '../../state/AppStateContext';
import { AppNavigator } from '../../navigation/AppNavigator';
import { CAMERA_CONSENT, renderApp, renderNavigator } from './helpers';

let app: AppState;
function Capture() {
  app = useAppState();
  return null;
}

type UrlCb = (e: { url: string }) => void;
let urlListener: UrlCb | null = null;
const removeListener = jest.fn();
let initialUrl: string | null = null;

const emit = (url: string) =>
  act(async () => {
    urlListener?.({ url });
  });
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const adult = { ageBracket: 'adult_18_plus' as const, consents: [CAMERA_CONSENT] };
const JOIN_URL = `pitchiq://join/${DEMO_INVITE_CODE}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  urlListener = null;
  removeListener.mockClear();
  initialUrl = null;
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(async () => initialUrl);
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_t: string, cb: UrlCb) => {
    urlListener = cb;
    return { remove: removeListener };
  }) as unknown as typeof Linking.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

describe('squad invite links', () => {
  it('INV-2 a link opened before onboarding is held, then joined once onboarded', async () => {
    const repo = new DemoRepository();
    const spy = jest.spyOn(repo, 'joinGroupByInvite');
    initialUrl = JOIN_URL;
    await renderApp(
      <>
        <Capture />
        <AppNavigator />
      </>,
      { repository: repo },
    );
    await flush();
    expect(app.pendingInvite).toBe(DEMO_INVITE_CODE);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
    await act(async () => app.setAge('adult_18_plus'));
    await act(async () => app.grantConsent('camera_skeletal_tracking'));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(app.pendingInvite).toBeNull();
    expect(screen.getByTestId('screen-group')).toBeTruthy();
    expect(screen.getByTestId('group-join-notice')).toHaveTextContent('You joined the squad.');
  });

  it('INV-2 a link while running routes to the Group screen after joining', async () => {
    const repo = new DemoRepository();
    const spy = jest.spyOn(repo, 'joinGroupByInvite');
    await renderNavigator({ initialRoute: 'Combine', initial: adult, repository: repo });
    await emit(JOIN_URL);
    await flush();
    expect(spy).toHaveBeenCalledWith(DEMO_INVITE_CODE);
    expect(screen.getByTestId('screen-group')).toBeTruthy();
  });

  it('INV-1 non-invite urls are ignored', async () => {
    const repo = new DemoRepository();
    const spy = jest.spyOn(repo, 'joinGroupByInvite');
    await renderNavigator({ initialRoute: 'Combine', initial: adult, repository: repo });
    await emit('https://evil.example/join/ABCDEFGHJK');
    await emit('pitchiq://join/BADCODE');
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('screen-combine')).toBeTruthy();
  });

  it('INV-3 an invalid invite shows a notice and never throws into render', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: adult });
    await emit('pitchiq://join/ZZZZZZZZZZ');
    await flush();
    expect(screen.getByTestId('group-join-notice')).toHaveTextContent(/invalid, expired or full/);
  });

  it('INV-3 a rejecting repository yields the offline notice', async () => {
    const repo = new DemoRepository();
    jest.spyOn(repo, 'joinGroupByInvite').mockRejectedValue(new Error('boom'));
    await renderNavigator({ initialRoute: 'Combine', initial: adult, repository: repo });
    await emit(JOIN_URL);
    await flush();
    expect(screen.getByTestId('group-join-notice')).toHaveTextContent(/Could not reach the server/);
  });

  it('INV-3 under-13 gets the parent-verification notice', async () => {
    const repo = new DemoRepository();
    jest
      .spyOn(repo, 'joinGroupByInvite')
      .mockResolvedValue({ ok: false, reason: 'parental_consent_required' });
    await renderNavigator({
      initialRoute: 'Combine',
      initial: { ageBracket: 'under_13', consents: [CAMERA_CONSENT] },
      repository: repo,
    });
    await emit(JOIN_URL);
    await flush();
    expect(screen.getByTestId('group-join-notice')).toHaveTextContent(
      'A parent needs to verify your account before you can join a squad.',
    );
  });

  it('creates an invite and opens the OS share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderNavigator({ initialRoute: 'GroupSession', initial: adult });
    await fireEvent.press(screen.getByTestId('group-invite-create'));
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(share.mock.calls[0])).toContain(JOIN_URL);
  });

  it('shows an error when the invite cannot be shared', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('x'));
    await renderNavigator({ initialRoute: 'GroupSession', initial: adult });
    await fireEvent.press(screen.getByTestId('group-invite-create'));
    await flush();
    expect(screen.getByTestId('group-invite-error')).toBeTruthy();
  });

  it('INV-4 under-13 cannot create invites', async () => {
    await renderNavigator({
      initialRoute: 'GroupSession',
      initial: { ageBracket: 'under_13', consents: [CAMERA_CONSENT] },
    });
    expect(screen.queryByTestId('group-invite-create')).toBeNull();
  });

  it('INV-5 the url listener is removed on unmount', async () => {
    const view = await renderNavigator({ initialRoute: 'Combine', initial: adult });
    expect(urlListener).not.toBeNull();
    await view.unmount();
    expect(removeListener).toHaveBeenCalled();
  });

  it('INV-5 one join per received url', async () => {
    const repo = new DemoRepository();
    const spy = jest.spyOn(repo, 'joinGroupByInvite');
    await renderNavigator({ initialRoute: 'Combine', initial: adult, repository: repo });
    await emit(JOIN_URL);
    await flush();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
