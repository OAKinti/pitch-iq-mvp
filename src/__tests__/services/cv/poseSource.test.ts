import {
  LANDMARK_COUNT,
  PRIVACY_REDACTED_LANDMARKS,
  type PoseFrame,
} from '../../../types/contracts';
import {
  POSE_STALL_MS,
  createMediapipePoseSource,
  createMockPoseSource,
  selectPoseSource,
  type PoseClock,
  type PoseSourceError,
  type PoseSourceProvider,
} from '../../../services/cv/poseSource';
import type { RawPoseResult } from '../../../services/cv/poseFrame';

interface FakeClock extends PoseClock {
  advance(ms: number): void;
  active(): number;
}

function fakeClock(): FakeClock {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number; due: number }>();
  return {
    now: () => t,
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms, due: t + ms });
      return id;
    },
    clearInterval(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next: { id: number; due: number } | null = null;
        for (const [id, tm] of timers)
          if (tm.due <= end && (!next || tm.due < next.due)) next = { id, due: tm.due };
        if (!next) break;
        const tm = timers.get(next.id)!;
        t = tm.due;
        tm.due += tm.ms;
        tm.fn();
      }
      t = end;
    },
    active: () => timers.size,
  };
}

function raw(ts: number, over: Partial<RawPoseResult> = {}): RawPoseResult {
  return {
    landmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
      x: 0.5,
      y: 0.4 + i * 0.01,
      z: 0,
      visibility: 0.95,
    })),
    timestampMs: ts,
    imageWidth: 480,
    imageHeight: 640,
    ...over,
  };
}

function collect(p: PoseSourceProvider) {
  const frames: PoseFrame[] = [];
  const errors: PoseSourceError[] = [];
  p.start(
    (f) => frames.push(f),
    (e) => errors.push(e),
  );
  return { frames, errors };
}

describe('mock provider', () => {
  it('mock provider frames are sanitized', () => {
    const clock = fakeClock();
    const p = createMockPoseSource({ scenario: 'ball_mastery', seed: 1, fps: 30 }, clock);
    const { frames } = collect(p);
    clock.advance(1000);
    expect(frames.length).toBeGreaterThanOrEqual(29);
    for (const f of frames) {
      expect(f.source).toBe('mock');
      for (const i of PRIVACY_REDACTED_LANDMARKS) {
        expect(f.landmarks[i]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
      }
    }
  });

  it('has strictly increasing timestamps and frameIndex from 0, restarting on start()', () => {
    const clock = fakeClock();
    const p = createMockPoseSource({ scenario: 'idle' }, clock);
    const a = collect(p);
    clock.advance(500);
    expect(a.frames[0]!.frameIndex).toBe(0);
    a.frames.forEach((f, i) => {
      expect(f.frameIndex).toBe(i);
      if (i > 0) expect(f.timestampMs).toBeGreaterThan(a.frames[i - 1]!.timestampMs);
    });
    const countA = a.frames.length;
    const b = collect(p); // start while running -> previous session stopped
    expect(clock.active()).toBe(1);
    clock.advance(200);
    expect(a.frames.length).toBe(countA);
    expect(b.frames[0]!.frameIndex).toBe(0);
    expect(p.stats().delivered).toBe(b.frames.length);
  });

  it('stop() silences callbacks and clears the timer; ingest is a no-op', () => {
    const clock = fakeClock();
    const p = createMockPoseSource({ scenario: 'idle' }, clock);
    const { frames } = collect(p);
    clock.advance(100);
    p.stop();
    const n = frames.length;
    p.ingest(raw(1));
    clock.advance(1000);
    expect(frames.length).toBe(n);
    expect(clock.active()).toBe(0);
    expect(p.kind).toBe('mock');
    p.stop(); // idempotent
  });

  it('reports a native error once and stops', () => {
    const clock = fakeClock();
    const p = createMockPoseSource({ scenario: 'idle' }, clock);
    const { errors, frames } = collect(p);
    p.reportNativeError('camera_error');
    p.reportNativeError('camera_error');
    clock.advance(500);
    expect(errors).toEqual(['camera_error']);
    expect(frames).toHaveLength(0);
  });

  it('uses the default clock when none is injected', () => {
    jest.useFakeTimers();
    try {
      const p = createMockPoseSource({ scenario: 'idle', fps: 10 });
      const { frames } = collect(p);
      jest.advanceTimersByTime(350);
      expect(frames.length).toBe(3);
      p.stop();
      jest.advanceTimersByTime(500);
      expect(frames.length).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('survives a throwing consumer', () => {
    const clock = fakeClock();
    const p = createMockPoseSource({ scenario: 'idle' }, clock);
    p.start(
      () => {
        throw new Error('boom');
      },
      () => undefined,
    );
    expect(() => clock.advance(100)).not.toThrow();
    expect(p.stats().delivered).toBeGreaterThan(0);
  });
});

describe('mediapipe provider', () => {
  it('maps, redacts and forwards ingested results with frameIndex from 0', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const { frames } = collect(p);
    p.ingest(raw(100));
    p.ingest(raw(133));
    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    expect(frames[0]!.source).toBe('mediapipe');
    expect(frames[0]!.landmarks[5]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
    expect(p.stats()).toEqual({ delivered: 2, dropped: 0 });
  });

  it('drops malformed results and non-increasing timestamps (FAIL-3, FAIL-4)', () => {
    const p = createMediapipePoseSource(fakeClock());
    const { frames } = collect(p);
    p.ingest(raw(100));
    p.ingest(raw(100)); // equal
    p.ingest(raw(90)); // earlier
    p.ingest(raw(200, { imageWidth: 0 }));
    p.ingest(raw(300, { landmarks: [] }));
    p.ingest(raw(400));
    expect(frames.map((f) => f.timestampMs)).toEqual([100, 400]);
    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    expect(p.stats()).toEqual({ delivered: 2, dropped: 4 });
  });

  it('ignores ingest before start and after stop', () => {
    const p = createMediapipePoseSource(fakeClock());
    p.ingest(raw(1));
    const { frames } = collect(p);
    p.stop();
    p.ingest(raw(2));
    expect(frames).toHaveLength(0);
    expect(p.stats()).toEqual({ delivered: 0, dropped: 0 });
    p.reportNativeError('permission_denied'); // not running: no-op
  });

  it('start after stop begins a new stream and old callbacks never fire (REC-3)', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const a = collect(p);
    p.ingest(raw(100));
    p.stop();
    const b = collect(p);
    p.ingest(raw(50)); // timestamps reset with the new session
    expect(a.frames).toHaveLength(1);
    expect(b.frames.map((f) => f.frameIndex)).toEqual([0]);
    expect(p.stats().delivered).toBe(1);
  });

  it('start while running replaces the session (CON-1)', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const a = collect(p);
    const b = collect(p);
    expect(clock.active()).toBe(1);
    p.ingest(raw(10));
    expect(a.frames).toHaveLength(0);
    expect(b.frames).toHaveLength(1);
  });

  it('native errors fire once, stop the provider and never substitute frames (FAIL-5)', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const { frames, errors } = collect(p);
    p.reportNativeError('permission_denied');
    p.reportNativeError('camera_error');
    p.ingest(raw(10));
    clock.advance(5000);
    expect(errors).toEqual(['permission_denied']);
    expect(frames).toHaveLength(0);
    expect(clock.active()).toBe(0);
  });

  it('flags a stall once per stall and clears it on the next frame (REC-1)', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const { frames, errors } = collect(p);
    p.ingest(raw(100));
    clock.advance(POSE_STALL_MS - 300);
    expect(errors).toEqual([]);
    clock.advance(600);
    expect(errors).toEqual(['stalled']);
    clock.advance(5000);
    expect(errors).toEqual(['stalled']); // once per stall
    p.ingest(raw(200)); // clears
    clock.advance(500);
    expect(errors).toEqual(['stalled']);
    clock.advance(POSE_STALL_MS);
    expect(errors).toEqual(['stalled', 'stalled']);
    expect(frames).toHaveLength(2); // engine not reset: still running
    p.ingest(raw(300));
    expect(frames).toHaveLength(3);
  });

  it('does not report a stall after stop()', () => {
    const clock = fakeClock();
    const p = createMediapipePoseSource(clock);
    const { errors } = collect(p);
    p.stop();
    clock.advance(10_000);
    expect(errors).toEqual([]);
  });

  it('uses the global clock by default', () => {
    jest.useFakeTimers();
    try {
      const p = createMediapipePoseSource();
      const { errors } = collect(p);
      jest.advanceTimersByTime(POSE_STALL_MS + 500);
      expect(errors).toEqual(['stalled']);
      p.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('selectPoseSource gate order', () => {
  const base = {
    simulate: false,
    consentGranted: true,
    liveAllowed: true,
    nativeAvailable: true,
    scenario: 'ball_mastery' as const,
  };

  it('consent first, even when simulating', () => {
    expect(selectPoseSource({ ...base, consentGranted: false, simulate: true })).toEqual({
      ok: false,
      reason: 'consent_missing',
    });
    expect(selectPoseSource({ ...base, consentGranted: false, liveAllowed: false })).toEqual({
      ok: false,
      reason: 'consent_missing',
    });
  });

  it('simulate yields a mock provider regardless of lock or native availability', () => {
    const r = selectPoseSource({
      ...base,
      simulate: true,
      liveAllowed: false,
      nativeAvailable: false,
      seed: 5,
    });
    expect(r.ok && r.provider.kind).toBe('mock');
    const r2 = selectPoseSource({ ...base, simulate: true, clock: fakeClock() });
    expect(r2.ok && r2.provider.kind).toBe('mock');
  });

  it('parent lock precedes native availability', () => {
    expect(selectPoseSource({ ...base, liveAllowed: false, nativeAvailable: false })).toEqual({
      ok: false,
      reason: 'parent_locked',
    });
  });

  it('never substitutes mock for a live drill (FAIL-2)', () => {
    expect(selectPoseSource({ ...base, nativeAvailable: false })).toEqual({
      ok: false,
      reason: 'native_unavailable',
    });
  });

  it('returns the mediapipe provider when everything is allowed', () => {
    const r = selectPoseSource({ ...base });
    expect(r.ok && r.provider.kind).toBe('mediapipe');
  });
});
