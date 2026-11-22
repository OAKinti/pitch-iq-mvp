import {
  LANDMARK as L,
  TARGET_FPS,
  sanitizePoseFrame,
  type BallMasteryConfig,
  type BallMasteryMetrics,
  type CueId,
  type DrillEngine,
  type DrillPhase,
  type DrillSnapshot,
  type PoseFrame,
} from '../../types/contracts';
import { createStreamingLowpass, type StreamingFilter } from '../filters/butterworth';
import { cv, median, meanVisibility, std } from './poseMath';

export const DEFAULT_BALL_MASTERY_CONFIG: BallMasteryConfig = {
  durationMs: 30_000,
  calibrationFrames: 15,
  liftThreshold: 0.08,
  landThreshold: 0.03,
  minVisibility: 0.5,
};

const REQUIRED_JOINTS: readonly number[] = [
  L.LEFT_HIP,
  L.RIGHT_HIP,
  L.LEFT_KNEE,
  L.RIGHT_KNEE,
  L.LEFT_ANKLE,
  L.RIGHT_ANKLE,
  L.LEFT_FOOT_INDEX,
  L.RIGHT_FOOT_INDEX,
];

type Foot = 'L' | 'R';
const FEET: readonly Foot[] = ['L', 'R'];
const ANKLE: Record<Foot, number> = { L: L.LEFT_ANKLE, R: L.RIGHT_ANKLE };
const TOE: Record<Foot, number> = { L: L.LEFT_FOOT_INDEX, R: L.RIGHT_FOOT_INDEX };
const SAME_FOOT_RUN = 6;

interface CalibrationSample {
  baseL: number;
  baseR: number;
  leg: number;
  body: number;
}

interface State {
  phase: DrillPhase;
  prev: DrillPhase;
  cal: CalibrationSample[];
  base: Record<Foot, number>;
  leg: number;
  body: number;
  activeStart: number | null;
  up: Record<Foot, boolean>;
  filters: Record<Foot, StreamingFilter>;
  touches: { t: number; foot: Foot }[];
  hipX: number[];
  queue: CueId[];
  halfwayDone: boolean;
  tenDone: boolean;
  run: number;
  lastFoot: Foot | null;
  armed: boolean;
  metrics: BallMasteryMetrics | null;
}

function fresh(): State {
  return {
    phase: 'idle',
    prev: 'idle',
    cal: [],
    base: { L: 0, R: 0 },
    leg: 1,
    body: 1,
    activeStart: null,
    up: { L: false, R: false },
    filters: { L: createStreamingLowpass(8, TARGET_FPS), R: createStreamingLowpass(8, TARGET_FPS) },
    touches: [],
    hipX: [],
    queue: [],
    halfwayDone: false,
    tenDone: false,
    run: 0,
    lastFoot: null,
    armed: true,
    metrics: null,
  };
}

function footY(frame: PoseFrame, foot: Foot): number {
  return (frame.landmarks[ANKLE[foot]]!.y + frame.landmarks[TOE[foot]]!.y) / 2;
}

function calibrationSample(f: PoseFrame): CalibrationSample {
  const lm = f.landmarks;
  const legL = Math.abs(lm[L.LEFT_HIP]!.y - lm[L.LEFT_ANKLE]!.y);
  const legR = Math.abs(lm[L.RIGHT_HIP]!.y - lm[L.RIGHT_ANKLE]!.y);
  const shoulderY = (lm[L.LEFT_SHOULDER]!.y + lm[L.RIGHT_SHOULDER]!.y) / 2;
  const ankleY = (lm[L.LEFT_ANKLE]!.y + lm[L.RIGHT_ANKLE]!.y) / 2;
  return {
    baseL: footY(f, 'L'),
    baseR: footY(f, 'R'),
    leg: (legL + legR) / 2,
    body: Math.abs(shoulderY - ankleY),
  };
}

export function createBallMasteryEngine(config: Partial<BallMasteryConfig> = {}): DrillEngine {
  const cfg: BallMasteryConfig = { ...DEFAULT_BALL_MASTERY_CONFIG, ...config };
  let st = fresh();

  const resetFeet = (): void => {
    st.up = { L: false, R: false };
    st.filters.L.reset();
    st.filters.R.reset();
  };

  const registerTouch = (foot: Foot, ts: number): void => {
    st.touches.push({ t: ts - st.activeStart!, foot });
    if (foot === st.lastFoot) {
      st.run += 1;
    } else {
      st.run = 1;
      st.armed = true;
      st.lastFoot = foot;
    }
    if (st.run >= SAME_FOOT_RUN && st.armed) {
      st.armed = false;
      st.queue.push('switch_feet');
    }
  };

  const finish = (): void => {
    const times = st.touches.map((t) => t.t);
    const intervals = times.slice(1).map((t, i) => t - times[i]!);
    const left = st.touches.filter((t) => t.foot === 'L').length;
    const right = st.touches.length - left;
    st.metrics = {
      drillType: 'ball_mastery',
      touches: st.touches.length,
      leftTouches: left,
      rightTouches: right,
      touchesPerMinute: st.touches.length / (cfg.durationMs / 60_000),
      rhythmCv: st.touches.length < 3 ? 0 : cv(intervals),
      footBalance: Math.max(left, right) === 0 ? 0 : Math.min(left, right) / Math.max(left, right),
      hipSway: std(st.hipX) / st.body,
      touchTimestampsMs: times,
      durationMs: cfg.durationMs,
    };
    st.phase = 'complete';
    st.queue = ['drill_complete'];
  };

  const processFeet = (f: PoseFrame, ts: number): void => {
    for (const foot of FEET) {
      const h = (st.base[foot] - footY(f, foot)) / st.leg;
      const hf = st.filters[foot].step(h);
      if (!st.up[foot] && hf > cfg.liftThreshold) {
        st.up[foot] = true;
        if (st.phase === 'ready') {
          st.phase = 'active';
          st.activeStart = ts;
        }
      } else if (st.up[foot] && hf < cfg.landThreshold) {
        st.up[foot] = false;
        registerTouch(foot, ts);
      }
    }
    if (st.phase === 'active') {
      const hipL = f.landmarks[L.LEFT_HIP]!.x;
      const hipR = f.landmarks[L.RIGHT_HIP]!.x;
      st.hipX.push(((hipL + hipR) / 2) * (f.imageWidth / f.imageHeight));
      const elapsed = ts - st.activeStart!;
      if (!st.halfwayDone && elapsed >= cfg.durationMs / 2) {
        st.halfwayDone = true;
        st.queue.push('halfway');
      }
      if (!st.tenDone && elapsed >= cfg.durationMs - 10_000) {
        st.tenDone = true;
        st.queue.push('ten_seconds');
      }
    }
  };

  const snapshot = (ts: number, quality: number): DrillSnapshot => {
    const elapsed = st.activeStart === null ? 0 : ts - st.activeStart;
    return {
      drillType: 'ball_mastery',
      phase: st.phase,
      elapsedMs: elapsed,
      count: st.touches.length,
      liveRate: (st.touches.length / Math.max(elapsed, 1000)) * 60_000,
      framingQuality: quality,
      cue: st.queue.shift() ?? null,
    };
  };

  return {
    drillType: 'ball_mastery',
    push(frame: PoseFrame): DrillSnapshot {
      const f = sanitizePoseFrame(frame);
      const ts = f.timestampMs;
      const quality = meanVisibility(f, REQUIRED_JOINTS);
      if (st.phase === 'complete') return snapshot(ts, quality);

      if (st.activeStart !== null && ts - st.activeStart >= cfg.durationMs) {
        finish();
        return snapshot(ts, quality);
      }

      if (quality < cfg.minVisibility) {
        if (st.phase !== 'out_of_frame' && st.phase !== 'idle') {
          st.prev = st.phase;
          st.phase = 'out_of_frame';
          st.cal = [];
          resetFeet();
          st.queue.push('out_of_frame');
        }
        return snapshot(ts, quality);
      }
      if (st.phase === 'out_of_frame') {
        st.phase = st.prev;
        st.queue.push('back_in_frame');
      }

      if (st.phase === 'idle' || st.phase === 'calibrating') {
        if (st.phase === 'idle') {
          st.phase = 'calibrating';
          st.queue.push('calibrate_hold_still');
        }
        st.cal.push(calibrationSample(f));
        if (st.cal.length >= cfg.calibrationFrames) {
          st.base = {
            L: median(st.cal.map((s) => s.baseL)),
            R: median(st.cal.map((s) => s.baseR)),
          };
          st.leg = Math.max(median(st.cal.map((s) => s.leg)), 1e-3);
          st.body = Math.max(median(st.cal.map((s) => s.body)), 1e-3);
          st.phase = 'ready';
          st.queue.push('ready_go');
        }
      } else {
        processFeet(f, ts);
      }
      return snapshot(ts, quality);
    },
    result(): BallMasteryMetrics | null {
      return st.metrics;
    },
    reset(): void {
      st = fresh();
    },
  };
}
