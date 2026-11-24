import {
  createMockPoseStream,
  type MockPoseOptions,
  type MockScenario,
} from '../../domain/mock/mockPoseGenerator';
import { sanitizePoseFrame, type PoseFrame, type PoseSource } from '../../types/contracts';
import { toPoseFrame, type RawPoseResult } from './poseFrame';

export type PoseSourceError = 'permission_denied' | 'camera_error' | 'stalled';
export interface PoseSourceStats {
  readonly delivered: number;
  readonly dropped: number;
}

export interface PoseSourceProvider {
  readonly kind: PoseSource;
  start(onFrame: (frame: PoseFrame) => void, onError: (error: PoseSourceError) => void): void;
  stop(): void;
  /** mediapipe: map + forward; mock: no-op. */
  ingest(raw: RawPoseResult): void;
  reportNativeError(error: 'permission_denied' | 'camera_error'): void;
  stats(): PoseSourceStats;
}

export const POSE_STALL_MS = 1500;
const STALL_CHECK_MS = 250;

export interface PoseClock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

export type PoseSourceUnavailableReason =
  'consent_missing' | 'parent_locked' | 'native_unavailable';

const defaultClock: PoseClock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

interface Session {
  readonly onFrame: (frame: PoseFrame) => void;
  readonly onError: (error: PoseSourceError) => void;
  frameIndex: number;
  lastTs: number;
  lastDeliveredAt: number;
  stalled: boolean;
  handle: unknown;
}

/** Shared lifecycle: one active session, no callbacks after stop, native-error handling, stats. */
function createHub(clock: PoseClock) {
  let session: Session | null = null;
  let delivered = 0;
  let dropped = 0;

  function safe<A>(fn: (a: A) => void, arg: A): void {
    try {
      fn(arg);
    } catch {
      // A consumer error must never take down the provider.
    }
  }

  function halt(): void {
    const s = session;
    session = null;
    if (s && s.handle !== undefined) clock.clearInterval(s.handle);
  }

  return {
    /** Starts a fresh session (stopping any previous one) and its interval. */
    begin(
      onFrame: Session['onFrame'],
      onError: Session['onError'],
      periodMs: number,
      tick: (s: Session) => void,
    ): void {
      halt();
      delivered = 0;
      dropped = 0;
      const s: Session = {
        onFrame,
        onError,
        frameIndex: 0,
        lastTs: -Infinity,
        lastDeliveredAt: clock.now(),
        stalled: false,
        handle: undefined,
      };
      session = s;
      s.handle = clock.setInterval(() => {
        if (session === s) tick(s);
      }, periodMs);
    },
    /** Deliver a frame if its timestamp is strictly increasing. Returns false when dropped. */
    deliver(frame: PoseFrame): boolean {
      const s = session;
      if (!s) return false;
      if (!(frame.timestampMs > s.lastTs)) {
        dropped += 1;
        return false;
      }
      s.lastTs = frame.timestampMs;
      s.lastDeliveredAt = clock.now();
      s.stalled = false;
      s.frameIndex = frame.frameIndex + 1;
      delivered += 1;
      safe(s.onFrame, frame);
      return true;
    },
    drop(): void {
      dropped += 1;
    },
    current(): Session | null {
      return session;
    },
    stop: halt,
    fail(error: 'permission_denied' | 'camera_error'): void {
      const s = session;
      if (!s) return;
      halt();
      safe(s.onError, error);
    },
    stall(s: Session): void {
      if (s.stalled || clock.now() - s.lastDeliveredAt < POSE_STALL_MS) return;
      s.stalled = true;
      safe(s.onError, 'stalled');
    },
    stats(): PoseSourceStats {
      return { delivered, dropped };
    },
  };
}

export function createMockPoseSource(
  opts: MockPoseOptions,
  clock: PoseClock = defaultClock,
): PoseSourceProvider {
  const hub = createHub(clock);
  return {
    kind: 'mock',
    start(onFrame, onError) {
      const stream = createMockPoseStream(opts);
      hub.begin(onFrame, onError, 1000 / stream.fps, () => {
        hub.deliver(sanitizePoseFrame(stream.next()));
      });
    },
    stop: hub.stop,
    ingest() {
      // mock frames come from the internal stream
    },
    reportNativeError: hub.fail,
    stats: hub.stats,
  };
}

export function createMediapipePoseSource(clock: PoseClock = defaultClock): PoseSourceProvider {
  const hub = createHub(clock);
  return {
    kind: 'mediapipe',
    start(onFrame, onError) {
      hub.begin(onFrame, onError, STALL_CHECK_MS, hub.stall);
    },
    stop: hub.stop,
    ingest(raw) {
      const s = hub.current();
      if (!s) return;
      const frame = toPoseFrame(raw, s.frameIndex);
      if (!frame) {
        hub.drop();
        return;
      }
      hub.deliver(frame);
    },
    reportNativeError: hub.fail,
    stats: hub.stats,
  };
}

export function selectPoseSource(opts: {
  simulate: boolean;
  consentGranted: boolean;
  liveAllowed: boolean;
  nativeAvailable: boolean;
  scenario: MockScenario;
  seed?: number;
  clock?: PoseClock;
}):
  { ok: true; provider: PoseSourceProvider } | { ok: false; reason: PoseSourceUnavailableReason } {
  if (!opts.consentGranted) return { ok: false, reason: 'consent_missing' };
  if (opts.simulate) {
    const mockOpts: MockPoseOptions =
      opts.seed === undefined
        ? { scenario: opts.scenario }
        : { scenario: opts.scenario, seed: opts.seed };
    return { ok: true, provider: createMockPoseSource(mockOpts, opts.clock) };
  }
  if (!opts.liveAllowed) return { ok: false, reason: 'parent_locked' };
  if (!opts.nativeAvailable) return { ok: false, reason: 'native_unavailable' };
  return { ok: true, provider: createMediapipePoseSource(opts.clock) };
}
