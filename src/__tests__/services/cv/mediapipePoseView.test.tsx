import React from 'react';
import { render } from '@testing-library/react-native';
import { act } from '@testing-library/react-native';
import { LANDMARK_COUNT } from '../../../types/contracts';
import { MediapipePoseView } from '../../../services/cv/MediapipePoseView';
import type { PoseSourceProvider } from '../../../services/cv/poseSource';

const mockLib: {
  PoseCameraView?: unknown;
  usePoseCamera?: unknown;
} = {};
let mockViewProps: Record<string, any> | null = null;

jest.mock('expo-mediapipe-pose', () => mockLib);

function provider() {
  return {
    kind: 'mediapipe',
    start: jest.fn(),
    stop: jest.fn(),
    ingest: jest.fn(),
    reportNativeError: jest.fn(),
    stats: jest.fn(() => ({ delivered: 0, dropped: 0 })),
  } as unknown as PoseSourceProvider & {
    ingest: jest.Mock;
    reportNativeError: jest.Mock;
  };
}

function installLib(
  permission: 'unknown' | 'granted' | 'denied',
  askForCamera = jest.fn(() => Promise.resolve()),
) {
  mockViewProps = null;
  mockLib.PoseCameraView = (props: Record<string, unknown>) => {
    mockViewProps = props;
    return null;
  };
  mockLib.usePoseCamera = () => ({ permission, askForCamera });
  return askForCamera;
}

function libFrame() {
  const landmarks: Record<string, unknown> = {};
  const names = [
    'nose',
    'leftEyeInner',
    'leftEye',
    'leftEyeOuter',
    'rightEyeInner',
    'rightEye',
    'rightEyeOuter',
    'leftEar',
    'rightEar',
    'mouthLeft',
    'mouthRight',
    'leftShoulder',
    'rightShoulder',
    'leftElbow',
    'rightElbow',
    'leftWrist',
    'rightWrist',
    'leftPinky',
    'rightPinky',
    'leftIndex',
    'rightIndex',
    'leftThumb',
    'rightThumb',
    'leftHip',
    'rightHip',
    'leftKnee',
    'rightKnee',
    'leftAnkle',
    'rightAnkle',
    'leftHeel',
    'rightHeel',
    'leftFootIndex',
    'rightFootIndex',
  ];
  names.forEach((n) => {
    landmarks[n] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9, presence: 1 };
  });
  return { landmarks, timestampMs: 10, imageWidth: 480, imageHeight: 640 };
}

describe('MediapipePoseView', () => {
  it('renders null when inactive and never touches the camera', async () => {
    installLib('granted');
    const p = provider();
    const r = await render(<MediapipePoseView provider={p} active={false} facing="front" />);
    expect(r.toJSON()).toBeNull();
    expect(mockViewProps).toBeNull();
  });

  it('renders null when the module is unavailable', async () => {
    mockLib.PoseCameraView = undefined;
    mockLib.usePoseCamera = undefined;
    const r = await render(<MediapipePoseView provider={provider()} active facing="front" />);
    expect(r.toJSON()).toBeNull();
  });

  it('requests permission when unknown and mounts nothing yet', async () => {
    const ask = installLib('unknown');
    await render(<MediapipePoseView provider={provider()} active facing="back" />);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(mockViewProps).toBeNull();
  });

  it('reports camera_error when the permission request itself rejects', async () => {
    installLib(
      'unknown',
      jest.fn(() => Promise.reject(new Error('x'))),
    );
    const p = provider();
    await render(<MediapipePoseView provider={p} active facing="back" />);
    await act(async () => {});
    expect(p.reportNativeError).toHaveBeenCalledWith('camera_error');
  });

  it('reports permission_denied when denied', async () => {
    installLib('denied');
    const p = provider();
    await render(<MediapipePoseView provider={p} active facing="front" />);
    expect(p.reportNativeError).toHaveBeenCalledWith('permission_denied');
    expect(mockViewProps).toBeNull();
  });

  it('mounts the pose-only camera with the skeleton hidden and forwards frames and failures', async () => {
    installLib('granted');
    const p = provider();
    await render(<MediapipePoseView provider={p} active facing="back" style={{ flex: 1 }} />);
    expect(mockViewProps).not.toBeNull();
    expect(mockViewProps).toMatchObject({
      cameraFacing: 'back',
      isCameraRunning: true,
      maxPoseCount: 1,
      skeletonRendering: 'hidden',
      style: { flex: 1 },
    });
    mockViewProps!.onPoseFrame(libFrame());
    expect(p.ingest).toHaveBeenCalledTimes(1);
    expect(p.ingest.mock.calls[0][0].landmarks).toHaveLength(LANDMARK_COUNT);
    mockViewProps!.onPoseFrame(null);
    expect(p.ingest).toHaveBeenCalledTimes(1);
    mockViewProps!.onPoseFailure({ reason: 'cameraPermission' });
    mockViewProps!.onPoseFailure({ reason: 'inferenceRuntime' });
    expect(p.reportNativeError.mock.calls.map((c) => c[0])).toEqual([
      'permission_denied',
      'camera_error',
    ]);
  });
});
