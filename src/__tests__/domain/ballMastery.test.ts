import { LANDMARK as L, type BallMasteryMetrics, type PoseFrame } from '../../types/contracts';
import { createBallMasteryEngine } from '../../domain/drills/ballMastery';
import { createDrillEngine } from '../../domain/drills';
import { createMockPoseStream, generateFrames } from '../../domain/mock/mockPoseGenerator';
import { count, drive, driveFrames } from './helpers';

function runMock(tps: number): { m: BallMasteryMetrics; cues: string[] } {
  const engine = createBallMasteryEngine();
  const { cues } = drive(engine, createMockPoseStream({ scenario: 'ball_mastery', touchesPerSecond: tps }));
  return { m: engine.result() as BallMasteryMetrics, cues };
}

describe('ball mastery engine', () => {
  it('reproduces 2.5 touches/s over 30 s', () => {
    const { m } = runMock(2.5);
    expect(m.drillType).toBe('ball_mastery');
    expect(Math.abs(m.touches - 75)).toBeLessThanOrEqual(3);
    expect(m.leftTouches + m.rightTouches).toBe(m.touches);
    expect(m.footBalance).toBeGreaterThan(0.9);
    expect(Math.abs(m.touchesPerMinute - 150)).toBeLessThanOrEqual(6);
    expect(m.rhythmCv).toBeLessThan(0.1);
    expect(m.hipSway).toBeGreaterThan(0);
    expect(m.hipSway).toBeLessThan(0.05);
    expect(m.durationMs).toBe(30_000);
    expect(m.touchTimestampsMs).toHaveLength(m.touches);
    expect(m.touchTimestampsMs[0]).toBeGreaterThan(0);
  });

  it('scales proportionally with touchesPerSecond (nothing hard-coded)', () => {
    const slow = runMock(1.5).m;
    const fast = runMock(2.5).m;
    expect(Math.abs(slow.touches - 45)).toBeLessThanOrEqual(3);
    expect(Math.abs(slow.touchesPerMinute - 90)).toBeLessThanOrEqual(6);
    expect(slow.touches / fast.touches).toBeCloseTo(0.6, 1);
  });

  it('emits each lifecycle cue exactly once', () => {
    const { cues } = runMock(2.5);
    for (const c of ['calibrate_hold_still', 'ready_go', 'halfway', 'ten_seconds', 'drill_complete']) {
      expect(count(cues, c)).toBe(1);
    }
    expect(cues[0]).toBe('calibrate_hold_still');
    expect(cues[1]).toBe('ready_go');
    expect(cues[cues.length - 1]).toBe('drill_complete');
    expect(cues).not.toContain('switch_feet');
  });

  it('result() is null until complete; snapshots expose live telemetry', () => {
    const engine = createBallMasteryEngine();
    const stream = createMockPoseStream({ scenario: 'ball_mastery' });
    expect(engine.result()).toBeNull();
    const snaps = [];
    for (let i = 0; i < 400; i++) snaps.push(engine.push(stream.next()));
    expect(engine.result()).toBeNull();
    const last = snaps[snaps.length - 1]!;
    expect(last.phase).toBe('active');
    expect(last.count).toBeGreaterThan(10);
    expect(last.liveRate).toBeGreaterThan(100);
    expect(last.elapsedMs).toBeGreaterThan(0);
    expect(last.framingQuality).toBeGreaterThan(0.9);
    expect(snaps[0]!.elapsedMs).toBe(0);
  });

  it('stays complete and quiet after finishing', () => {
    const engine = createBallMasteryEngine();
    const stream = createMockPoseStream({ scenario: 'ball_mastery' });
    drive(engine, stream);
    const after = engine.push(stream.next());
    expect(after.phase).toBe('complete');
    expect(after.cue).toBeNull();
    expect(engine.result()).not.toBeNull();
  });

  it('idle scenario never leaves ready', () => {
    const engine = createBallMasteryEngine();
    const { snapshots } = drive(engine, createMockPoseStream({ scenario: 'idle' }), 600);
    expect(snapshots[snapshots.length - 1]!.phase).toBe('ready');
    expect(snapshots.some((s) => s.phase === 'active')).toBe(false);
    expect(engine.result()).toBeNull();
  });

  it('reset() returns to a clean idle engine', () => {
    const engine = createBallMasteryEngine();
    drive(engine, createMockPoseStream({ scenario: 'ball_mastery' }));
    expect(engine.result()).not.toBeNull();
    engine.reset();
    expect(engine.result()).toBeNull();
    const { cues, snapshots } = drive(engine, createMockPoseStream({ scenario: 'ball_mastery' }));
    expect(snapshots[0]!.phase).toBe('calibrating');
    expect(count(cues, 'ready_go')).toBe(1);
    expect(engine.result()).not.toBeNull();
  });

  it('out-of-frame during active play emits out_of_frame then back_in_frame and resumes', () => {
    const engine = createBallMasteryEngine();
    const stream = createMockPoseStream({
      scenario: 'ball_mastery',
      outOfFrameWindowMs: [8000, 9000],
    });
    const { snapshots, cues } = drive(engine, stream);
    const oof = snapshots.findIndex((s) => s.phase === 'out_of_frame');
    expect(oof).toBeGreaterThan(0);
    expect(snapshots[oof - 1]!.phase).toBe('active');
    expect(snapshots[oof]!.cue).toBe('out_of_frame');
    const back = snapshots.findIndex((s) => s.cue === 'back_in_frame');
    expect(back).toBeGreaterThan(oof);
    expect(snapshots[back]!.phase).toBe('active');
    expect(count(cues, 'out_of_frame')).toBe(1);
    expect(count(cues, 'back_in_frame')).toBe(1);
    // out-of-frame time still counts toward the clock: drill still completes on schedule
    const m = engine.result() as BallMasteryMetrics;
    expect(m.touches).toBeLessThan(75);
    expect(m.touches).toBeGreaterThan(60);
  });

  it('out-of-frame during calibration returns to calibrating and restarts the count', () => {
    const engine = createBallMasteryEngine();
    const stream = createMockPoseStream({
      scenario: 'ball_mastery',
      outOfFrameWindowMs: [150, 300],
    });
    const { snapshots, cues } = drive(engine, stream);
    const oof = snapshots.findIndex((s) => s.phase === 'out_of_frame');
    expect(snapshots[oof - 1]!.phase).toBe('calibrating');
    const back = snapshots.findIndex((s) => s.cue === 'back_in_frame');
    expect(snapshots[back]!.phase).toBe('calibrating');
    expect(count(cues, 'ready_go')).toBe(1);
    expect(engine.result()).not.toBeNull();
  });

  it('frames invisible before the athlete appears keep the engine idle', () => {
    const engine = createBallMasteryEngine();
    const stream = createMockPoseStream({ scenario: 'idle', outOfFrameWindowMs: [0, 500] });
    const { snapshots } = drive(engine, stream, 40);
    expect(snapshots[0]!.phase).toBe('idle');
    expect(snapshots[10]!.phase).toBe('idle');
    expect(snapshots.some((s) => s.phase === 'calibrating')).toBe(true);
    expect(snapshots.some((s) => s.cue === 'out_of_frame')).toBe(false);
  });

  it('emits switch_feet once for a one-footed sequence and re-arms after the other foot', () => {
    const frames = generateFrames({ scenario: 'ball_mastery' }, 1100);
    const restFoot = (f: PoseFrame): PoseFrame => {
      const ref = frames[0]!.landmarks;
      const lms = f.landmarks.map((lm, i) =>
        i === L.RIGHT_ANKLE || i === L.RIGHT_HEEL || i === L.RIGHT_FOOT_INDEX || i === L.RIGHT_KNEE
          ? { ...ref[i]! }
          : lm,
      );
      return { ...f, landmarks: lms };
    };
    const oneFooted = frames.map(restFoot);
    const { cues } = driveFrames(createBallMasteryEngine(), oneFooted);
    expect(count(cues, 'switch_feet')).toBe(1);

    // Left-only for the first 12 s, then both feet: re-arm happens on the first right touch,
    // and a second one-footed run later would fire again; here we just assert one early cue.
    const mixed = frames.map((f, i) => (f.timestampMs < 12_000 ? restFoot(f) : frames[i]!));
    const mixedCues = driveFrames(createBallMasteryEngine(), mixed).cues;
    expect(count(mixedCues, 'switch_feet')).toBe(1);
  });

  it('a foot lifted and never landed yields zero touches without crashing', () => {
    const frames = generateFrames({ scenario: 'idle' }, 1200);
    const lifted = frames.map((f, i) => {
      if (i < 20) return f;
      const lms = f.landmarks.map((lm, j) =>
        j === L.LEFT_ANKLE || j === L.LEFT_FOOT_INDEX ? { ...lm, y: lm.y - 0.1 } : lm,
      );
      return { ...f, landmarks: lms };
    });
    const engine = createBallMasteryEngine();
    driveFrames(engine, lifted);
    const m = engine.result() as BallMasteryMetrics;
    expect(m.touches).toBe(0);
    expect(m.footBalance).toBe(0);
    expect(m.rhythmCv).toBe(0);
    expect(m.touchesPerMinute).toBe(0);
  });

  it('honours config overrides (shorter drill, fewer calibration frames)', () => {
    const engine = createBallMasteryEngine({ durationMs: 12_000, calibrationFrames: 5 });
    const { cues } = drive(engine, createMockPoseStream({ scenario: 'ball_mastery' }));
    const m = engine.result() as BallMasteryMetrics;
    expect(m.durationMs).toBe(12_000);
    expect(Math.abs(m.touches - 30)).toBeLessThanOrEqual(3);
    expect(count(cues, 'halfway')).toBe(1);
    expect(count(cues, 'ten_seconds')).toBe(1);
  });

  it('createDrillEngine builds the matching engine', () => {
    expect(createDrillEngine('ball_mastery').drillType).toBe('ball_mastery');
    expect(createDrillEngine('agility_shuttle').drillType).toBe('agility_shuttle');
  });

  it('redacted face landmarks are never needed: sanitised input behaves the same', () => {
    const frames = generateFrames({ scenario: 'ball_mastery', seed: 7 }, 200);
    const dirty = frames.map((f) => ({
      ...f,
      landmarks: f.landmarks.map((lm, i) => (i >= 1 && i <= 10 ? { x: 0.5, y: 0.5, z: 0, visibility: 1 } : lm)),
    }));
    const a = driveFrames(createBallMasteryEngine(), frames).snapshots;
    const b = driveFrames(createBallMasteryEngine(), dirty).snapshots;
    expect(b).toEqual(a);
  });
});
