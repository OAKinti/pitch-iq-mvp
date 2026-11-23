import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { CAMERA_CONSENT, renderNavigator } from './helpers';
import { CONSENT_POLICY_VERSION } from '../../types/contracts';

const isDisabled = (id: string): boolean => Boolean(screen.getByTestId(id).props.accessibilityState?.disabled);

async function advance(totalMs: number, chunkMs = 1000) {
  for (let t = 0; t < totalMs; t += chunkMs) {
    await act(async () => {
      jest.advanceTimersByTime(chunkMs);
    });
  }
}

describe('CombineDrillScreen', () => {
  beforeEach(() => jest.useFakeTimers());
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
    expect(screen.getByTestId('simulate-toggle').props.accessibilityState).toEqual({ checked: false });
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
    expect(screen.queryByTestId('joint-27')).toBeTruthy();
    expect(screen.queryByTestId('joint-5')).toBeNull(); // redacted face landmark never drawn

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
    const view = await renderNavigator({ initialRoute: 'Combine', initial: { consents: [CAMERA_CONSENT] } });
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(1000);
    const clearSpy = jest.spyOn(global, 'clearInterval');
    await view.unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('exposes policy version constant used for consent records', () => {
    expect(CAMERA_CONSENT.policyVersion).toBe(CONSENT_POLICY_VERSION);
  });
});
