import React, { createRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { OvrSticker } from '../../components/OvrSticker';
import { STICKER_SPEC } from '../../services/share/shareTargets';
import { colors } from '../../theme/tokens';
import type { Badge, OvrResult } from '../../types/contracts';

const OVR: OvrResult = {
  sport: 'soccer',
  position: 'MID',
  ovr: 78.46,
  band: 'standard',
  attributes: {
    pace: 71.4,
    agility: 80.5,
    ballControl: 66.2,
    balance: 90,
    rhythm: 59.5,
    endurance: 77.7,
  },
};

const badge = (id: Badge['id'], label: string): Badge => ({ id, label, description: label });
const BADGES: Badge[] = [
  badge('metronome', 'Metronome'),
  badge('quick_feet', 'Quick Feet'),
  badge('engine', 'Engine'),
  badge('burst', 'Burst'),
];

describe('OvrSticker', () => {
  it('root is transparent, 4:3, non-collapsable, without elevation or shadow', async () => {
    await render(<OvrSticker ovr={OVR} badges={[]} />);
    const root = screen.getByTestId('ovr-sticker');
    const style = StyleSheet.flatten(root.props.style) as Record<string, unknown>;
    expect(style.backgroundColor).toBe(colors.transparent);
    expect(style.aspectRatio).toBeCloseTo(STICKER_SPEC.width / STICKER_SPEC.height, 6);
    expect(style.aspectRatio).toBeCloseTo(4 / 3, 6);
    expect(style.maxWidth).toBe(STICKER_SPEC.width);
    expect(root.props.collapsable).toBe(false);
    expect(Object.keys(style).filter((k) => k === 'elevation' || k.startsWith('shadow'))).toEqual(
      [],
    );
  });

  it('renders value, band, position, six attributes, at most 3 badges and the brand', async () => {
    await render(<OvrSticker ovr={OVR} badges={BADGES} />);
    expect(screen.getByTestId('ovr-sticker-value')).toHaveTextContent('78.5');
    expect(screen.getByTestId('ovr-sticker-band')).toHaveTextContent(/standard/i);
    expect(screen.getByTestId('ovr-sticker-position')).toHaveTextContent('MID');
    for (const label of ['PAC', 'AGI', 'CTL', 'BAL', 'RHY', 'END']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.getByText('71')).toBeOnTheScreen();
    expect(screen.getByText('PITCHIQ')).toBeOnTheScreen();
    expect(screen.getByText('Metronome')).toBeOnTheScreen();
    expect(screen.getByText('Quick Feet')).toBeOnTheScreen();
    expect(screen.getByText('Engine')).toBeOnTheScreen();
    expect(screen.queryByText('Burst')).toBeNull();
  });

  it('forwards the ref to the root view and honours a custom testID', async () => {
    const ref = createRef<React.ComponentRef<typeof View>>();
    await render(<OvrSticker ref={ref} ovr={OVR} badges={[]} testID="custom-sticker" />);
    expect(ref.current).not.toBeNull();
    expect(screen.getByTestId('custom-sticker')).toBeOnTheScreen();
  });
});
