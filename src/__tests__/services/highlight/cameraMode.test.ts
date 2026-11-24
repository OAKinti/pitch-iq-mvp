import {
  CAMERA_TEARDOWN_MS,
  CAMERA_TEARDOWN_TIMEOUT_MS,
  createCameraModeController,
  type CameraMode,
  type CameraModeClock,
  type CameraModeState,
} from '../../../services/highlight/cameraMode';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: CameraModeClock = {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
  };
  return {
    clock,
    now: () => now,
    pending: () => timers.size,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let best: [number, { at: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
        if (!best) break;
        timers.delete(best[0]);
        now = best[1].at;
        best[1].fn();
      }
      now = end;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('cameraMode', () => {
  it('starts idle with nothing mounted and mounts immediately from none', async () => {
    const c = createCameraModeController({ clock: fakeClock().clock });
    expect(c.getState()).toEqual({ mode: 'idle', mounted: 'none', switching: false });
    expect(await c.request('idle')).toEqual({ ok: true, state: c.getState() });
    const r = await c.request('pose');
    expect(r.ok).toBe(true);
    expect(c.getState()).toEqual({ mode: 'pose', mounted: 'pose', switching: false });
    expect((await c.request('pose')).ok).toBe(true);
  });

  it('switches pose to record through none, an unmount ack and the teardown delay', async () => {
    const f = fakeClock();
    const c = createCameraModeController({ clock: f.clock });
    const seen: CameraModeState[] = [];
    const unsub = c.subscribe((s) => seen.push(s));
    await c.request('pose');
    const p = c.request('record');
    expect(c.getState()).toEqual({ mode: 'idle', mounted: 'none', switching: true });
    c.notifyUnmounted('record'); // wrong kind ignored
    f.advance(CAMERA_TEARDOWN_MS + 10);
    expect(c.getState().switching).toBe(true);
    c.notifyUnmounted('pose');
    c.notifyUnmounted('pose'); // duplicate ignored
    f.advance(CAMERA_TEARDOWN_MS - 1);
    expect(c.getState().switching).toBe(true);
    f.advance(1);
    const r = await p;
    expect(r).toEqual({ ok: true, state: { mode: 'record', mounted: 'record', switching: false } });
    unsub();
    expect(seen.map((s) => s.mounted)).toEqual(['pose', 'none', 'record']);
  });

  it('record to idle also tears down and ignores ack when not switching', async () => {
    const f = fakeClock();
    const c = createCameraModeController({ clock: f.clock });
    c.notifyUnmounted('pose');
    await c.request('record');
    const p = c.request('idle');
    c.notifyUnmounted('record');
    f.advance(CAMERA_TEARDOWN_MS);
    expect((await p).ok).toBe(true);
    expect(c.getState()).toEqual({ mode: 'idle', mounted: 'none', switching: false });
  });

  it('latest request wins: replaced resolves superseded, wait not restarted', async () => {
    const f = fakeClock();
    const c = createCameraModeController({ clock: f.clock });
    await c.request('pose');
    const first = c.request('record');
    f.advance(100);
    const second = c.request('idle');
    const third = c.request('pose');
    expect(await first).toEqual({ ok: false, reason: 'superseded' });
    expect(await second).toEqual({ ok: false, reason: 'superseded' });
    c.notifyUnmounted('pose');
    f.advance(CAMERA_TEARDOWN_MS);
    expect(await third).toEqual({
      ok: true,
      state: { mode: 'pose', mounted: 'pose', switching: false },
    });
  });

  it('missing unmount ack times out to idle with nothing mounted, then recovers', async () => {
    const f = fakeClock();
    const c = createCameraModeController({ clock: f.clock });
    await c.request('pose');
    const p = c.request('record');
    f.advance(CAMERA_TEARDOWN_TIMEOUT_MS - 1);
    expect(c.getState().switching).toBe(true);
    f.advance(1);
    expect(await p).toEqual({ ok: false, reason: 'teardown_timeout' });
    expect(c.getState()).toEqual({ mode: 'idle', mounted: 'none', switching: false });
    expect(f.pending()).toBe(0);
    expect((await c.request('record')).ok).toBe(true);
    expect(c.getState().mounted).toBe('record');
    c.notifyUnmounted('record'); // not switching: ignored
    expect(c.getState().mounted).toBe('record');
  });

  it('uses the global clock by default and tolerates throwing listeners', async () => {
    jest.useFakeTimers();
    try {
      const c = createCameraModeController({ teardownMs: 5, teardownTimeoutMs: 50 });
      c.subscribe(() => {
        throw new Error('boom');
      });
      await c.request('pose');
      const p = c.request('record');
      c.notifyUnmounted('pose');
      jest.advanceTimersByTime(5);
      expect((await p).ok).toBe(true);
      const q = c.request('pose');
      jest.advanceTimersByTime(50);
      expect(await q).toEqual({ ok: false, reason: 'teardown_timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('exhaustively keeps a single camera session for every request sequence of length 1 to 4', async () => {
    const modes: CameraMode[] = ['idle', 'pose', 'record'];
    const seqs: CameraMode[][] = [];
    const gen = (prefix: CameraMode[]) => {
      if (prefix.length) seqs.push(prefix);
      if (prefix.length === 4) return;
      for (const m of modes) gen([...prefix, m]);
    };
    gen([]);
    expect(seqs).toHaveLength(3 + 9 + 27 + 81);

    for (const seq of seqs) {
      const f = fakeClock();
      const c = createCameraModeController({ clock: f.clock });
      const trace: { t: number; s: CameraModeState; ack?: 'pose' | 'record' }[] = [];
      c.subscribe((s) => trace.push({ t: f.now(), s }));
      const acks: { t: number; kind: 'pose' | 'record'; idx: number }[] = [];
      let last: Promise<unknown> = Promise.resolve();
      for (const m of seq) {
        last = c.request(m);
        // acknowledge promptly whenever a teardown is in flight
        const st = c.getState();
        if (st.switching) {
          // the camera being torn down is whichever was last mounted
          const mountedBefore = [...trace].reverse().find((e) => e.s.mounted !== 'none')?.s.mounted;
          if (mountedBefore && mountedBefore !== 'none') {
            acks.push({ t: f.now(), kind: mountedBefore, idx: trace.length });
            c.notifyUnmounted(mountedBefore);
          }
        }
        f.advance(10);
      }
      f.advance(CAMERA_TEARDOWN_MS * 2);
      await flush();
      await last;

      const finalMode = seq[seq.length - 1] as CameraMode;
      expect(c.getState()).toEqual({
        mode: finalMode,
        mounted: finalMode === 'idle' ? 'none' : finalMode,
        switching: false,
      });
      // single-session rule on the trace
      let lastCam: 'pose' | 'record' | null = null;
      let lastCamIdx = -1;
      for (let i = 0; i < trace.length; i++) {
        const e = trace[i]!;
        if (e.s.mounted === 'none') continue;
        if (lastCam && lastCam !== e.s.mounted) {
          const noneIdx = trace.findIndex(
            (x, j) => j > lastCamIdx && j < i && x.s.mounted === 'none',
          );
          expect(noneIdx).toBeGreaterThan(-1);
          const ack = acks.find((a) => a.kind === lastCam && a.idx > lastCamIdx && a.idx <= i);
          expect(ack).toBeDefined();
          expect(e.t - trace[noneIdx]!.t).toBeGreaterThanOrEqual(CAMERA_TEARDOWN_MS);
        }
        lastCam = e.s.mounted;
        lastCamIdx = i;
      }
    }
  });
});
