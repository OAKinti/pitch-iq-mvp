import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { projectSkeleton } from '../domain/pose/skeleton';
import type { PoseFrame } from '../types/contracts';
import { colors, radii, sizes } from '../theme/tokens';

export interface SkeletonOverlayProps {
  frame: PoseFrame | null;
  mirrored: boolean;
  minVisibility?: number;
  testID?: string;
}

/** Web fallback: Skia breaks web export, so joints are plain View dots (no bones). */
export function SkeletonOverlay({
  frame,
  mirrored,
  minVisibility,
  testID = 'skeleton-overlay',
}: SkeletonOverlayProps): React.ReactElement {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };
  const joints = useMemo(
    () => (frame ? projectSkeleton(frame, size, { mirrored, minVisibility }).joints : []),
    [frame, size, mirrored, minVisibility],
  );
  const r = sizes.jointDot / 2;
  return (
    <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {joints.map((j) => (
        <View
          key={j.index}
          style={{
            position: 'absolute',
            left: j.x - r,
            top: j.y - r,
            width: sizes.jointDot,
            height: sizes.jointDot,
            borderRadius: radii.pill,
            backgroundColor: colors.skeletonJoint,
          }}
        />
      ))}
    </View>
  );
}
