# SPRINT_STATE — PitchIQ 7-Day Sprint (Nov 22 – Nov 29, 2026)

> Parse rules (used by `/next-sprint-day` and cloud routines): task lines match
> `^- \[( |x)\] (\[HUMAN GATE \d+\] )?(.*)$`. The first unchecked task is "next".
> Any unchecked `[HUMAN GATE N]` above it = **BLOCKED** (no code edits). Tags:
> `[device]` needs a phone/simulator · `[local-only]` needs the Windows workstation/MCP ·
> `[secret:NAME]` needs env var NAME. Only humans tick HUMAN GATE lines.

## Status
- **Current day:** Day 1 complete — waiting at HUMAN GATE 1
- **Next task:** D1.5 push → then HUMAN GATE 1 (owner)
- **Branch policy:** agents → `claude/*`, humans → `feat/*`, `main` human-merged only

## Day 1 — Sun Nov 22 (software scaffold, executed in session 1)
- [x] D1.1 Standardize `main`, Expo SDK 58 TS strict app, npm deps, `.claude/` (skills, agents, hooks), `CLAUDE.md`, `.mcp.json`, `docs/MCP_SETUP.md`, `docs/CLOUD_ROUTINES_SETUP.md`, `SPRINT_STATE.md`
- [x] D1.2 Freeze `docs/INTERFACE_CONTRACTS.md`, `src/types/contracts.ts`, `src/theme/tokens.ts`, `supabase/migrations/001_initial_schema.sql`; checkpoint commit
- [x] D1.3a Slice A `src/domain/` — Butterworth, Ball Mastery + Agility Shuttle state machines, OVR/band/badges/archetypes, mock pose generator, 100 % coverage
- [x] D1.3b Slice B `src/services/` — Supabase + Demo Mode, 3-tier voice coach, wearable adapters + Strava write-only enforcement, FFmpeg/IG/TikTok builders
- [x] D1.3c Slice C `src/components/`, `src/screens/`, `src/navigation/` — 5 broadcast-HUD screens with testIDs, tokens only
- [x] D1.4 Merge slices, wire `App.tsx`, `.maestro/mvp-smoke.yaml`, ui-qa-verifier pass, `.env.example`, `README.md`, `COLLABORATOR_SETUP.md`
- [ ] D1.5 Push verified build to `claude/day-1-mvp`
- [ ] [HUMAN GATE 1] Owner: merge `claude/day-1-mvp` → `main` on GitHub; activate both routines per `docs/CLOUD_ROUTINES_SETUP.md`; send repo to collaborator; install `uv` and confirm `uv tool run --python 3.12 build123d-mcp@latest --version` works; decide shield base curve (see Decisions D-3)

## Day 1B / Day 2 AM — Sun night – Mon Nov 23 before 9:00 AM (hardware, local only)
- [ ] H1 [local-only] Rev-0.1: `cad-engineer` + `eyewear-cad-rulebook` builds the 4-part shield (frame, temple L/R, TPU bumper) from `hardware/glasses/params.py`; iso/front/side/top PNGs inspected; `validate()` on every part
- [ ] H2 [local-only] Rev-0.2: fix Rev-0.1 findings; export `assembly.step`, 4 STLs, `lens_flat_pc2mm.dxf`, `PRINT_ORDER.md` to `hardware/glasses/exports/rev-0.2/`
- [ ] [HUMAN GATE 2] Owner: submit SLS Nylon 11 (frame, temples) + TPU 90A (bumper) job to Penn State OriginLabs, 123 S. Burrowes St., Mon Nov 23 9:00 AM (separate powders ⇒ separate builds); buy 2.0 mm clear PC sheet + coupon for 24 h bend test

## Day 2–3 — Mon–Tue Nov 23–24
- [ ] D2.1 Person A `feat/native-cv-camera`: `app.json` plugins + `eas.json` dev profile for Expo Dev Client; `react-native-vision-camera` (`pixelFormat="rgb"`) frame processor → MediaPipe Pose Landmarker → `PoseFrame` (sanitized), behind a `PoseSource` provider that falls back to `mockPoseGenerator`
- [ ] D2.2 [device] Person A: Skia skeleton overlay + framing HUD on a physical phone; measure on-device FPS (target ≥ 24)
- [ ] D2.3 [secret:EXPO_PUBLIC_SUPABASE_URL] Person B `feat/supabase-voice-polish`: create Supabase project, apply migrations 001+002, enable pg_cron, deploy `voice-debrief` + `purge-raw-video`, switch app out of Demo Mode, Realtime group channel
- [ ] D2.4 [local-only] Person B: generate 39 cached ElevenLabs cue clips (13 cues × 3 personas) → `assets/audio/cues/`, fill `CUE_AUDIO_MANIFEST`, add `expo-audio` playback with ducking
- [ ] D2.5 Move debrief prompt construction server-side (edge function builds the prompt from metrics) and add Q&A cap enforcement in `voice_usage` (Tier 3)

## Day 4 — Wed Nov 25
- [ ] D4.1 [secret:EXPO_PUBLIC_SUPABASE_URL] Live Haiku 5.5 + ElevenLabs Flash debrief end-to-end; log real cost per debrief vs `costModel.ts`
- [ ] D4.2 [device] Two-device Group Session leaderboard sync test (Realtime)
- [ ] D4.3 [local-only] Pick up OriginLabs print; assemble with 2.0 mm PC; record fit notes in `hardware/glasses/CHANGELOG.md`

## Day 5 — Thu Nov 26 (Thanksgiving, light)
- [ ] D5.1 [device] `ui-qa-verifier` + Maestro MCP smoke on simulator: spacing, dark-mode contrast, Reanimated transitions, audio ducking; fix visual defects

## Day 6 — Fri Nov 27
- [ ] D6.1 [device] Native `ffmpeg-kit` 15 s peak-streak clip (`-movflags +faststart`) using `buildHighlightClipArgs`; verify output with `ffprobe` (h264/aac/yuv420p/progressive/faststart)
- [ ] D6.2 [device] 640×480 transparent OVR sticker PNG (view-shot) + Instagram Stories/Reels pasteboard + TikTok Share Kit v2 handoff
- [ ] D6.3 [local-only] Rev-0.3 CAD tweaks if foam-headform ball-impact test shows stress points

## Day 7 — Sat–Sun Nov 28–29 (field test & release)
- [ ] D7.1 [device] Outdoor grass/turf video: calibrate Butterworth cutoff + drill thresholds in `soccer-cv-math` and tests
- [ ] D7.2 `code-scout` bug triage; `security-privacy-auditor` read-only audit (RLS, COPPA, BIPA, Strava, secrets) — fix all Critical/High
- [ ] D7.3 [device] Full Maestro smoke suite green
- [ ] D7.4 [secret:EXPO_TOKEN] EAS build → TestFlight internal + Play Internal App Sharing
- [ ] [HUMAN GATE 3] Owner: field-test sign-off on the pitch; MVP release go/no-go

## Decisions
- D-1 (Nov 22) Navigation is a zero-dependency typed stack in `src/navigation/` (no React Navigation) to keep Expo Go compatibility on Day 1; revisit if deep links are needed.
- D-2 (Nov 22) Voice debrief keys live only in Supabase edge-function secrets; client sends metrics-only prompts; server enforces 6 000-char prompt and 16 000 TTS-char/month caps.
- D-3 (Nov 22) **OPEN — owner decides before H1:** a 6-base (R 88.3 mm) cylinder gives 20.9° wrap at a 63 mm PD (target 15–18°) and 1.13 % lens strain (cold-curve guideline R ≥ 200 mm for 2 mm PC). 5-base gives 17.3° / 0.94 %. Default stays 6-base as specified. Run `python hardware/glasses/params.py` for live numbers.
- D-4 (Nov 22) Upstream `ffmpeg-kit` was retired in 2025 (binaries pulled). D6.1 must pick a maintained fork or a native AVFoundation/MediaCodec path; command builders are library-agnostic.

## Blockers
- (none open for agents until HUMAN GATE 1)

## Contract changes
- v1.0.0 frozen Nov 22.

## Cold start (any machine / cloud)
1. `git clone https://github.com/OAKinti/pitch-iq-mvp.git && cd pitch-iq-mvp && npm ci`
2. `cp .env.example .env` (Demo Mode needs no keys)
3. `npm run verify` → must exit 0; `npm run test:hooks` → must exit 0
4. `npx expo start` → Expo Go (mock pose "Simulate Live Drill" works without camera)

## Session log
<!-- newest first; see .claude/skills/sprint-handoff/SKILL.md -->
### 2026-11-22 11:40 ET — local (Opus 5.5 orchestrator + 3 Sonnet vertical-builders + Sonnet ui-qa-verifier) — main → claude/day-1-mvp
- Did: Expo SDK 58 scaffold; frozen contracts/tokens/schema; hooks/skills/agents/MCP; Slices A (domain), B (services), C (UI) built in parallel git worktrees and merged; docs; CAD params with spec checks.
- Verified (merged main): `npm run verify` → 0 [typecheck 0; jest 17 suites / 184 tests, coverage 100 % stmts/branches/funcs/lines; lint:tokens 0 violations; check:compliance 16/16]; `npm run test:hooks` → 0 (14/14); `npx expo-doctor` → 20/20; `npx expo export --platform android|ios` → 0 (1045/1047 modules, Hermes bundles); ui-qa-verifier → PASS, 0 blocking defects.
- Not verified: Maestro smoke (no simulator/MCP here); edge functions not executed (Deno, no live Supabase); SQL migrations not applied to a live Postgres (static checks only); no physical-device run.
- Notes: Claude Code `isolation: worktree` refused on Windows drive-letter casing (d: vs D:) — used manual `git worktree add` under `.claude/worktrees/` instead.
- Next: D1.5 push `claude/day-1-mvp`, then HUMAN GATE 1.
