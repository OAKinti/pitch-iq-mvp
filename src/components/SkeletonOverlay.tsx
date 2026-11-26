import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Circle, Group, Line, vec } from '@shopify/react-native-skia';
import { projectSkeleton } from '../domain/pose/skeleton';
import type { PoseFrame } from '../types/contracts';
import { borders, colors, sizes } from '../theme/tokens';

export interface SkeletonOverlayProps {
  frame: PoseFrame | null;
  mirrored: boolean;
  minVisibility?: number;
  testID?: string;
}

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
  const skeleton = useMemo(
    () => (frame ? projectSkeleton(frame, size, { mirrored, minVisibility }) : null),
    [frame, size, mirrored, minVisibility],
  );

  return (
    <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {skeleton ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group>
            {skeleton.bones.map((b) => (
              <Line
                key={`b${b.from}-${b.to}`}
                p1={vec(b.x1, b.y1)}
                p2={vec(b.x2, b.y2)}
                color={colors.skeletonBone}
                style="stroke"
                strokeWidth={borders.thick}
              />
            ))}
            {skeleton.joints.map((j) => (
              <Circle key={`j${j.index}`} cx={j.x} cy={j.y} r={sizes.jointDot / 2} color={colors.skeletonJoint} />
            ))}
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
