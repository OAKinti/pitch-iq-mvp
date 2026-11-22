import { LANDMARK as L, LANDMARK_COUNT, PRIVACY_REDACTED_LANDMARKS } from '../../types/contracts';
import { createMockPoseStream, generateFrames, type MockScenario } from '../../domain/mock/mockPoseGenerator';

const SCENARIOS: MockScenario[] = ['idle', 'ball_mastery', 'agility_shuttle'];

describe('mock pose generator', () => {
  it('is deterministic for the same seed and differs for another', () => {
    for (const scenario of SCENARIOS) {
      const a = generateFrames({ scenario, seed: 5 }, 120);
      const b = generateFrames({ scenario, seed: 5 }, 120);
      const c = generateFrames({ scenario, seed: 6 }, 120);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    }
  });
  it('default seed is stable and reset() replays the stream', () => {
    const s = createMockPoseStream({ scenario: 'ball_mastery' });
    const first = [s.next(), s.next(), s.next()];
    s.reset();
    expect([s.next(), s.next(), s.next()]).toEqual(first);
    expect(first).toEqual(generateFrames({ scenario: 'ball_mastery' }, 3));
    expect(s.fps).toBe(30);
  });
  it('satisfies the PoseFrame contract', () => {
    for (const scenario of SCENARIOS) {
      const frames = generateFrames({ scenario }, 90);
      frames.forEach((f, i) => {
        expect(f.landmarks).toHaveLength(LANDMARK_COUNT);
        expect(f.frameIndex).toBe(i);
        expect(f.timestampMs).toBeCloseTo((i * 1000) / 30, 9);
        expect(f.source).toBe('mock');
        expect(f.imageWidth).toBeGreaterThan(0);
        expect(f.imageHeight).toBeGreaterThan(0);
        for (const idx of PRIVACY_REDACTED_LANDMARKS) {
          expect(f.landmarks[idx]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
        }
        for (const lm of f.landmarks) {
          expect(lm.x).toBeGreaterThanOrEqual(0);
          expect(lm.x).toBeLessThanOrEqual(1);
          expect(lm.y).toBeGreaterThanOrEqual(0);
          expect(lm.y).toBeLessThanOrEqual(1);
        }
      });
    }
  });
  it('uses portrait for drills on the ground and landscape for the shuttle', () => {
    expect(generateFrames({ scenario: 'ball_mastery' }, 1)[0]).toMatchObject({ imageWidth: 720, imageHeight: 1280 });
    expect(generateFrames({ scenario: 'idle' }, 1)[0]).toMatchObject({ imageWidth: 720, imageHeight: 1280 });
    expect(generateFrames({ scenario: 'agility_shuttle' }, 1)[0]).toMatchObject({ imageWidth: 1280, imageHeight: 720 });
  });
  it('honours fps', () => {
    const f = generateFrames({ scenario: 'idle', fps: 60 }, 61);
    expect(f[60]!.timestampMs).toBeCloseTo(1000, 9);
    expect(createMockPoseStream({ scenario: 'idle', fps: 60 }).fps).toBe(60);
  });
  it('skeleton is anatomically plausible (y grows downward)', () => {
    for (const scenario of SCENARIOS) {
      for (const f of generateFrames({ scenario, noise: 0 }, 60)) {
        const y = (i: number): number => f.landmarks[i]!.y;
        expect(y(L.LEFT_SHOULDER)).toBeLessThan(y(L.LEFT_HIP));
        expect(y(L.RIGHT_SHOULDER)).toBeLessThan(y(L.RIGHT_HIP));
        expect(y(L.LEFT_HIP)).toBeLessThan(y(L.LEFT_KNEE));
        expect(y(L.RIGHT_HIP)).toBeLessThan(y(L.RIGHT_KNEE));
        expect(y(L.LEFT_KNEE)).toBeLessThan(y(L.LEFT_ANKLE));
        expect(y(L.RIGHT_KNEE)).toBeLessThan(y(L.RIGHT_ANKLE));
        expect(y(L.LEFT_ANKLE)).toBeLessThan(y(L.LEFT_FOOT_INDEX));
        expect(y(L.RIGHT_ANKLE)).toBeLessThan(y(L.RIGHT_FOOT_INDEX));
        expect(f.landmarks[L.LEFT_HIP]!.x).toBeLessThan(f.landmarks[L.RIGHT_HIP]!.x);
      }
    }
  });
  it('ball mastery lifts alternate feet at the requested rate', () => {
    const frames = generateFrames({ scenario: 'ball_mastery', noise: 0, touchesPerSecond: 2 }, 120);
    const lifted = (i: number, idx: number): boolean => frames[i]!.landmarks[idx]!.y < 0.855;
    // touch 0 (left) peaks at t = 1000 + 0.3 * 500 = 1150 ms; touch 1 (right) at 1650 ms
    expect(lifted(35, L.LEFT_ANKLE)).toBe(true);
    expect(lifted(35, L.RIGHT_ANKLE)).toBe(false);
    expect(lifted(50, L.RIGHT_ANKLE)).toBe(true);
    expect(lifted(50, L.LEFT_ANKLE)).toBe(false);
    expect(lifted(10, L.LEFT_ANKLE)).toBe(false);
  });
  it('shuttle runs the configured legs between two end positions then stands still', () => {
    const frames = generateFrames({ scenario: 'agility_shuttle', noise: 0, legs: 2, legDurationMs: 1000 }, 150);
    const cx = (i: number): number => frames[i]!.landmarks[L.LEFT_HIP]!.x;
    expect(cx(0)).toBeCloseTo(cx(29), 6); // stationary before the delay
    expect(cx(60)).toBeGreaterThan(0.8); // far end after leg 1 (t = 2000 ms)
    expect(cx(89)).toBeLessThan(0.2); // back at start after leg 2 (t = 3000 ms)
    expect(cx(149)).toBeCloseTo(cx(100), 6); // stands still afterwards
  });
  it('out-of-frame window drops visibility to 0.1 on [start, end)', () => {
    const frames = generateFrames({ scenario: 'ball_mastery', outOfFrameWindowMs: [1000, 2000] }, 90);
    expect(frames[29]!.landmarks[L.LEFT_HIP]!.visibility).toBe(0.99);
    expect(frames[30]!.landmarks[L.LEFT_HIP]!.visibility).toBe(0.1);
    expect(frames[59]!.landmarks[L.LEFT_HIP]!.visibility).toBe(0.1);
    expect(frames[60]!.landmarks[L.LEFT_HIP]!.visibility).toBe(0.99);
    expect(frames[30]!.landmarks[3]!.visibility).toBe(0);
  });
  it('noise scales the jitter and zero noise is exact', () => {
    const spread = (noise: number): number => {
      const xs = generateFrames({ scenario: 'idle', noise }, 200).map((f) => f.landmarks[L.LEFT_ANKLE]!.y);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(spread(0)).toBeLessThan(1e-12);
    expect(spread(0.01)).toBeGreaterThan(spread(0.002) * 2);
    expect(spread(0.004)).toBeGreaterThan(0.002);
    expect(spread(0.004)).toBeLessThan(0.006);
  });
});
