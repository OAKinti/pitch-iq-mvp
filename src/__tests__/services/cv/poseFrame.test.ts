import { LANDMARK_COUNT, PRIVACY_REDACTED_LANDMARKS } from '../../../types/contracts';
import { toPoseFrame, type RawPoseResult } from '../../../services/cv/poseFrame';

function makeRaw(over: Partial<RawPoseResult> = {}): RawPoseResult {
  return {
    landmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
      x: 0.2 + i * 0.01,
      y: 0.3 + i * 0.01,
      z: -0.1,
      visibility: 0.9,
    })),
    timestampMs: 1000,
    imageWidth: 480,
    imageHeight: 640,
    ...over,
  };
}

describe('toPoseFrame', () => {
  it('maps a valid result to a mediapipe PoseFrame', () => {
    const f = toPoseFrame(makeRaw(), 7);
    expect(f).not.toBeNull();
    expect(f!.source).toBe('mediapipe');
    expect(f!.frameIndex).toBe(7);
    expect(f!.timestampMs).toBe(1000);
    expect(f!.landmarks).toHaveLength(LANDMARK_COUNT);
    expect(f!.landmarks[11]).toEqual({ x: 0.31, y: 0.41, z: -0.1, visibility: 0.9 });
    expect(f!.imageWidth).toBe(480);
  });

  it('redacts landmarks 1-10 on every emitted frame', () => {
    const f = toPoseFrame(makeRaw(), 0)!;
    for (const i of PRIVACY_REDACTED_LANDMARKS) {
      expect(f.landmarks[i]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
    }
    expect(f.landmarks[0]!.visibility).toBe(0.9); // nose kept
    expect(f.landmarks[11]!.visibility).toBe(0.9);
  });

  it('clamps x, y and visibility to [0,1] and fails closed on missing visibility', () => {
    const raw = makeRaw();
    const lms = raw.landmarks.map((l) => ({ ...l }));
    lms[12] = { x: -0.5, y: 1.7, z: 3, visibility: 2 };
    lms[13] = { x: 0.5, y: 0.5, z: 0.1 };
    lms[14] = { x: 0.5, y: 0.5, z: 0.1, visibility: -1 };
    lms[15] = { x: 0.5, y: 0.5, z: 0.1, visibility: Number.NaN };
    const f = toPoseFrame({ ...raw, landmarks: lms }, 0)!;
    expect(f.landmarks[12]).toEqual({ x: 0, y: 1, z: 3, visibility: 1 });
    expect(f.landmarks[13]!.visibility).toBe(0);
    expect(f.landmarks[14]!.visibility).toBe(0);
    expect(f.landmarks[15]!.visibility).toBe(0);
  });

  it('returns null for a wrong landmark count', () => {
    const raw = makeRaw();
    expect(toPoseFrame({ ...raw, landmarks: raw.landmarks.slice(0, 32) }, 0)).toBeNull();
    expect(toPoseFrame({ ...raw, landmarks: [...raw.landmarks, raw.landmarks[0]!] }, 0)).toBeNull();
  });

  it('returns null for non-finite values', () => {
    for (const key of ['x', 'y', 'z'] as const) {
      const lms = makeRaw().landmarks.map((l) => ({ ...l }));
      lms[20] = { ...lms[20]!, [key]: Number.NaN };
      expect(toPoseFrame({ ...makeRaw(), landmarks: lms }, 0)).toBeNull();
    }
    const inf = makeRaw().landmarks.map((l) => ({ ...l }));
    inf[3] = { ...inf[3]!, x: Infinity };
    expect(toPoseFrame({ ...makeRaw(), landmarks: inf }, 0)).toBeNull();
    expect(toPoseFrame(makeRaw({ timestampMs: Number.NaN }), 0)).toBeNull();
    expect(toPoseFrame(makeRaw({ timestampMs: Infinity }), 0)).toBeNull();
  });

  it('returns null for non-positive or non-finite image size', () => {
    expect(toPoseFrame(makeRaw({ imageWidth: 0 }), 0)).toBeNull();
    expect(toPoseFrame(makeRaw({ imageHeight: -5 }), 0)).toBeNull();
    expect(toPoseFrame(makeRaw({ imageWidth: Number.NaN }), 0)).toBeNull();
    expect(toPoseFrame(makeRaw({ imageWidth: Infinity }), 0)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(toPoseFrame(null as unknown as RawPoseResult, 0)).toBeNull();
    expect(toPoseFrame({ ...makeRaw(), landmarks: 'x' as never }, 0)).toBeNull();
    const lms = makeRaw().landmarks.slice();
    lms[4] = null as never;
    expect(toPoseFrame({ ...makeRaw(), landmarks: lms }, 0)).toBeNull();
  });
});
