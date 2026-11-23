import type { Landmark, PoseFrame } from '../../types/contracts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function landmarkAt(frame: PoseFrame, index: number): Landmark {
  return frame.landmarks[index]!;
}

/** Image-height units: X = x · width / height, Y = y (aspect-correct for any orientation). */
export function toImageHeightUnits(frame: PoseFrame, index: number): Point {
  const l = landmarkAt(frame, index);
  return { x: (l.x * frame.imageWidth) / frame.imageHeight, y: l.y };
}

export function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function meanVisibility(frame: PoseFrame, indices: readonly number[]): number {
  let sum = 0;
  for (const i of indices) sum += landmarkAt(frame, i).visibility;
  return sum / indices.length;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Population standard deviation. */
export function std(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

/** Coefficient of variation (population); 0 when the mean is 0. */
export function cv(values: readonly number[]): number {
  const m = mean(values);
  return m === 0 ? 0 : std(values) / m;
}
