import {
  LANDMARK_COUNT,
  sanitizePoseFrame,
  type Landmark,
  type PoseFrame,
} from '../../types/contracts';

/** Library-neutral pose result produced by mediapipeBinding (normalized [0,1], MediaPipe order). */
export interface RawPoseResult {
  readonly landmarks: ReadonlyArray<{ x: number; y: number; z: number; visibility?: number }>;
  readonly timestampMs: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Convert a raw native result to a sanitized PoseFrame (source 'mediapipe').
 * Returns null for malformed input (wrong landmark count, non-finite values,
 * non-positive image size) so the caller can count it as dropped.
 */
export function toPoseFrame(raw: RawPoseResult, frameIndex: number): PoseFrame | null {
  if (!raw || !Array.isArray(raw.landmarks) || raw.landmarks.length !== LANDMARK_COUNT) return null;
  if (!Number.isFinite(raw.timestampMs)) return null;
  if (!(raw.imageWidth > 0) || !(raw.imageHeight > 0)) return null;
  if (!Number.isFinite(raw.imageWidth) || !Number.isFinite(raw.imageHeight)) return null;

  const landmarks: Landmark[] = [];
  for (const lm of raw.landmarks) {
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y) || !Number.isFinite(lm.z)) {
      return null;
    }
    const vis =
      typeof lm.visibility === 'number' && Number.isFinite(lm.visibility) ? lm.visibility : 0;
    landmarks.push({ x: clamp01(lm.x), y: clamp01(lm.y), z: lm.z, visibility: clamp01(vis) });
  }

  return sanitizePoseFrame({
    timestampMs: raw.timestampMs,
    frameIndex,
    landmarks,
    imageWidth: raw.imageWidth,
    imageHeight: raw.imageHeight,
    source: 'mediapipe',
  });
}
