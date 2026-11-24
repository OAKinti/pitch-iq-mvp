import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { PoseSourceProvider } from '../../services/cv';
import type { CuePlayer } from '../../services/audio';
import { CAMERA_CONSENT, renderNavigator } from './helpers';
import { CONSENT_POLICY_VERSION } from '../../types/contracts';

const mockProviders: PoseSourceProvider[] = [];
jest.mock('../../services/cv/poseSource', () => {
  const actual = jest.requireActual('../../services/cv/poseSource');
  return {
    ...actual,
    selectPoseSource: (o: unknown) => {
      const r = actual.selectPoseSource(o);
      if (r.ok) mockProviders.push(r.provider);
      return r;
    },
  };
});
jest.mock('../../services/cv/MediapipePoseView', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const ReactLib = jest.requireActual('react');
  return {
    MediapipePoseView: () => ReactLib.createElement(MockView, { testID: 'mediapipe-view-stub' }),
  };
});

function fakeCuePlayer(): jest.Mocked<CuePlayer> {
  return {
    prepare: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockReturnValue(false),
    stopAll: jest.fn(),
    reassertAudioMode: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  };
}

const isDisabled = (id: string): boolean =>
  Boolean(screen.getByTestId(id).props.accessibilityState?.disabled);

async function advance(totalMs: number, chunkMs = 1000) {
  for (let t = 0; t < totalMs; t += chunkMs) {
    await act(async () => {
      jest.advanceTimersByTime(chunkMs);
    });
  }
}

describe('CombineDrillScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockProviders.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it('refuses to start without camera_skeletal_tracking consent', async () => {
    await renderNavigator({ initialRoute: 'Combine' });
    expect(isDisabled('drill-start')).toBe(true);
    expect(screen.getByTestId('consent-notice')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('IDLE');
  });

  it('simulate OFF shows the Dev Client notice instead of starting', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    expect(screen.getByTestId('simulate-toggle').props.accessibilityState).toEqual({
      checked: false,
    });
    await fireEvent.press(screen.getByTestId('drill-start'));
    expect(screen.getByTestId('drill-notice')).toHaveTextContent(/Dev Client build/);
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('IDLE');
  });

  it('keeps live camera locked for under-13 until a parent verifies', async () => {
    await renderNavigator({
      initialRoute: 'Combine',
      initial: { ageBracket: 'under_13', consents: [CAMERA_CONSENT] },
    });
    await fireEvent.press(screen.getByTestId('drill-start'));
    expect(screen.getByTestId('drill-notice')).toHaveTextContent(/parent verifies/);
  });

  it('runs a full simulated ball mastery drill to results', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    await fireEvent.press(screen.getByTestId('drill-option-ball_mastery'));
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));

    await advance(3000);
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');
    expect(screen.getByTestId('cue-caption')).not.toHaveTextContent('Awaiting cue');
    expect(screen.getByTestId('skeleton-overlay')).toBeTruthy();
    await fireEvent(screen.getByTestId('skeleton-overlay'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 240, x: 0, y: 0 } },
    });
    const circles = screen.getAllByLabelText('skia-Circle').length; // face landmarks are redacted
    expect(circles).toBeGreaterThanOrEqual(1);
    expect(circles).toBeLessThanOrEqual(22);

    await advance(12000);
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('ACTIVE');
    const live = Number(screen.getByTestId('telemetry-count').props.children);
    expect(live).toBeGreaterThan(0);
    expect(screen.getByTestId('telemetry-timer')).not.toHaveTextContent('00:00.0');

    await advance(24000);
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('COMPLETE');
    expect(screen.getByTestId('drill-view-results')).toBeTruthy();
    expect(Number(screen.getByTestId('telemetry-count').props.children)).toBeGreaterThan(live);

    await fireEvent.press(screen.getByTestId('drill-view-results'));
    expect(screen.getByTestId('screen-ovr')).toBeTruthy();
    expect(screen.getByTestId('ovr-value')).toBeTruthy();
  });

  it('runs the agility shuttle with legs and m/s readouts', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    await fireEvent.press(screen.getByTestId('drill-option-agility_shuttle'));
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    expect(isDisabled('drill-start')).toBe(true);
    await advance(40000);
    expect(screen.getByTestId('drill-view-results')).toBeTruthy();
    expect(screen.getByText('M/S', { exact: false })).toBeTruthy();
    expect(Number(screen.getByTestId('telemetry-count').props.children)).toBeGreaterThan(0);
  });

  it('stops the timer loop on unmount', async () => {
    const view = await renderNavigator({
      initialRoute: 'Combine',
      initial: { consents: [CAMERA_CONSENT] },
    });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(1000);
    const clearSpy = jest.spyOn(global, 'clearInterval');
    await view.unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('shows telemetry-fps and pose-source MOCK, mounting no MediapipePoseView for mock source', async () => {
    const player = fakeCuePlayer();
    await renderNavigator({
      initialRoute: 'Combine',
      initial: { consents: [CAMERA_CONSENT] },
      cuePlayer: player,
    });
    expect(screen.getByTestId('pose-source')).not.toHaveTextContent('MOCK');
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(3000);
    expect(screen.getByTestId('pose-source')).toHaveTextContent('MOCK');
    expect(Number(screen.getByTestId('telemetry-fps').props.children)).toBeGreaterThan(0);
    expect(screen.queryByTestId('mediapipe-view-stub')).toBeNull();
    expect(player.play).toHaveBeenCalled();
    expect(screen.getByTestId('cue-caption')).not.toHaveTextContent('Awaiting cue');
  });

  it('shows notice on permission_denied', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(1000);
    await act(async () => {
      mockProviders[mockProviders.length - 1]!.reportNativeError('permission_denied');
    });
    expect(screen.getByTestId('drill-notice')).toHaveTextContent(/permission/i);
    expect(isDisabled('drill-start')).toBe(false); // stopped, no mock substitution
    const phase = screen.getByTestId('telemetry-phase').props.children;
    await advance(2000);
    expect(screen.getByTestId('telemetry-phase').props.children).toBe(phase);
  });

  it('background resets an active drill and stops cues', async () => {
    let handler: ((s: string) => void) | undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      h: (s: string) => void,
    ) => {
      handler = h;
      return { remove };
    }) as never);
    const player = fakeCuePlayer();
    await renderNavigator({
      initialRoute: 'Combine',
      initial: { consents: [CAMERA_CONSENT] },
      cuePlayer: player,
    });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(3000);
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');

    await act(async () => handler?.('background'));
    expect(player.stopAll).toHaveBeenCalled();
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('drill-notice')).toHaveTextContent(/cancelled/i);
    expect(isDisabled('drill-start')).toBe(false);
    await advance(2000);
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('IDLE'); // never resumed

    await act(async () => handler?.('active'));
    expect(player.reassertAudioMode).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("REC-2: iOS 'inactive' (permission prompt, banner) does not cancel an active drill", async () => {
    let handler: ((s: string) => void) | undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      h: (s: string) => void,
    ) => {
      handler = h;
      return { remove: jest.fn() };
    }) as never);
    const player = fakeCuePlayer();
    await renderNavigator({
      initialRoute: 'Combine',
      initial: { consents: [CAMERA_CONSENT] },
      cuePlayer: player,
    });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(3000);
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');

    await act(async () => handler?.('inactive'));
    expect(player.stopAll).not.toHaveBeenCalled();
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');
    expect(screen.queryByTestId('drill-notice')).toBeNull();
    await act(async () => handler?.('active'));
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');
    spy.mockRestore();
  });

  it('toggling simulate resets the runner', async () => {
    await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(3000);
    expect(screen.getByTestId('telemetry-phase')).not.toHaveTextContent('IDLE');
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    expect(screen.getByTestId('telemetry-phase')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('pose-source')).not.toHaveTextContent('MOCK');
    expect(isDisabled('drill-start')).toBe(false);
  });

  it('exposes policy version constant used for consent records', () => {
    expect(CAMERA_CONSENT.policyVersion).toBe(CONSENT_POLICY_VERSION);
  });
});
