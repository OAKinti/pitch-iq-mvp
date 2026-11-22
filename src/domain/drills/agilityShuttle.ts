import {
  LANDMARK as L,
  TARGET_FPS,
  sanitizePoseFrame,
  type AgilityShuttleConfig,
  type AgilityShuttleMetrics,
  type CueId,
  type DrillEngine,
  type DrillPhase,
  type DrillSnapshot,
  type PoseFrame,
} from '../../types/contracts';
import {
  createStreamingLowpass,
  zeroPhaseLowpass,
  type StreamingFilter,
} from '../filters/butterworth';
import { cv, mean, median, meanVisibility } from './poseMath';

export const DEFAULT_AGILITY_SHUTTLE_CONFIG: AgilityShuttleConfig = {
  legs: 6,
  calibrationFrames: 15,
  minLegSpanBodyHeights: 0.6,
  startSpeedThreshold: 0.5,
  minVisibility: 0.5,
  athleteHeightM: 1.7,
};

const REQUIRED_JOINTS: readonly number[] = [
  L.LEFT_SHOULDER,
  L.RIGHT_SHOULDER,
  L.LEFT_HIP,
  L.RIGHT_HIP,
  L.LEFT_ANKLE,
  L.RIGHT_ANKLE,
];

/** Retreat from the running extreme (body-heights) that confirms a turn. */
const TURN_RETREAT_BH = 0.15;
/** Live turn estimate is refined to the zero-phase extremum within this window. */
const REFINE_WINDOW_MS = 300;
/** Shoulder-to-ankle is ~80 % of stature. */
const BODY_TO_STATURE = 0.8;
/** Speed below this fraction of peak counts as "in the turn". */
const TURN_SPEED_FRACTION = 0.35;
/** Causal speed is estimated over this many samples to suppress jitter. */
const SPEED_LOOKBACK = 3;

interface Sample {
  t: number;
  x: number;
}

interface State {
  phase: DrillPhase;
  prev: DrillPhase;
  cal: number[];
  body: number;
  filter: StreamingFilter;
  hist: Sample[];
  buf: Sample[];
  activeStart: number | null;
  dir: number;
  extremeX: number;
  extremeT: number;
  lastTurnX: number;
  turnTimes: number[];
  turnDirs: number[];
  completedLegs: number;
  speedBh: number;
  queue: CueId[];
  metrics: AgilityShuttleMetrics | null;
}

function fresh(): State {
  return {
    phase: 'idle',
    prev: 'idle',
    cal: [],
    body: 1,
    filter: createStreamingLowpass(8, TARGET_FPS),
    hist: [],
    buf: [],
    activeStart: null,
    dir: 1,
    extremeX: 0,
    extremeT: 0,
    lastTurnX: 0,
    turnTimes: [],
    turnDirs: [],
    completedLegs: 0,
    speedBh: 0,
    queue: [],
    metrics: null,
  };
}

function hipCentreX(f: PoseFrame): number {
  const l = f.landmarks[L.LEFT_HIP]!;
  const r = f.landmarks[L.RIGHT_HIP]!;
  return ((l.x + r.x) / 2) * (f.imageWidth / f.imageHeight);
}

function bodyHeightOf(f: PoseFrame): number {
  const lm = f.landmarks;
  const shoulderY = (lm[L.LEFT_SHOULDER]!.y + lm[L.RIGHT_SHOULDER]!.y) / 2;
  const ankleY = (lm[L.LEFT_ANKLE]!.y + lm[L.RIGHT_ANKLE]!.y) / 2;
  return Math.abs(shoulderY - ankleY);
}

/** Zero-phase refinement of the buffered hip-X series into final metrics. */
function computeMetrics(
  buf: readonly Sample[],
  turnTimes: readonly number[],
  turnDirs: readonly number[],
  body: number,
  cfg: AgilityShuttleConfig,
): AgilityShuttleMetrics {
  const n = buf.length;
  const t = buf.map((s) => s.t);
  const spanMs = Math.max(t[n - 1]! - t[0]!, 1);
  const xs = zeroPhaseLowpass(
    buf.map((s) => s.x),
    { sampleRateHz: (1000 * (n - 1)) / spanMs },
  );
  const vel = xs.map((_, i) => {
    const lo = Math.max(i - 1, 0);
    const hi = Math.min(i + 1, n - 1);
    return (xs[hi]! - xs[lo]!) / (Math.max(t[hi]! - t[lo]!, 1) / 1000) / body;
  });
  const thr = cfg.startSpeedThreshold;

  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(vel[i]!) > thr) {
      startIdx = i;
      break;
    }
  }

  const turnIdx = turnTimes.map((tt, k) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(t[i]! - tt);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const dir = turnDirs[k]!;
    for (let i = 0; i < n; i++) {
      if (Math.abs(t[i]! - tt) <= REFINE_WINDOW_MS && dir * xs[i]! > dir * xs[best]!) best = i;
    }
    return best;
  });

  const anchorIdx = turnIdx.length > 0 ? turnIdx[turnIdx.length - 1]! : startIdx;
  let stopIdx = n - 1;
  for (let i = anchorIdx; i < n; i++) {
    if (
      Math.abs(xs[i]! - xs[anchorIdx]!) >= cfg.minLegSpanBodyHeights * body &&
      Math.abs(vel[i]!) < thr
    ) {
      stopIdx = i;
      break;
    }
  }

  const boundaries = [t[startIdx]!, ...turnIdx.map((i) => t[i]!), t[stopIdx]!];
  const splits = boundaries.slice(1).map((b, i) => b - boundaries[i]!);

  let peakBh = 0;
  for (let i = startIdx; i <= stopIdx; i++) peakBh = Math.max(peakBh, Math.abs(vel[i]!));

  const slow = TURN_SPEED_FRACTION * peakBh;
  const turnDurations = turnIdx.map((ti) => {
    let l = ti;
    let r = ti;
    while (l > 0 && Math.abs(vel[l - 1]!) < slow) l--;
    while (r < n - 1 && Math.abs(vel[r + 1]!) < slow) r++;
    return t[r]! - t[l]!;
  });

  const first = splits[0]!;
  const last = splits[splits.length - 1]!;
  return {
    drillType: 'agility_shuttle',
    totalTimeMs: t[stopIdx]! - t[startIdx]!,
    splitTimesMs: splits,
    peakSpeedMps: peakBh * cfg.athleteHeightM * BODY_TO_STATURE,
    meanTurnTimeMs: mean(turnDurations),
    splitCv: cv(splits),
    fatigueIndex: last / Math.max(first, 1) - 1,
  };
}

export function createAgilityShuttleEngine(config: Partial<AgilityShuttleConfig> = {}): DrillEngine {
  const cfg: AgilityShuttleConfig = { ...DEFAULT_AGILITY_SHUTTLE_CONFIG, ...config };
  let st = fresh();

  const resetSignal = (): void => {
    st.filter.reset();
    st.hist = [];
  };

  const snapshot = (ts: number, quality: number): DrillSnapshot => ({
    drillType: 'agility_shuttle',
    phase: st.phase,
    elapsedMs: st.activeStart === null ? 0 : ts - st.activeStart,
    count: st.completedLegs,
    liveRate: Math.abs(st.speedBh) * cfg.athleteHeightM * BODY_TO_STATURE,
    framingQuality: quality,
    cue: st.queue.shift() ?? null,
  });

  const track = (xf: number, ts: number): void => {
    const bh = st.body;
    const lastLegPending = st.completedLegs === cfg.legs - 1;
    if (st.dir * (xf - st.extremeX) > 0) {
      st.extremeX = xf;
      st.extremeT = ts;
    } else if (
      !lastLegPending &&
      st.dir * (st.extremeX - xf) > TURN_RETREAT_BH * bh &&
      Math.abs(st.extremeX - st.lastTurnX) >= cfg.minLegSpanBodyHeights * bh
    ) {
      st.turnTimes.push(st.extremeT);
      st.turnDirs.push(st.dir);
      st.completedLegs += 1;
      st.lastTurnX = st.extremeX;
      st.dir = -st.dir;
      st.extremeX = xf;
      st.extremeT = ts;
      if (st.completedLegs === cfg.legs - 1) st.queue.push('final_push');
    }
    if (
      lastLegPending &&
      Math.abs(xf - st.lastTurnX) >= cfg.minLegSpanBodyHeights * bh &&
      Math.abs(st.speedBh) < cfg.startSpeedThreshold
    ) {
      st.metrics = computeMetrics(st.buf, st.turnTimes, st.turnDirs, bh, cfg);
      st.completedLegs = cfg.legs;
      st.phase = 'complete';
      st.queue = ['drill_complete'];
    }
  };

  return {
    drillType: 'agility_shuttle',
    push(frame: PoseFrame): DrillSnapshot {
      const f = sanitizePoseFrame(frame);
      const ts = f.timestampMs;
      const quality = meanVisibility(f, REQUIRED_JOINTS);
      if (st.phase === 'complete') return snapshot(ts, quality);

      if (quality < cfg.minVisibility) {
        if (st.phase !== 'out_of_frame' && st.phase !== 'idle') {
          st.prev = st.phase;
          st.phase = 'out_of_frame';
          st.cal = [];
          st.speedBh = 0;
          resetSignal();
          st.queue.push('out_of_frame');
        }
        return snapshot(ts, quality);
      }
      if (st.phase === 'out_of_frame') {
        st.phase = st.prev;
        st.queue.push('back_in_frame');
      }

      const x = hipCentreX(f);
      const xf = st.filter.step(x);
      st.hist.push({ t: ts, x: xf });
      const ref = st.hist[Math.max(st.hist.length - 1 - SPEED_LOOKBACK, 0)]!;
      st.speedBh = (xf - ref.x) / (Math.max(ts - ref.t, 1) / 1000) / st.body;

      if (st.phase === 'idle' || st.phase === 'calibrating') {
        if (st.phase === 'idle') {
          st.phase = 'calibrating';
          st.queue.push('calibrate_hold_still');
        }
        st.cal.push(bodyHeightOf(f));
        if (st.cal.length >= cfg.calibrationFrames) {
          st.body = Math.max(median(st.cal), 1e-3);
          st.phase = 'ready';
          st.queue.push('ready_go');
        }
      } else {
        st.buf.push({ t: ts, x });
        if (st.phase === 'ready') {
          if (Math.abs(st.speedBh) > cfg.startSpeedThreshold) {
            st.phase = 'active';
            st.activeStart = ts;
            st.dir = st.speedBh > 0 ? 1 : -1;
            st.extremeX = xf;
            st.extremeT = ts;
            st.lastTurnX = xf;
          }
        } else {
          track(xf, ts);
        }
      }
      return snapshot(ts, quality);
    },
    result(): AgilityShuttleMetrics | null {
      return st.metrics;
    },
    reset(): void {
      st = fresh();
    },
  };
}
