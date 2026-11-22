import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderNavigator, simulateResult } from './helpers';

async function advance(totalMs: number, chunkMs = 1000) {
  for (let t = 0; t < totalMs; t += chunkMs) {
    await act(async () => {
      jest.advanceTimersByTime(chunkMs);
    });
  }
}

describe('navigation end to end', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Onboarding → Combine → OVR → Group → back → Highlight', async () => {
    await renderNavigator();
    await fireEvent.changeText(screen.getByTestId('age-year-input'), '2004');
    await fireEvent.changeText(screen.getByTestId('age-month-input'), '6');
    await fireEvent.press(screen.getByTestId('age-continue'));
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-accept'));
    await fireEvent.press(screen.getByTestId('persona-option-captain'));
    await fireEvent.press(screen.getByTestId('position-option-MID'));
    await fireEvent.press(screen.getByTestId('onboarding-finish'));

    expect(screen.getByTestId('screen-combine')).toBeTruthy();
    expect(screen.queryByTestId('nav-back')).toBeNull(); // onboarding was replaced, combine is root

    await fireEvent.press(screen.getByTestId('drill-option-ball_mastery'));
    await fireEvent.press(screen.getByTestId('simulate-toggle'));
    await fireEvent.press(screen.getByTestId('drill-start'));
    await advance(40000);
    await fireEvent.press(screen.getByTestId('drill-view-results'));

    expect(screen.getByTestId('screen-ovr')).toBeTruthy();
    expect(screen.getByTestId('archetype-0')).toBeTruthy();
    expect(screen.getByTestId('debrief-text')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('ovr-group'));
    expect(screen.getByTestId('screen-group')).toBeTruthy();
    await act(async () => {}); // let repository promises settle
    expect(screen.getByTestId('crown-performance')).toBeTruthy();
    expect(screen.getByTestId('rivalry-objective')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('nav-back'));
    expect(screen.getByTestId('screen-ovr')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('ovr-share'));
    expect(screen.getByTestId('screen-highlight')).toBeTruthy();
    expect(screen.getByTestId('highlight-window')).toBeTruthy();
    expect(screen.getByTestId('ffmpeg-command')).toBeTruthy();
    expect(screen.getByTestId('share-instagram_stories')).toBeTruthy();
    expect(screen.getByTestId('share-tiktok')).toBeTruthy();
  });

  it('Android hardware back pops the stack and yields at the root', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, cb: () => boolean) => {
      handlers.push(cb);
      return { remove: () => undefined };
    }) as never);
    await renderNavigator({ initialRoute: 'OVRCard', seed: [simulateResult('ball_mastery')] });
    const latest = () => handlers[handlers.length - 1]!;
    expect(latest()()).toBe(false); // root: let the OS handle it

    await fireEvent.press(screen.getByTestId('ovr-group'));
    expect(screen.getByTestId('screen-group')).toBeTruthy();
    let handled = false;
    await act(async () => {
      handled = latest()();
    });
    expect(handled).toBe(true);
    expect(screen.getByTestId('screen-ovr')).toBeTruthy();
    spy.mockRestore();
  });
});
