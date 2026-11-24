import { SKELETON_BONES, projectSkeleton } from '../../domain/pose/skeleton';
import type { Landmark, PoseFrame } from '../../types/contracts';

function frame(over: Partial<PoseFrame> = {}, fill: Partial<Landmark> = {}): PoseFrame {
  return {
    timestampMs: 0,
    frameIndex: 0,
    landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1, ...fill })),
    imageWidth: 100,
    imageHeight: 200,
    source: 'mock',
    ...over,
  };
}

describe('SKELETON_BONES', () => {
  it('only references joints 11-32', () => {
    for (const [a, b] of SKELETON_BONES) {
      expect(a).toBeGreaterThanOrEqual(11);
      expect(b).toBeLessThanOrEqual(32);
    }
  });
});

describe('projectSkeleton', () => {
  it('never projects indices 0-10 even from an unsanitized frame', () => {
    const out = projectSkeleton(frame(), { width: 100, height: 200 });
    expect(out.joints).toHaveLength(22);
    expect(out.joints.every((j) => j.index >= 11)).toBe(true);
    expect(out.bones.every((b) => b.from >= 11 && b.to >= 11)).toBe(true);
    expect(out.bones).toHaveLength(SKELETON_BONES.length);
  });

  it('cover-fits a portrait image into a wider view (crops vertically)', () => {
    const f = frame();
    const lm = [...f.landmarks];
    lm[11] = { x: 0, y: 0, z: 0, visibility: 1 };
    lm[12] = { x: 1, y: 1, z: 0, visibility: 1 };
    // image 100x200, view 200x200 -> s=2, ox=0, oy=(200-400)/2=-100
    const out = projectSkeleton({ ...f, landmarks: lm }, { width: 200, height: 200 });
    expect(out.joints.find((j) => j.index === 11)).toMatchObject({ x: 0, y: -100 });
    expect(out.joints.find((j) => j.index === 12)).toMatchObject({ x: 200, y: 300 });
  });

  it('cover-fits a landscape image into a taller view (crops horizontally)', () => {
    const f = frame({ imageWidth: 200, imageHeight: 100 });
    const lm = [...f.landmarks];
    lm[11] = { x: 0, y: 0, z: 0, visibility: 1 };
    lm[12] = { x: 1, y: 1, z: 0, visibility: 1 };
    // view 100x100 -> s=1, ox=(100-200)/2=-50, oy=0
    const out = projectSkeleton({ ...f, landmarks: lm }, { width: 100, height: 100 });
    expect(out.joints.find((j) => j.index === 11)).toMatchObject({ x: -50, y: 0 });
    expect(out.joints.find((j) => j.index === 12)).toMatchObject({ x: 150, y: 100 });
  });

  it('mirrors x', () => {
    const f = frame();
    const lm = [...f.landmarks];
    lm[11] = { x: 0.25, y: 0.5, z: 0, visibility: 1 };
    const view = { width: 100, height: 200 };
    const plain = projectSkeleton({ ...f, landmarks: lm }, view).joints.find((j) => j.index === 11);
    const mir = projectSkeleton({ ...f, landmarks: lm }, view, { mirrored: true }).joints.find((j) => j.index === 11);
    expect(plain?.x).toBeCloseTo(25);
    expect(mir?.x).toBeCloseTo(75);
    expect(mir?.y).toBeCloseTo(plain?.y ?? NaN);
  });

  it('filters by visibility and drops bones with a hidden end', () => {
    const f = frame();
    const lm = [...f.landmarks];
    lm[13] = { x: 0.5, y: 0.5, z: 0, visibility: 0.2 };
    const out = projectSkeleton({ ...f, landmarks: lm }, { width: 100, height: 200 });
    expect(out.joints.some((j) => j.index === 13)).toBe(false);
    expect(out.bones.some((b) => b.from === 13 || b.to === 13)).toBe(false);
    const lenient = projectSkeleton({ ...f, landmarks: lm }, { width: 100, height: 200 }, { minVisibility: 0.1 });
    expect(lenient.joints.some((j) => j.index === 13)).toBe(true);
  });

  it('returns an empty skeleton for a zero view or image', () => {
    expect(projectSkeleton(frame(), { width: 0, height: 100 })).toEqual({ joints: [], bones: [] });
    expect(projectSkeleton(frame(), { width: 100, height: -1 })).toEqual({ joints: [], bones: [] });
    expect(projectSkeleton(frame({ imageWidth: 0 }), { width: 100, height: 100 }).joints).toHaveLength(0);
    expect(projectSkeleton(frame({ imageHeight: 0 }), { width: 100, height: 100 }).joints).toHaveLength(0);
  });
});
