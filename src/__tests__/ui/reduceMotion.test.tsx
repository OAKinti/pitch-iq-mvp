import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import * as Reanimated from 'react-native-reanimated';
import { HudButton, HudToggle, StatBar } from '../../components';

jest.mock('react-native-reanimated', () => {
  const base = require('react-native-reanimated/mock');
  const mock = {
    ...base,
    useReducedMotion: jest.fn(),
    withTiming: jest.fn((v: unknown) => v),
    withSpring: jest.fn((v: unknown) => v),
  };
  return { __esModule: true, ...mock, default: base.default ?? base };
});

const reduced = Reanimated.useReducedMotion as unknown as jest.Mock;
const withTiming = Reanimated.withTiming as unknown as jest.Mock;
const withSpring = Reanimated.withSpring as unknown as jest.Mock;

const wrap = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={initialWindowMetrics}>{ui}</SafeAreaProvider>);

beforeEach(() => {
  withTiming.mockClear();
  withSpring.mockClear();
});

describe('reduce motion (A11Y-2)', () => {
  describe('enabled', () => {
    beforeEach(() => reduced.mockReturnValue(true));

    it('HudButton never springs on press but still fires onPress', async () => {
      const onPress = jest.fn();
      await wrap(<HudButton testID="b" label="Go" onPress={onPress} />);
      await fireEvent(screen.getByTestId('b'), 'pressIn');
      await fireEvent(screen.getByTestId('b'), 'pressOut');
      await fireEvent.press(screen.getByTestId('b'));
      expect(withSpring).not.toHaveBeenCalled();
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('HudToggle sets its value without withTiming, including after a change', async () => {
      const { rerender } = await wrap(<HudToggle testID="t" label="Opt" value={false} onChange={() => undefined} />);
      await rerender(
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <HudToggle testID="t" label="Opt" value onChange={() => undefined} />
        </SafeAreaProvider>,
      );
      expect(withTiming).not.toHaveBeenCalled();
      expect(screen.getByTestId('t').props.accessibilityState.checked).toBe(true);
    });

    it('StatBar sets its fill without withTiming', async () => {
      await wrap(<StatBar testID="s" label="PAC" value={72} />);
      expect(withTiming).not.toHaveBeenCalled();
      expect(screen.getByText('72')).toBeTruthy();
    });
  });

  describe('disabled', () => {
    beforeEach(() => reduced.mockReturnValue(false));

    it('HudButton springs in and out', async () => {
      await wrap(<HudButton testID="b" label="Go" onPress={() => undefined} />);
      await fireEvent(screen.getByTestId('b'), 'pressIn');
      expect(withSpring).toHaveBeenCalledTimes(1);
      await fireEvent(screen.getByTestId('b'), 'pressOut');
      expect(withSpring).toHaveBeenCalledTimes(2);
    });

    it('HudToggle animates with withTiming', async () => {
      await wrap(<HudToggle testID="t" label="Opt" value onChange={() => undefined} />);
      expect(withTiming).toHaveBeenCalled();
    });

    it('StatBar animates with withTiming', async () => {
      await wrap(<StatBar testID="s" label="PAC" value={72} />);
      expect(withTiming).toHaveBeenCalledWith(72, expect.anything());
    });
  });
});
