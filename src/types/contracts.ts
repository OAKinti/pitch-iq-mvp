/**
 * FROZEN INTERFACE CONTRACTS — PitchIQ MVP (Day 1, Nov 22 2026)
 *
 * Every vertical slice (domain / services / UI) builds against these types.
 * Changing anything here requires updating docs/INTERFACE_CONTRACTS.md and
 * bumping CONTRACT_VERSION in the same commit.
 *
 * Privacy invariants encoded here (COPPA 2026 / Illinois BIPA):
 *  - Only non-identifying skeletal joints are ever represented. There is no
 *    face-mesh, faceprint, iris, or voiceprint type anywhere in this file.
 *  - MediaPipe face keypoints (eyes, ears, mouth: indices 1–10) are redacted
 *    by `sanitizePoseFrame` before any frame leaves the CV layer.
 */

export const CONTRACT_VERSION = '1.1.0' as const; // v1.1.0 (Nov 24, D-6): debrief wire types

/* ────────────────────────────── Sport scope ────────────────────────────── */

/** Schema is sport-extensible; the MVP implements ONLY soccer. */
export type Sport = 'soccer';
export const MVP_SPORT: Sport = 'soccer';

/* ─────────────────────────────── Pose / CV ─────────────────────────────── */

/** MediaPipe Pose Landmarker — 33 landmarks. Index order is fixed by MediaPipe. */
export const LANDMARK = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const LANDMARK_COUNT = 33 as const;

/** Face keypoints redacted for BIPA safety (nose kept as a coarse head anchor). */
export const PRIVACY_REDACTED_LANDMARKS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * One skeletal joint in normalized image space.
 * x, y ∈ [0, 1] (origin top-left, y grows DOWNWARD), z is MediaPipe's relative
 * depth (hip-centred, same scale as x). visibility ∈ [0, 1].
 */
export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility: number;
}

export type PoseSource = 'mock' | 'mediapipe';

/** The frozen per-frame contract produced by mockPoseGenerator or MediaPipe. */
export interface PoseFrame {
  /** Monotonic capture time in milliseconds. */
  readonly timestampMs: number;
  /** 0-based frame counter within the current stream. */
  readonly frameIndex: number;
  /** Exactly LANDMARK_COUNT entries, MediaPipe order, face keypoints redacted. */
  readonly landmarks: readonly Landmark[];
  /** Source image dimensions in pixels (for aspect-ratio-correct math). */
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly source: PoseSource;
}

/** Target capture rate. Drill math assumes ~30 FPS but uses timestamps, never frame counts, for time. */
export const TARGET_FPS = 30 as const;

/** Replace redacted face landmarks with a zero-visibility placeholder. Pure. */
export function sanitizePoseFrame(frame: PoseFrame): PoseFrame {
  const redacted: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
  return {
    ...frame,
    landmarks: frame.landmarks.map((lm, i) =>
      PRIVACY_REDACTED_LANDMARKS.includes(i) ? redacted : lm,
    ),
  };
}

/* ─────────────────────────────── Drills ─────────────────────────────── */

export type DrillType = 'ball_mastery' | 'agility_shuttle';

/**
 * Shared drill lifecycle.
 * idle → calibrating → ready → active → complete
 * Any phase except complete may drop to `out_of_frame` when the body is not
 * sufficiently visible, and returns to the previous phase when visible again.
 */
export type DrillPhase = 'idle' | 'calibrating' | 'ready' | 'active' | 'out_of_frame' | 'complete';

export interface BallMasteryConfig {
  /** Active drill duration once the first touch starts the clock. Default 30_000. */
  readonly durationMs: number;
  /** Stable full-body frames required to calibrate. Default 15 (~0.5 s). */
  readonly calibrationFrames: number;
  /** Foot lift (fraction of leg length) that arms a touch. Default 0.08. */
  readonly liftThreshold: number;
  /** Foot height (fraction of leg length) that completes a touch. Default 0.03. */
  readonly landThreshold: number;
  /** Minimum mean visibility of required joints. Default 0.5. */
  readonly minVisibility: number;
}

export interface AgilityShuttleConfig {
  /** Number of legs (one leg = one traversal between turn points). Default 6. */
  readonly legs: number;
  readonly calibrationFrames: number;
  /** Minimum horizontal travel per leg in body-heights. Default 0.6. */
  readonly minLegSpanBodyHeights: number;
  /** Hip speed (body-heights/s) that starts the run from `ready`. Default 0.5. */
  readonly startSpeedThreshold: number;
  readonly minVisibility: number;
  /** Athlete height for m/s conversion. Default 1.70. */
  readonly athleteHeightM: number;
}

export interface BallMasteryMetrics {
  readonly drillType: 'ball_mastery';
  readonly touches: number;
  readonly leftTouches: number;
  readonly rightTouches: number;
  readonly touchesPerMinute: number;
  /** Coefficient of variation of inter-touch intervals (lower = steadier rhythm). */
  readonly rhythmCv: number;
  /** min(left,right)/max(left,right) ∈ [0,1]; 1 = perfectly two-footed. */
  readonly footBalance: number;
  /** Std-dev of hip-centre x in body-heights (lower = more stable base). */
  readonly hipSway: number;
  /** Timestamps (ms, relative to drill start) of every completed touch. */
  readonly touchTimestampsMs: readonly number[];
  readonly durationMs: number;
}

export interface AgilityShuttleMetrics {
  readonly drillType: 'agility_shuttle';
  readonly totalTimeMs: number;
  readonly splitTimesMs: readonly number[];
  readonly peakSpeedMps: number;
  /** Mean time per turn spent below 35 % of peak speed. */
  readonly meanTurnTimeMs: number;
  /** CV of split times (lower = more consistent). */
  readonly splitCv: number;
  /** lastSplit / firstSplit − 1 (positive = slowing down). */
  readonly fatigueIndex: number;
}

export type DrillMetrics = BallMasteryMetrics | AgilityShuttleMetrics;

/** Live telemetry emitted after every pushed frame. */
export interface DrillSnapshot {
  readonly drillType: DrillType;
  readonly phase: DrillPhase;
  /** ms since the active phase began (0 before). */
  readonly elapsedMs: number;
  /** Drill-specific primary counter: touches (ball mastery) or completed legs (shuttle). */
  readonly count: number;
  /** Drill-specific live rate: touches/min or current speed m/s. */
  readonly liveRate: number;
  /** 0..1 framing quality (mean visibility of required joints). */
  readonly framingQuality: number;
  /** Cue the voice layer should play on this frame, if any. */
  readonly cue: CueId | null;
}

export interface DrillResult {
  readonly id: string;
  readonly sport: Sport;
  readonly drillType: DrillType;
  readonly startedAt: string; // ISO-8601
  readonly metrics: DrillMetrics;
}

/** Stateful, frame-driven drill engine. Pure TS — no React, no timers. */
export interface DrillEngine {
  readonly drillType: DrillType;
  push(frame: PoseFrame): DrillSnapshot;
  /** Non-null only once phase === 'complete'. */
  result(): DrillMetrics | null;
  reset(): void;
}

/* ─────────────────────────── Ratings / OVR ─────────────────────────── */

export type PlayerPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

/** Soccer attribute keys (FIFA-style 3-letter labels in UI). */
export type AttributeKey = 'pace' | 'agility' | 'ballControl' | 'balance' | 'rhythm' | 'endurance';

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'pace',
  'agility',
  'ballControl',
  'balance',
  'rhythm',
  'endurance',
];

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeKey, string>> = {
  pace: 'PAC',
  agility: 'AGI',
  ballControl: 'CTL',
  balance: 'BAL',
  rhythm: 'RHY',
  endurance: 'END',
};

/** Each attribute ∈ [0, 99.9]. */
export type AttributeVector = Readonly<Record<AttributeKey, number>>;

/** Ratings ≥ ELITE_BAND_FLOOR are compressed asymptotically into [95, 99.9]. */
export const ELITE_BAND_FLOOR = 95 as const;
export const RATING_CEILING = 99.9 as const;

export type RatingBand = 'developing' | 'standard' | 'elite';

export interface OvrResult {
  readonly sport: Sport;
  readonly position: PlayerPosition;
  /** Rounded to 1 decimal. */
  readonly ovr: number;
  readonly band: RatingBand;
  readonly attributes: AttributeVector;
}

export type BadgeId =
  | 'metronome'
  | 'quick_feet'
  | 'two_footed'
  | 'rock_solid'
  | 'brake_master'
  | 'engine'
  | 'burst';

export interface Badge {
  readonly id: BadgeId;
  readonly label: string;
  readonly description: string;
}

export interface Archetype {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  /** Prototype attribute profile (shape matters, not magnitude). */
  readonly profile: AttributeVector;
}

export interface ArchetypeMatch {
  readonly archetype: Archetype;
  /** Cosine similarity ∈ [−1, 1] of mean-centred, L2-normalized vectors. */
  readonly similarity: number;
}

/* ────────────────────────── Age gate / privacy ────────────────────────── */

export type AgeBracket = 'under_13' | 'teen_13_17' | 'adult_18_plus';
export type ProfileVisibility = 'private' | 'friends' | 'public';

export type ConsentType = 'camera_skeletal_tracking' | 'voice_coach' | 'parental_verified';

export interface ConsentRecord {
  readonly type: ConsentType;
  /** Version of the policy text the user agreed to. */
  readonly policyVersion: string;
  readonly grantedAt: string; // ISO-8601
}

export const CONSENT_POLICY_VERSION = '2026-11-22' as const;
export const RAW_VIDEO_TTL_DAYS = 90 as const;

/* ───────────────────────── Group sessions ───────────────────────── */

export interface GroupMemberStat {
  readonly userId: string;
  readonly displayName: string;
  readonly bestOvr: number;
  /** ISO dates (YYYY-MM-DD) on which the member logged ≥1 drill, any order. */
  readonly activeDays: readonly string[];
}

export interface Crowns {
  /** userId with the highest bestOvr (ties → earliest in input order). */
  readonly performance: string | null;
  /** userId with the most distinct active days in the trailing 90 days. */
  readonly consistency: string | null;
}

export interface RivalryObjective {
  readonly userId: string;
  readonly rivalId: string;
  /** OVR points needed to pass the rival (0 when already ahead). */
  readonly gap: number;
  /** 0..1 progress toward passing the rival. */
  readonly progress: number;
  readonly description: string;
}

/* ─────────────────────────── Voice coach ─────────────────────────── */

export type CoachPersona = 'captain' | 'drill_sergeant' | 'hype';

export type CueId =
  | 'calibrate_step_back'
  | 'calibrate_hold_still'
  | 'ready_go'
  | 'out_of_frame'
  | 'back_in_frame'
  | 'rhythm_good'
  | 'pace_up'
  | 'switch_feet'
  | 'halfway'
  | 'ten_seconds'
  | 'final_push'
  | 'turn_sharp'
  | 'drill_complete';

/** Tier 1 — pre-cached cue (0 recurring cost). */
export interface CachedCue {
  readonly id: CueId;
  readonly persona: CoachPersona;
  readonly text: string;
  /** Bundled/R2 asset URI; null until Day 2–3 audio generation. */
  readonly audioUri: string | null;
}

/** Tier 2 — post-drill debrief. */
export interface Debrief {
  readonly text: string;
  readonly audioUri: string | null;
  readonly source: 'haiku' | 'template';
  readonly ttsChars: number;
  readonly estimatedCostUsd: number;
}

/* ───────────────────────────── Wearables ───────────────────────────── */

/**
 * Sources allowed to be INGESTED. Strava is deliberately absent: Strava's
 * June 2026 API terms ban using Strava data in AI models/prompts or shared
 * leaderboards, so Strava is an export-only destination.
 */
export type IngestionSource = 'healthkit' | 'health_connect' | 'whoop';

/** Canonical internal wearable record — the ONLY shape AI prompts may read. */
export interface WearableDailySummary {
  readonly source: IngestionSource;
  readonly date: string; // YYYY-MM-DD
  readonly restingHeartRateBpm: number | null;
  readonly hrvRmssdMs: number | null;
  readonly sleepMinutes: number | null;
  /** 0–100 normalized recovery/readiness. */
  readonly recoveryScore: number | null;
  /** 0–21 WHOOP-style day strain (normalized for other sources). */
  readonly strain: number | null;
}

/* ─────────────────── Debrief wire format (v1.1.0, D-6) ─────────────────── */

/**
 * Body of POST /functions/v1/voice-debrief. The prompt is built SERVER-side from these
 * whitelisted numbers/enums only; no ids, names or free text cross the wire (SEC-5).
 * A body with a `system` or `user` key is rejected with 400 legacy_prompt_rejected.
 */
export type DebriefDrillMetrics =
  | {
      readonly drill: 'ball_mastery';
      readonly touches: number;
      readonly touchesPerMinute: number;
      readonly footBalance: number;
      readonly rhythmCv: number;
      readonly hipSway: number;
    }
  | {
      readonly drill: 'agility_shuttle';
      readonly totalTimeS: number;
      readonly legs: number;
      readonly peakSpeedMps: number;
      readonly meanTurnTimeMs: number;
      readonly splitCv: number;
      readonly fatigueIndex: number;
    };

/** Wearable summary as sent to the debrief. Strava can never appear here (SEC-6). */
export interface DebriefWearable {
  readonly source: IngestionSource;
  readonly date: string; // YYYY-MM-DD
  readonly restingHr: number | null;
  readonly hrv: number | null;
  readonly sleepMin: number | null;
  readonly recovery: number | null;
  readonly strain: number | null;
}

export interface DebriefRequest {
  readonly v: 2;
  readonly persona: CoachPersona;
  readonly metrics: DebriefDrillMetrics;
  readonly ovr: {
    readonly value: number;
    readonly band: RatingBand;
    readonly position: PlayerPosition;
    readonly attributes: AttributeVector;
  };
  readonly badges: readonly BadgeId[];
  /** Name must match ^[A-Za-z][A-Za-z .'-]{0,39}$ server-side. */
  readonly archetype: { readonly name: string; readonly similarity: number } | null;
  readonly wearables: readonly DebriefWearable[];
}

export type DebriefFailureReason =
  | 'monthly_cap'
  | 'refused'
  | 'invalid_request'
  | 'invalid_source'
  | 'legacy_prompt_rejected'
  | 'body_too_large'
  | 'unauthorized'
  | 'rate_limited'
  | 'llm_error';

/**
 * HTTP: 200 ok | 200 monthly_cap | 200 refused | 400 invalid_request, invalid_source,
 * legacy_prompt_rejected | 401 unauthorized | 405 | 413 body_too_large | 429 rate_limited | 502 llm_error.
 */
export type DebriefResponse =
  | {
      readonly ok: true;
      readonly text: string;
      readonly audioUrl: string | null;
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly ok: false; readonly reason: DebriefFailureReason };

/* ───────────────────────────── Highlights ───────────────────────────── */

export interface HighlightWindow {
  readonly startMs: number;
  readonly endMs: number;
  /** Number of touches (or legs) inside the window. */
  readonly eventCount: number;
}

export type ShareTarget = 'instagram_stories' | 'instagram_reels' | 'tiktok';
