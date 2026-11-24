/**
 * The ONLY .ts file that references the pose library (SEC-3). It is required
 * lazily inside try/catch so Expo Go, Jest and web never crash (FAIL-1).
 * Pose landmarker only: no face, hand or segmentation outputs are used.
 */
import type * as PoseLib from 'expo-mediapipe-pose';
import type { RawPoseResult } from './poseFrame';

export type MediapipeModule = Pick<typeof PoseLib, 'PoseCameraView' | 'usePoseCamera'>;
export type LibPoseFrame = PoseLib.PoseFrame;

/** The 33 MediaPipe joints in MediaPipe order (matches the library's named landmarks). */
const JOINT_ORDER = [
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
] as const;

export function getMediapipeModule(): MediapipeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-mediapipe-pose') as Partial<MediapipeModule> | null | undefined;
    if (
      mod &&
      typeof mod.PoseCameraView === 'function' &&
      typeof mod.usePoseCamera === 'function'
    ) {
      return mod as MediapipeModule;
    }
    return null;
  } catch {
    return null;
  }
}

export function isMediapipeAvailable(): boolean {
  return getMediapipeModule() !== null;
}

/** Map the library frame (named joints, null = missing) to a RawPoseResult. Null if unreadable. */
export function toRawPoseResult(frame: LibPoseFrame | null | undefined): RawPoseResult | null {
  if (!frame || !frame.landmarks) return null;
  const landmarks = JOINT_ORDER.map((name) => {
    const p = frame.landmarks[name];
    return p
      ? { x: p.x, y: p.y, z: p.z, visibility: p.visibility }
      : { x: 0, y: 0, z: 0, visibility: 0 };
  });
  return {
    landmarks,
    timestampMs: frame.timestampMs,
    imageWidth: frame.imageWidth,
    imageHeight: frame.imageHeight,
  };
}

/** Map a library failure reason to the provider's native error. */
export function mapFailureReason(reason: string): 'permission_denied' | 'camera_error' {
  return reason === 'cameraPermission' ? 'permission_denied' : 'camera_error';
}
