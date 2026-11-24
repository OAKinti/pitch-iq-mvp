# Interface Contracts (FROZEN — v1.1.0, Nov 24 2026; v1.0.0 Nov 22)

Types live in [`src/types/contracts.ts`](../src/types/contracts.ts). Tokens live in
[`src/theme/tokens.ts`](../src/theme/tokens.ts). Schema lives in
[`supabase/migrations/001_initial_schema.sql`](../supabase/migrations/001_initial_schema.sql).

Changing a frozen signature requires: (1) update this file, (2) bump `CONTRACT_VERSION`,
(3) note it in `SPRINT_STATE.md` → *Contract changes*. Adding new exports is fine.

## Slice ownership (non-overlapping)

| Slice | Owns | Imports allowed |
|---|---|---|
| A — Domain | `src/domain/**`, `src/__tests__/domain/**` | `src/types` only |
| CV (Person A) | `src/services/cv/**`, `src/__tests__/services/cv/**` | as B; the ONLY place that imports `expo-mediapipe-pose`; emits sanitized `PoseFrame` only |
| B — Services | `src/services/**` (except `cv/`), `src/__tests__/services/**`, `supabase/functions/**` | `src/types`, `src/domain` (types + pure fns), `src/theme/tokens.ts` (share colors only) |
| C — UI | `src/components/**`, `src/screens/**`, `src/navigation/**`, `src/state/**`, `src/__tests__/ui/**` | everything above via the `src/domain` and `src/services` barrels |

No slice edits `package.json`, `src/types/**`, `src/theme/**`, or migrations. Need a change? Stop and report it.

## Slice A — `src/domain/index.ts` barrel must export

```ts
// filters/butterworth.ts
export interface BiquadCoefficients { b0: number; b1: number; b2: number; a1: number; a2: number }
export function designButterworthLowpass(cutoffHz: number, sampleRateHz: number, passes?: 1 | 2): BiquadCoefficients;
export function filtfilt(signal: readonly number[], c: BiquadCoefficients): number[];
export function zeroPhaseLowpass(signal: readonly number[], opts?: { cutoffHz?: number; sampleRateHz?: number }): number[]; // defaults 8 Hz, 30 Hz
export interface StreamingFilter { step(x: number): number; reset(): void }
export function createStreamingLowpass(cutoffHz: number, sampleRateHz: number): StreamingFilter; // causal, live telemetry

// drills/*
export const DEFAULT_BALL_MASTERY_CONFIG: BallMasteryConfig;
export const DEFAULT_AGILITY_SHUTTLE_CONFIG: AgilityShuttleConfig;
export function createBallMasteryEngine(config?: Partial<BallMasteryConfig>): DrillEngine;
export function createAgilityShuttleEngine(config?: Partial<AgilityShuttleConfig>): DrillEngine;
export function createDrillEngine(type: DrillType): DrillEngine;

// rating/*
export const NEUTRAL_ATTRIBUTE: 50;
export const POSITION_WEIGHTS: Readonly<Record<PlayerPosition, AttributeVector>>; // each sums to 1
export function deriveAttributes(metrics: readonly DrillMetrics[]): AttributeVector;
export function compressEliteBand(raw: number): number;
export function computeOvr(attributes: AttributeVector, position: PlayerPosition): OvrResult;
export const BADGE_CATALOG: Readonly<Record<BadgeId, Badge>>;
export function evaluateBadges(metrics: readonly DrillMetrics[]): Badge[];
export const PRO_ARCHETYPES: readonly Archetype[];
export function cosineSimilarity(a: AttributeVector, b: AttributeVector): number;
export function matchArchetypes(attributes: AttributeVector, k?: number): ArchetypeMatch[]; // default k = 3

// session/*
export function classifyAge(birthYear: number, birthMonth: number, now: Date): AgeBracket | null;
export function defaultVisibility(bracket: AgeBracket): ProfileVisibility;
export function requiresParentalConsent(bracket: AgeBracket): boolean;
export function computeCrowns(members: readonly GroupMemberStat[], now: Date): Crowns;
export function computeRivalry(me: GroupMemberStat, rival: GroupMemberStat): RivalryObjective;

// highlights/peakStreak.ts
export function selectPeakStreakWindow(eventTimestampsMs: readonly number[], totalDurationMs: number, windowMs?: number): HighlightWindow; // default 15_000

// mock/mockPoseGenerator.ts
export type MockScenario = 'idle' | 'ball_mastery' | 'agility_shuttle';
export interface MockPoseOptions {
  scenario: MockScenario; seed?: number; fps?: number; startDelayMs?: number; noise?: number;
  touchesPerSecond?: number;          // ball_mastery, default 2.5 (alternating L/R)
  legs?: number; legDurationMs?: number; // agility_shuttle, defaults 6 and 1600
  outOfFrameWindowMs?: readonly [number, number]; // visibility drops to 0.1 inside
}
export interface MockPoseStream { next(): PoseFrame; reset(): void; readonly fps: number }
export function createMockPoseStream(options: MockPoseOptions): MockPoseStream;
export function generateFrames(options: MockPoseOptions, count: number): PoseFrame[];
```

All formulas, thresholds and anchor tables: `.claude/skills/soccer-cv-math/SKILL.md`.

## Slice B — `src/services/index.ts` barrel must export

```ts
// config.ts
export interface AppConfig { demoMode: boolean; supabaseUrl: string | null; supabaseAnonKey: string | null }
export function getAppConfig(env?: Record<string, string | undefined>): AppConfig; // demo when keys missing or EXPO_PUBLIC_DEMO_MODE=true

// supabase/*
export function getSupabaseClient(config: AppConfig): SupabaseClient | null; // null in demo mode
export interface PitchIqRepository {
  saveDrillResult(userId: string, result: DrillResult, ovr: OvrResult): Promise<void>;
  recordConsent(userId: string, consent: ConsentRecord): Promise<void>;
  listGroupMembers(groupId: string): Promise<GroupMemberStat[]>;
  subscribeToGroup(groupId: string, onChange: (members: GroupMemberStat[]) => void): () => void;
}
export function createRepository(config: AppConfig): PitchIqRepository; // DemoRepository (seeded, in-memory) or SupabaseRepository
export const DEMO_GROUP_ID: string;

// voice/*
export const PERSONAS: Readonly<Record<CoachPersona, { label: string; tagline: string; elevenLabsVoiceEnv: string }>>;
export function getCachedCue(id: CueId, persona: CoachPersona): CachedCue;          // Tier 1
export const DEBRIEF_MAX_CHARS: 400;
export const TTS_USD_PER_1K_CHARS: 0.04;
export const HAIKU_MODEL_ID: 'claude-haiku-5-5';
export function estimateDebriefCostUsd(ttsChars: number, inputTokens: number, outputTokens: number): number;
export interface DebriefInput { persona: CoachPersona; result: DrillResult; ovr: OvrResult; badges: readonly Badge[]; topArchetype?: ArchetypeMatch; wearables?: readonly WearableDailySummary[] }
export function buildDebriefRequest(input: DebriefInput): DebriefRequest; // v1.1.0 (D2.5a): replaces buildDebriefPrompt (removed from barrel); throws on non-AI-safe sources
export function templateDebrief(input: DebriefInput): string; // zero-key Demo Mode, ≤ DEBRIEF_MAX_CHARS
export const DEBRIEF_TIMEOUT_MS: 12_000; // v1.1.0
export interface DebriefTransport { requestDebrief(request: DebriefRequest): Promise<{ text: string; audioUri: string | null; inputTokens: number; outputTokens: number }> }
export function createEdgeFunctionTransport(client: SupabaseClient): DebriefTransport;
export interface QaBudget { readonly capSeconds: number; remainingSeconds(): number; canStart(): boolean; consume(seconds: number): number }
export function createQaBudget(opts: { capMinutes: number; usedSeconds?: number }): QaBudget; // capMinutes clamped to [5, 10]
export interface VoiceCoach { readonly persona: CoachPersona; cue(id: CueId): CachedCue; debrief(input: DebriefInput): Promise<Debrief>; readonly qa: QaBudget }
export function createVoiceCoach(opts: { persona: CoachPersona; transport: DebriefTransport | null; qaCapMinutes?: number }): VoiceCoach; // transport null ⇒ template debriefs

// wearables/*
export interface IngestionAdapter { readonly source: IngestionSource; isAvailable(): Promise<boolean>; fetchDailySummaries(fromDate: string, toDate: string): Promise<WearableDailySummary[]> }
export function createHealthKitAdapter(): IngestionAdapter;      // Day 1 stub: isAvailable() → false
export function createHealthConnectAdapter(): IngestionAdapter;  // Day 1 stub: isAvailable() → false
export function createWhoopAdapter(opts: { fetchJson: (path: string) => Promise<unknown> | null }): IngestionAdapter;
export function mapWhoopRecovery(payload: unknown): WearableDailySummary[];
export function assertAiSafeSources(records: readonly { source: string }[]): void; // throws if any source ∉ IngestionSource
export interface ExportAdapter { readonly destination: 'strava'; exportDrill(result: DrillResult): Promise<{ remoteId: string | null }> }
export function createStravaExportAdapter(opts: { accessToken: string; post: (url: string, body: unknown, headers: Record<string, string>) => Promise<{ id?: number | string }> }): ExportAdapter;
export function buildStravaActivityPayload(result: DrillResult): Record<string, string | number>;

// share/*
export const INSTAGRAM_EXPORT_SPEC: { videoCodec: 'libx264'; audioCodec: 'aac'; pixelFormat: 'yuv420p'; width: 1080; height: 1920; fps: 30; maxDurationSec: 15 };
export const STICKER_SPEC: { width: 640; height: 480; format: 'png'; transparent: true };
export function buildHighlightClipArgs(opts: { inputPath: string; outputPath: string; window: HighlightWindow }): string[];
export function toFfmpegCommand(args: readonly string[]): string; // quotes paths with spaces
export interface PasteboardShare { url: string; pasteboardItems: Record<string, string>[]; expirationSeconds: number }
export function buildInstagramStoriesShare(opts: { facebookAppId: string; videoUri: string; stickerUri: string }): PasteboardShare;
export function buildInstagramReelsShare(opts: { facebookAppId: string; videoUri: string; stickerUri: string }): PasteboardShare;
export interface TikTokShareRequest { mediaType: 'video'; mediaPaths: string[]; shareFormat: 'normal' | 'green_screen'; redirectUri: string; clientKey: string }
export function buildTikTokShareRequest(opts: { clientKey: string; redirectUri: string; mediaPath: string }): TikTokShareRequest;
```

## Slice C — screens & testIDs

Screens (all in `src/screens/`), each with a root `testID`:

| Screen | Root testID | Required child testIDs |
|---|---|---|
| `OnboardingScreen` | `screen-onboarding` | `age-year-input`, `age-month-input`, `age-continue`, `consent-checkbox`, `consent-accept`, `persona-option-<persona>`, `position-option-<pos>`, `onboarding-finish` |
| `CombineDrillScreen` | `screen-combine` | `drill-option-ball_mastery`, `drill-option-agility_shuttle`, `simulate-toggle`, `skeleton-overlay`, `telemetry-fps`, `pose-source` (v1.1.0, D2.2b), `telemetry-phase`, `telemetry-count`, `telemetry-rate`, `telemetry-timer`, `cue-caption`, `drill-start`, `drill-view-results` |
| `OVRCardScreen` | `screen-ovr` | `ovr-value`, `ovr-band`, `attr-<key>`, `badge-<id>`, `archetype-0`, `debrief-text`, `ovr-share`, `ovr-group` |
| `GroupSessionScreen` | `screen-group` | `leaderboard-row-<userId>`, `crown-performance`, `crown-consistency`, `rivalry-objective` |
| `HighlightShareScreen` | `screen-highlight` | `highlight-window`, `ffmpeg-command`, `share-instagram_stories`, `share-instagram_reels`, `share-tiktok` |

Navigation: `src/navigation/AppNavigator.tsx` exports `AppNavigator` and `type RouteName`.
App state: `src/state/AppStateContext.tsx` (onboarding profile, consents, latest results, OVR).
Gate: the Combine screen must refuse to start tracking until `camera_skeletal_tracking` consent exists.

## v1.1.0 additions (Nov 24, D-5 / D-6 / D-7) — full signatures in `.agenticverse/sprint_contract.json` → `interfaces`

**`src/types/contracts.ts`** (frozen): `DebriefDrillMetrics`, `DebriefWearable`, `DebriefRequest` (`v: 2`), `DebriefFailureReason`, `DebriefResponse`; `CONTRACT_VERSION = 1.1.0`.

**CV slice — `src/services/cv/index.ts` barrel** (D2.1a): `PoseSourceProvider`, `PoseSourceError`, `PoseSourceStats`, `POSE_STALL_MS`, `RawPoseResult`, `toPoseFrame`, `PoseClock`, `PoseSourceUnavailableReason`, `createMockPoseSource`, `createMediapipePoseSource`, `selectPoseSource`, `isMediapipeAvailable`, `MediapipePoseView` (+ `MediapipePoseViewProps`), `FpsMeter`, `createFpsMeter`.

**Domain — `src/domain/index.ts`** (D2.2a): `SKELETON_BONES`, `ProjectedJoint`, `ProjectedBone`, `ProjectedSkeleton`, `projectSkeleton`.

**Components** (D2.2a): `SkeletonOverlay` (+ `.web.tsx` fallback), default testID `skeleton-overlay`.

**Audio — `src/services/audio/index.ts`** (D2.4a): `CueAudioSource`, `CueSourceMap`, `AudioPlayerLike`, `CuePlayerDeps`, `CuePlayer`, `CUE_AUDIO_MODE`, `createCuePlayer`, `CUE_AUDIO_SOURCES`, `CueClipPlan`, `planCueClips`, `renderCueSourcesModule`.

**Voice** (D2.5a): `buildDebriefRequest`, `DEBRIEF_TIMEOUT_MS`, `DebriefTransport` v2; `buildDebriefPrompt` removed from the barrel. Server: `supabase/functions/_shared/voiceCore.ts` (`parseDebriefRequest`, `buildServerPrompt`, `handleDebrief`, `handleQa`), `voice-debrief` v2 and `voice-qa` HTTP.

**Schema — `supabase/migrations/003_voice_usage_rpc.sql`** (frozen): `reserve_debrief_chars(uuid, int, int default 16000) → date`, `refund_debrief_chars(uuid, date, int)`, `consume_qa_seconds(uuid, int, int default 300) → (granted, remaining)`. SECURITY DEFINER, `search_path = `, execute granted to `service_role` only.

**Native packages (D2.0)**: `expo-dev-client`, `expo-build-properties` (android minSdk 26), `expo-audio`, `@shopify/react-native-skia`, `react-native-svg`, `expo-mediapipe-pose@0.5.2` (D-5); `expo-camera`, `expo-file-system`, `expo-media-library`, `react-native-view-shot`, `react-native-share` (D-7). Global jest mocks for Skia, expo-audio and expo-mediapipe-pose live in `jest.setup.js`; builders never edit it.

**Group sync (D4.2a)**: `SupabaseRepository.listGroupMembers` returns ascending `userId` order; `subscribeToGroup` delivers latest-wins snapshots (CON-5..CON-8).

**Highlight (D6.1a)** — `src/services/highlight/index.ts`: `HIGHLIGHT_CLIP_SPEC`, `buildClipEncodeRequest`, `isValidClipRequest`, `ClipEncoder`/`ClipEncodeRequest`/`ClipEncodeResult`/`ClipEncodeFailure`, `CLIP_DURATION_SLACK_MS`, `createNativeClipEncoder`, `isHighlightEncoderAvailable`, `NativeHighlightEncoder`, `createHighlightClipService`, `ClipFiles`/`HighlightClipResult`/`HighlightClipService`, `createExpoClipFiles`, `CAMERA_TEARDOWN_MS`, `CAMERA_TEARDOWN_TIMEOUT_MS`, `createCameraModeController` (+ `CameraMode*`, `MountedCamera` types). Only `highlightEncoderBinding.ts` references `modules/highlight-encoder`.
