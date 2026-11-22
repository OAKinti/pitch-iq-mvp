import type { AgilityShuttleMetrics } from '../../types/contracts';
import { createAgilityShuttleEngine } from '../../domain/drills/agilityShuttle';
import { createMockPoseStream, generateFrames } from '../../domain/mock/mockPoseGenerator';
import { count, drive, driveFrames } from './helpers';

function run(opts: { legs?: number; legDurationMs?: number }, engineCfg = {}) {
  const engine = createAgilityShuttleEngine(engineCfg);
  const out = drive(engine, createMockPoseStream({ scenario: 'agility_shuttle', ...opts }));
  return { engine, ...out, m: engine.result() as AgilityShuttleMetrics | null };
}

describe('agility shuttle engine', () => {
  it('measures 6 legs of 1600 ms', () => {
    const { m, cues, snapshots } = run({ legs: 6, legDurationMs: 1600 });
    expect(m).not.toBeNull();
    const r = m!;
    expect(r.drillType).toBe('agility_shuttle');
    expect(r.splitTimesMs).toHaveLength(6);
    for (const s of r.splitTimesMs) {
      expect(s).toBeGreaterThan(1600 * 0.9);
      expect(s).toBeLessThan(1600 * 1.1);
    }
    expect(r.totalTimeMs).toBeCloseTo(r.splitTimesMs.reduce((a, b) => a + b, 0), 5);
    expect(r.peakSpeedMps).toBeGreaterThan(2);
    expect(r.peakSpeedMps).toBeLessThan(6);
    expect(Math.abs(r.fatigueIndex)).toBeLessThan(0.05);
    expect(r.splitCv).toBeLessThan(0.1);
    expect(r.meanTurnTimeMs).toBeGreaterThan(100);
    expect(r.meanTurnTimeMs).toBeLessThan(800);
    expect(snapshots[snapshots.length - 1]!.count).toBe(6);
    expect(snapshots[snapshots.length - 1]!.phase).toBe('complete');
    for (const c of ['calibrate_hold_still', 'ready_go', 'final_push', 'drill_complete']) {
      expect(count(cues, c)).toBe(1);
    }
    expect(cues.indexOf('final_push')).toBeLessThan(cues.indexOf('drill_complete'));
  });

  it('1200 ms legs give proportionally shorter splits and higher speed', () => {
    const slow = run({ legDurationMs: 1600 }).m!;
    const fast = run({ legDurationMs: 1200 }).m!;
    expect(fast.splitTimesMs).toHaveLength(6);
    for (const s of fast.splitTimesMs) {
      expect(s).toBeGreaterThan(1200 * 0.9);
      expect(s).toBeLessThan(1200 * 1.1);
    }
    expect(fast.peakSpeedMps / slow.peakSpeedMps).toBeCloseTo(1600 / 1200, 1);
    expect(fast.meanTurnTimeMs).toBeLessThan(slow.meanTurnTimeMs);
  });

  it('supports other leg counts, including a single leg with no turns', () => {
    const four = run({ legs: 4 }, { legs: 4 }).m!;
    expect(four.splitTimesMs).toHaveLength(4);
    const one = run({ legs: 1 }, { legs: 1 }).m!;
    expect(one.splitTimesMs).toHaveLength(1);
    expect(one.meanTurnTimeMs).toBe(0);
    expect(one.fatigueIndex).toBeCloseTo(0, 5);
    expect(one.splitTimesMs[0]!).toBeGreaterThan(1200);
  });

  it('reports positive fatigue when later legs take longer', () => {
    const frames = generateFrames({ scenario: 'agility_shuttle' }, 500);
    // Stretch time progressively: later legs take up to ~30 % longer than the first.
    const slowing = frames.map((f) => ({ ...f, timestampMs: f.timestampMs * (1 + (0.3 * f.timestampMs) / 12_000) }));
    const engine = createAgilityShuttleEngine();
    driveFrames(engine, slowing);
    const m = engine.result() as AgilityShuttleMetrics;
    expect(m.fatigueIndex).toBeGreaterThan(0.1);
    expect(m.splitCv).toBeGreaterThan(0.05);
  });

  it('handles a run that starts toward the left (mirrored footage)', () => {
    const mirrored = generateFrames({ scenario: 'agility_shuttle' }, 500).map((f) => ({
      ...f,
      landmarks: f.landmarks.map((lm) => ({ ...lm, x: 1 - lm.x })),
    }));
    const engine = createAgilityShuttleEngine();
    driveFrames(engine, mirrored);
    const m = engine.result() as AgilityShuttleMetrics;
    expect(m.splitTimesMs).toHaveLength(6);
    for (const s of m.splitTimesMs) expect(Math.abs(s - 1600)).toBeLessThan(160);
  });

  it('stays in ready for a motionless athlete and reset() clears state', () => {
    const engine = createAgilityShuttleEngine();
    const { snapshots } = drive(engine, createMockPoseStream({ scenario: 'idle' }), 400);
    expect(snapshots[snapshots.length - 1]!.phase).toBe('ready');
    expect(engine.result()).toBeNull();
    engine.reset();
    const again = drive(engine, createMockPoseStream({ scenario: 'agility_shuttle' }));
    expect(again.snapshots[0]!.phase).toBe('calibrating');
    expect(engine.result()).not.toBeNull();
  });

  it('live telemetry: speed rises while running, legs count up', () => {
    const engine = createAgilityShuttleEngine();
    const stream = createMockPoseStream({ scenario: 'agility_shuttle' });
    const snaps = [];
    for (let i = 0; i < 150; i++) snaps.push(engine.push(stream.next()));
    expect(engine.result()).toBeNull();
    const peak = Math.max(...snaps.map((s) => s.liveRate));
    expect(peak).toBeGreaterThan(1.5);
    const last = snaps[snaps.length - 1]!;
    expect(last.phase).toBe('active');
    expect(last.count).toBeGreaterThanOrEqual(1);
    expect(last.elapsedMs).toBeGreaterThan(0);
  });

  it('out-of-frame mid-run: cues fire once and the phase is restored', () => {
    const engine = createAgilityShuttleEngine();
    const stream = createMockPoseStream({
      scenario: 'agility_shuttle',
      outOfFrameWindowMs: [2500, 3000],
    });
    const { snapshots, cues } = drive(engine, stream, 1500);
    const oof = snapshots.findIndex((s) => s.phase === 'out_of_frame');
    expect(snapshots[oof - 1]!.phase).toBe('active');
    expect(snapshots[oof]!.cue).toBe('out_of_frame');
    expect(snapshots[oof]!.liveRate).toBe(0);
    const back = snapshots.findIndex((s) => s.cue === 'back_in_frame');
    expect(snapshots[back]!.phase).toBe('active');
    expect(count(cues, 'out_of_frame')).toBe(1);
    expect(count(cues, 'back_in_frame')).toBe(1);
  });

  it('out-of-frame before the athlete appears stays idle; during calibration restarts it', () => {
    const early = createAgilityShuttleEngine();
    const a = drive(early, createMockPoseStream({ scenario: 'idle', outOfFrameWindowMs: [0, 400] }), 30);
    expect(a.snapshots[0]!.phase).toBe('idle');

    const mid = createAgilityShuttleEngine();
    const b = drive(mid, createMockPoseStream({ scenario: 'idle', outOfFrameWindowMs: [150, 300] }), 60);
    const oof = b.snapshots.findIndex((s) => s.phase === 'out_of_frame');
    expect(b.snapshots[oof - 1]!.phase).toBe('calibrating');
    expect(count(b.cues, 'ready_go')).toBe(1);
  });

  it('ignores frames after completion', () => {
    const { engine } = run({});
    const stream = createMockPoseStream({ scenario: 'agility_shuttle' });
    const snap = engine.push(stream.next());
    expect(snap.phase).toBe('complete');
    expect(snap.cue).toBeNull();
  });
});
