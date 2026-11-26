import React, { useCallback, useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  getMediapipeModule,
  mapFailureReason,
  toRawPoseResult,
  type LibPoseFrame,
  type MediapipeModule,
} from './mediapipeBinding';
import type { PoseSourceProvider } from './poseSource';

export interface MediapipePoseViewProps {
  provider: PoseSourceProvider;
  active: boolean;
  facing: 'front' | 'back';
  style?: StyleProp<ViewStyle>;
}

interface LiveProps extends MediapipePoseViewProps {
  lib: MediapipeModule;
}

function LiveCamera({ lib, provider, facing, style }: LiveProps): React.ReactElement | null {
  const camera = lib.usePoseCamera({
    isCameraRunning: true,
    cameraFacing: facing,
    poseModel: 'full',
    maxPoseCount: 1,
    poseFrameRate: 30,
    skeletonRendering: 'hidden',
  });
  const { permission, askForCamera } = camera;

  useEffect(() => {
    if (permission === 'unknown') {
      askForCamera().catch(() => provider.reportNativeError('camera_error'));
    } else if (permission === 'denied') {
      provider.reportNativeError('permission_denied');
    }
  }, [permission, askForCamera, provider]);

  const onPoseFrame = useCallback(
    (frame: LibPoseFrame) => {
      const raw = toRawPoseResult(frame);
      if (raw) provider.ingest(raw);
    },
    [provider],
  );
  const onPoseFailure = useCallback(
    (failure: { reason: string }) => provider.reportNativeError(mapFailureReason(failure.reason)),
    [provider],
  );

  if (permission !== 'granted') return null;
  const View = lib.PoseCameraView;
  return (
    <View
      style={style}
      isCameraRunning
      cameraFacing={facing}
      poseModel="full"
      maxPoseCount={1}
      poseFrameRate={30}
      skeletonRendering="hidden"
      onPoseFrame={onPoseFrame}
      onPoseFailure={onPoseFailure}
    />
  );
}

/** The only component that mounts the library camera. Renders null when inactive or unavailable. */
export function MediapipePoseView(props: MediapipePoseViewProps): React.ReactElement | null {
  if (!props.active) return null;
  const lib = getMediapipeModule();
  if (!lib) return null;
  return <LiveCamera {...props} lib={lib} />;
}
