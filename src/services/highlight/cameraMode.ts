export type CameraMode = 'idle' | 'pose' | 'record';
export type MountedCamera = 'none' | 'pose' | 'record';

export interface CameraModeState {
  readonly mode: CameraMode;
  readonly mounted: MountedCamera;
  readonly switching: boolean;
}

export interface CameraModeClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type CameraModeResult =
  | { readonly ok: true; readonly state: CameraModeState }
  | { readonly ok: false; readonly reason: 'superseded' | 'teardown_timeout' };

export interface CameraModeController {
  getState(): CameraModeState;
  subscribe(listener: (state: CameraModeState) => void): () => void;
  request(mode: CameraMode): Promise<CameraModeResult>;
  notifyUnmounted(kind: 'pose' | 'record'): void;
}

export const CAMERA_TEARDOWN_MS = 250;
export const CAMERA_TEARDOWN_TIMEOUT_MS = 1000;

const defaultClock: CameraModeClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const mountedFor = (mode: CameraMode): MountedCamera => (mode === 'idle' ? 'none' : mode);

export function createCameraModeController(opts?: {
  clock?: CameraModeClock;
  teardownMs?: number;
  teardownTimeoutMs?: number;
}): CameraModeController {
  const clock = opts?.clock ?? defaultClock;
  const teardownMs = opts?.teardownMs ?? CAMERA_TEARDOWN_MS;
  const timeoutMs = opts?.teardownTimeoutMs ?? CAMERA_TEARDOWN_TIMEOUT_MS;

  let state: CameraModeState = { mode: 'idle', mounted: 'none', switching: false };
  const listeners = new Set<(s: CameraModeState) => void>();

  let target: CameraMode = 'idle';
  let tearingDown: 'pose' | 'record' | null = null;
  let acked = false;
  let pending: ((r: CameraModeResult) => void) | null = null;
  let timer: unknown = null;

  const emit = (next: CameraModeState): void => {
    state = next;
    for (const l of [...listeners]) {
      try {
        l(state);
      } catch {
        // listener errors never break the machine
      }
    }
  };

  const settle = (r: CameraModeResult): void => {
    const p = pending;
    pending = null;
    p?.(r);
  };

  const finishMount = (): void => {
    timer = null;
    tearingDown = null;
    acked = false;
    emit({ mode: target, mounted: mountedFor(target), switching: false });
    settle({ ok: true, state });
  };

  const onTimeout = (): void => {
    timer = null;
    tearingDown = null;
    acked = false;
    target = 'idle';
    emit({ mode: 'idle', mounted: 'none', switching: false });
    settle({ ok: false, reason: 'teardown_timeout' });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request(mode) {
      return new Promise<CameraModeResult>((resolve) => {
        if (state.switching) {
          // latest wins: replace target and pending, keep the running teardown wait
          settle({ ok: false, reason: 'superseded' });
          target = mode;
          pending = resolve;
          return;
        }
        if (state.mode === mode) {
          resolve({ ok: true, state });
          return;
        }
        target = mode;
        if (state.mounted === 'none') {
          emit({ mode, mounted: mountedFor(mode), switching: false });
          resolve({ ok: true, state });
          return;
        }
        tearingDown = state.mounted;
        acked = false;
        pending = resolve;
        // CON-9: arm the timeout BEFORE emitting, so a subscriber that synchronously calls
        // notifyUnmounted() inside emit() clears this timer instead of having it overwrite finishMount.
        timer = clock.setTimeout(onTimeout, timeoutMs);
        emit({ mode: 'idle', mounted: 'none', switching: true });
      });
    },
    notifyUnmounted(kind) {
      if (!state.switching || tearingDown !== kind || acked) return;
      acked = true;
      clock.clearTimeout(timer);
      timer = clock.setTimeout(finishMount, teardownMs);
    },
  };
}
