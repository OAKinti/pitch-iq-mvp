import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { HudButton, HudToggle, OptionChip, ScreenFrame, StatBar, TelemetryReadout } from '../../components';

const wrap = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={initialWindowMetrics}>{ui}</SafeAreaProvider>);

describe('HUD primitives', () => {
  it('HudButton fires onPress and is disabled when asked', async () => {
    const onPress = jest.fn();
    const { rerender } = await wrap(<HudButton testID="go" label="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('go'));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <HudButton testID="go" label="Go" onPress={onPress} disabled />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByTestId('go'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('HudToggle reports the next value and exposes switch state', async () => {
    const onChange = jest.fn();
    await wrap(<HudToggle testID="sim" label="Simulate" value={false} onChange={onChange} />);
    const toggle = screen.getByTestId('sim');
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('OptionChip, TelemetryReadout, StatBar and ScreenFrame render with testIDs', async () => {
    await wrap(
      <ScreenFrame testID="screen" kicker="Live" title="Combine">
        <OptionChip testID="chip" label="MID" selected onPress={() => {}} />
        <TelemetryReadout testID="rate" label="Rate" value="142" unit="/min" />
        <StatBar testID="bar" label="PAC" value={87.4} />
      </ScreenFrame>,
    );
    expect(screen.getByTestId('screen')).toBeTruthy();
    expect(screen.getByTestId('chip').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('rate')).toHaveTextContent('142');
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
  });
});
