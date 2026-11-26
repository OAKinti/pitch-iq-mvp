import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SkeletonOverlay } from '../../components/SkeletonOverlay';
import { SkeletonOverlay as SkeletonOverlayWeb } from '../../components/SkeletonOverlay.web';
import type { PoseFrame } from '../../types/contracts';

const frame: PoseFrame = {
  timestampMs: 0,
  frameIndex: 0,
  landmarks: Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + i * 0.02, y: 0.5, z: 0, visibility: 1 })),
  imageWidth: 100,
  imageHeight: 100,
  source: 'mock',
};
const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 200 } } };

describe('SkeletonOverlay', () => {
  it('draws at most 22 joints', async () => {
    const r = await render(<SkeletonOverlay frame={frame} mirrored={false} />);
    await fireEvent(r.getByTestId('skeleton-overlay'), 'layout', layout);
    const circles = r.getAllByLabelText('skia-Circle');
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.length).toBeLessThanOrEqual(22);
    expect(r.getAllByLabelText('skia-Line').length).toBeGreaterThan(0);
  });

  it('null frame renders the root only', async () => {
    const r = await render(<SkeletonOverlay frame={null} mirrored testID="x" />);
    expect(r.getByTestId('x')).toBeTruthy();
    expect(r.queryByLabelText('skia-Canvas')).toBeNull();
  });

  it('ignores identical repeated layouts', async () => {
    const r = await render(<SkeletonOverlay frame={frame} mirrored minVisibility={0.1} />);
    await fireEvent(r.getByTestId('skeleton-overlay'), 'layout', layout);
    await fireEvent(r.getByTestId('skeleton-overlay'), 'layout', layout);
    expect(r.getAllByLabelText('skia-Circle').length).toBeLessThanOrEqual(22);
  });
});

describe('SkeletonOverlay.web', () => {
  it('renders View dots only', async () => {
    const r = await render(<SkeletonOverlayWeb frame={frame} mirrored={false} />);
    await fireEvent(r.getByTestId('skeleton-overlay'), 'layout', layout);
    await fireEvent(r.getByTestId('skeleton-overlay'), 'layout', layout);
    expect(r.queryByLabelText('skia-Canvas')).toBeNull();
    expect(r.getByTestId('skeleton-overlay').children.length).toBeLessThanOrEqual(22);
    expect(r.getByTestId('skeleton-overlay').children.length).toBeGreaterThan(0);
  });
  it('null frame renders empty root', async () => {
    const r = await render(<SkeletonOverlayWeb frame={null} mirrored />);
    expect(r.getByTestId('skeleton-overlay').children).toHaveLength(0);
  });
});
