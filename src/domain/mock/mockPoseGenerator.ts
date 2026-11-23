import {
  LANDMARK as L,
  LANDMARK_COUNT,
  PRIVACY_REDACTED_LANDMARKS,
  TARGET_FPS,
  type Landmark,
  type PoseFrame,
} from '../../types/contracts';

export type MockScenario = 'idle' | 'ball_mastery' | 'agility_shuttle';

export interface MockPoseOptions {
  scenario: MockScenario;
  seed?: number;
  fps?: number;
  startDelayMs?: number;
  noise?: number;
  /** ball_mastery, default 2.5 (alternating L/R). */
  touchesPerSecond?: number;
  /** agility_shuttle, defaults 6 and 1600. */
  legs?: number;
  legDurationMs?: number;
  /** Visibility drops to 0.1 inside [start, end). */
  outOfFrameWindowMs?: readonly [number, number];
}

export interface MockPoseStream {
  next(): PoseFrame;
  reset(): void;
  readonly fps: number;
}

/** Small, fast, seedable PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller (one value per call). */
function gaussian(rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const PORTRAIT = { w: 720, h: 1280 } as const;
const LANDSCAPE = { w: 1280, h: 720 } as const;

/** Resting skeleton heights (image-height units, y grows downward). */
const Y = {
  nose: 0.2,
  shoulder: 0.32,
  elbow: 0.44,
  wrist: 0.55,
  hip: 0.55,
  knee: 0.7,
  ankle: 0.86,
  heel: 0.87,
  toe: 0.895,
} as const;

/** Half-widths in image-height units. */
const HALF = { shoulder: 0.08, elbow: 0.1, wrist: 0.1, hip: 0.05, knee: 0.05, ankle: 0.05, toe: 0.06 } as const;

/** Amplitude of a ball-mastery foot lift in leg lengths. */
const LIFT_LEG_FRACTION = 0.15;
const LEG_LENGTH = Y.ankle - Y.hip;
/** Fraction of the touch interval a foot spends in the air. */
const PULSE_WIDTH = 0.6;
/** Shuttle end positions (normalised x): ~2.4 body-heights apart in the landscape frame. */
const SHUTTLE_X = [0.12, 0.88] as const;

interface Pose {
  /** Horizontal centre in normalised x. */
  cx: number;
  /** Vertical lift of the left/right foot (image-height units, positive = up). */
  liftL: number;
  liftR: number;
}

function buildLandmarks(
  pose: Pose,
  dims: { w: number; h: number },
  visibility: number,
  noise: number,
  rng: () => number,
): Landmark[] {
  const aspect = dims.w / dims.h;
  const redacted: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
  const lms: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) lms.push(redacted);

  const put = (index: number, side: -1 | 1, halfWidth: number, y: number): void => {
    // side -1 = subject's left (image left), +1 = right; centre-line landmarks use halfWidth 0.
    const nx = noise * gaussian(rng);
    const ny = noise * gaussian(rng);
    lms[index] = {
      x: clamp01(pose.cx + (side * halfWidth) / aspect + nx),
      y: clamp01(y + ny),
      z: 0,
      visibility,
    };
  };

  put(L.NOSE, -1, 0, Y.nose);
  put(L.LEFT_SHOULDER, -1, HALF.shoulder, Y.shoulder);
  put(L.RIGHT_SHOULDER, 1, HALF.shoulder, Y.shoulder);
  put(L.LEFT_ELBOW, -1, HALF.elbow, Y.elbow);
  put(L.RIGHT_ELBOW, 1, HALF.elbow, Y.elbow);
  put(L.LEFT_WRIST, -1, HALF.wrist, Y.wrist);
  put(L.RIGHT_WRIST, 1, HALF.wrist, Y.wrist);
  put(L.LEFT_PINKY, -1, HALF.wrist, Y.wrist + 0.01);
  put(L.RIGHT_PINKY, 1, HALF.wrist, Y.wrist + 0.01);
  put(L.LEFT_INDEX, -1, HALF.wrist, Y.wrist + 0.015);
  put(L.RIGHT_INDEX, 1, HALF.wrist, Y.wrist + 0.015);
  put(L.LEFT_THUMB, -1, HALF.wrist, Y.wrist + 0.01);
  put(L.RIGHT_THUMB, 1, HALF.wrist, Y.wrist + 0.01);
  put(L.LEFT_HIP, -1, HALF.hip, Y.hip);
  put(L.RIGHT_HIP, 1, HALF.hip, Y.hip);
  put(L.LEFT_KNEE, -1, HALF.knee, Y.knee - pose.liftL * 0.5);
  put(L.RIGHT_KNEE, 1, HALF.knee, Y.knee - pose.liftR * 0.5);
  put(L.LEFT_ANKLE, -1, HALF.ankle, Y.ankle - pose.liftL);
  put(L.RIGHT_ANKLE, 1, HALF.ankle, Y.ankle - pose.liftR);
  put(L.LEFT_HEEL, -1, HALF.ankle, Y.heel - pose.liftL);
  put(L.RIGHT_HEEL, 1, HALF.ankle, Y.heel - pose.liftR);
  put(L.LEFT_FOOT_INDEX, -1, HALF.toe, Y.toe - pose.liftL);
  put(L.RIGHT_FOOT_INDEX, 1, HALF.toe, Y.toe - pose.liftR);

  // Face keypoints stay redacted regardless of generator state.
  for (const i of PRIVACY_REDACTED_LANDMARKS) lms[i] = redacted;
  return lms;
}

/** Ball-mastery lifts: touch k starts at startDelay + k * interval; even k = left foot, odd k = right. */
function ballMasteryPose(
  tMs: number,
  startDelayMs: number,
  touchesPerSecond: number,
): Pick<Pose, 'liftL' | 'liftR'> {
  const intervalMs = 1000 / touchesPerSecond;
  const sinceStart = tMs - startDelayMs;
  const k = Math.floor(sinceStart / intervalMs);
  const phase = (sinceStart - k * intervalMs) / (PULSE_WIDTH * intervalMs);
  const lift =
    sinceStart >= 0 && phase < 1 ? LIFT_LEG_FRACTION * LEG_LENGTH * Math.sin(Math.PI * phase) : 0;
  const leftTurn = k % 2 === 0;
  return { liftL: leftTurn ? lift : 0, liftR: leftTurn ? 0 : lift };
}

/** Shuttle x position: cosine-eased legs between the two end positions, then standing still. */
function shuttleX(tMs: number, startDelayMs: number, legs: number, legDurationMs: number): number {
  const sinceStart = Math.min(Math.max(tMs - startDelayMs, 0), legs * legDurationMs);
  const leg = Math.min(Math.floor(sinceStart / legDurationMs), legs - 1);
  const u = (sinceStart - leg * legDurationMs) / legDurationMs;
  const from = SHUTTLE_X[leg % 2]!;
  const to = SHUTTLE_X[(leg + 1) % 2]!;
  return from + (to - from) * ((1 - Math.cos(Math.PI * u)) / 2);
}

export function createMockPoseStream(options: MockPoseOptions): MockPoseStream {
  const {
    scenario,
    seed = 42,
    fps = TARGET_FPS,
    startDelayMs = 1000,
    noise = 0.004,
    touchesPerSecond = 2.5,
    legs = 6,
    legDurationMs = 1600,
    outOfFrameWindowMs,
  } = options;

  let rng = mulberry32(seed);
  let frameIndex = 0;
  const dims = scenario === 'agility_shuttle' ? LANDSCAPE : PORTRAIT;

  return {
    fps,
    next(): PoseFrame {
      const timestampMs = (frameIndex * 1000) / fps;
      let pose: Pose;
      if (scenario === 'agility_shuttle') {
        pose = { cx: shuttleX(timestampMs, startDelayMs, legs, legDurationMs), liftL: 0, liftR: 0 };
      } else {
        // Small lateral hip sway (0.5 Hz) keeps the base realistic.
        const sway = (0.008 * Math.sin(2 * Math.PI * 0.5 * (timestampMs / 1000))) / (dims.w / dims.h);
        const lifts =
          scenario === 'ball_mastery'
            ? ballMasteryPose(timestampMs, startDelayMs, touchesPerSecond)
            : { liftL: 0, liftR: 0 };
        pose = { cx: 0.5 + sway, ...lifts };
      }
      const outOfFrame =
        outOfFrameWindowMs !== undefined &&
        timestampMs >= outOfFrameWindowMs[0] &&
        timestampMs < outOfFrameWindowMs[1];
      const frame: PoseFrame = {
        timestampMs,
        frameIndex,
        landmarks: buildLandmarks(pose, dims, outOfFrame ? 0.1 : 0.99, noise, rng),
        imageWidth: dims.w,
        imageHeight: dims.h,
        source: 'mock',
      };
      frameIndex += 1;
      return frame;
    },
    reset(): void {
      rng = mulberry32(seed);
      frameIndex = 0;
    },
  };
}

export function generateFrames(options: MockPoseOptions, count: number): PoseFrame[] {
  const stream = createMockPoseStream(options);
  return Array.from({ length: count }, () => stream.next());
}
