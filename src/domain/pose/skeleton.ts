import type { PoseFrame } from '../../types/contracts';

/** MediaPipe POSE_CONNECTIONS restricted to body joints 11-32 (face 0-10 never drawn; SEC-2). */
export const SKELETON_BONES: readonly (readonly [number, number])[] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

const FIRST_BODY_JOINT = 11;
const DEFAULT_MIN_VISIBILITY = 0.5;

export interface ProjectedJoint {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}
export interface ProjectedBone {
  readonly from: number;
  readonly to: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}
export interface ProjectedSkeleton {
  readonly joints: readonly ProjectedJoint[];
  readonly bones: readonly ProjectedBone[];
}

const EMPTY: ProjectedSkeleton = { joints: [], bones: [] };

/**
 * Projects normalized landmarks into view pixels using cover fit (the camera preview crops
 * to fill). Only joints 11-32 with visibility >= minVisibility are emitted. Pure.
 */
export function projectSkeleton(
  frame: PoseFrame,
  view: { width: number; height: number },
  opts: { minVisibility?: number; mirrored?: boolean } = {},
): ProjectedSkeleton {
  const { width: vw, height: vh } = view;
  const iw = frame.imageWidth;
  const ih = frame.imageHeight;
  if (!(vw > 0) || !(vh > 0) || !(iw > 0) || !(ih > 0)) return EMPTY;
  const minVis = opts.minVisibility ?? DEFAULT_MIN_VISIBILITY;
  const mirrored = opts.mirrored ?? false;

  const s = Math.max(vw / iw, vh / ih);
  const ox = (vw - iw * s) / 2;
  const oy = (vh - ih * s) / 2;

  const byIndex = new Map<number, ProjectedJoint>();
  frame.landmarks.forEach((lm, index) => {
    // `!(v >= min)` fails closed: NaN visibility on an unsanitized frame is never projected (SEC-2).
    if (index < FIRST_BODY_JOINT || !(lm.visibility >= minVis)) return;
    byIndex.set(index, {
      index,
      x: (mirrored ? 1 - lm.x : lm.x) * iw * s + ox,
      y: lm.y * ih * s + oy,
    });
  });

  const bones: ProjectedBone[] = [];
  for (const [from, to] of SKELETON_BONES) {
    const a = byIndex.get(from);
    const b = byIndex.get(to);
    if (a && b) bones.push({ from, to, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return { joints: [...byIndex.values()], bones };
}
