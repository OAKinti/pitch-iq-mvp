# SPRINT_STATE — PitchIQ 7-Day Sprint (Nov 22 – Nov 29, 2026)

> Parse rules (used by `/next-sprint-day` and cloud routines): task lines match
> `^- \[( |x)\] (\[HUMAN GATE \d+\] )?(.*)$`. Each `## Track:` section is parsed on its own: its
> first unchecked task is that track's "next", and an unchecked `[HUMAN GATE N]` above it in the same track =
> **BLOCKED** for that track only. Unchecked gates under `## Gates` block every track. Cloud routines use only
> `## Track: software`. Tags: `[device]` needs a phone/simulator · `[local-only]` needs the Windows
> workstation/MCP · `[secret:NAME]` needs env var NAME. Only humans tick HUMAN GATE lines. Day 1 history:
> `docs/SPRINT_LOG.md`.
> `[human:A]` / `[human:B]` = owned by Person A/B; agents and cloud routines skip the line (never execute or tick it).
> An agent line containing `after Dx.y[, Dx.z]` is blocked until every named task is ticked on `main`; skip to the next runnable line.

## Status
- **Current day:** Day 1 complete — waiting at HUMAN GATE 1
- **Next task:** HUMAN GATE 1 — review and merge PR `claude/day-1-mvp` → `main` on GitHub
- **Branch policy:** agents → `claude/*`, humans → `feat/*`, `main` human-merged only

## Gates (block every track)
- [ ] [HUMAN GATE 1] Owner: merge `claude/day-1-mvp` → `main` on GitHub; activate both routines per `docs/CLOUD_ROUTINES_SETUP.md`; send repo to collaborator; install `uv` and confirm `uv tool run --python 3.12 build123d-mcp@latest --version` works; decide shield base curve (see Decisions D-3)

## Track: software
### Day 2–3 — Mon–Tue Nov 23–24
- [ ] D2.0 [human:A] Prereq PR `feat/d2-0-prereq` (Person A accepts D-5, Person B accepts D-6): `npx expo install expo-dev-client expo-build-properties expo-audio @shopify/react-native-skia react-native-svg expo-mediapipe-pose@0.5.2`; app.json plugins (dev-client, build-properties android minSdkVersion 26, expo-audio no record/background); `eas.json` development profile; jest.setup.js mocks (skia, expo-audio, expo-mediapipe-pose); contract v1.1.0 (DebriefRequest/Response types, migration 003 quota RPCs, INTERFACE_CONTRACTS, CONTRACT_VERSION); CLAUDE.md CV-slice row; `[human:*]`/`after` parse rules; verify + expo-doctor + export android/ios
- [ ] D2.1a after D2.0: `PoseSourceProvider` in `src/services/cv/` (toPoseFrame + sanitize, mock + mediapipe providers, selectPoseSource, stall watchdog, FpsMeter, lazy mediapipe binding + `MediapipePoseView`) with tests; brief `.agenticverse/briefs/D2.1a.brief.md`
- [ ] D2.2a after D2.0: `projectSkeleton` in `src/domain/pose/` (100 % coverage) + Skia `SkeletonOverlay` (+ web fallback) in `src/components/`; brief `.agenticverse/briefs/D2.2a.brief.md`
- [ ] D2.3a after D2.0: Realtime rejoin - `subscribeToGroup` re-fetches members on every SUBSCRIBED; fake-channel tests; brief `.agenticverse/briefs/D2.3a.brief.md`
- [ ] D2.4a after D2.0: expo-audio `CuePlayer` (duckOthers, pre-warm, latest-wins) in `src/services/audio/` + `planCueClips` + `scripts/generate-cue-audio.ts --dry-run`; brief `.agenticverse/briefs/D2.4a.brief.md`
- [ ] D2.5a after D2.0: server-side debrief prompt (`supabase/functions/_shared/voiceCore.ts`, voice-debrief v2, voice-qa), client `buildDebriefRequest` + transport v2, pgTAP test for migration 003; brief `.agenticverse/briefs/D2.5a.brief.md`
- [ ] D2.2b after D2.1a, D2.2a, D2.4a: wire PoseSource + SkeletonOverlay + CuePlayer into `useDrillRunner`/`CombineDrillScreen`/`AppStateContext`, services barrel, testIDs `skeleton-overlay`/`telemetry-fps`/`pose-source`; ui-qa-verifier pass; brief `.agenticverse/briefs/D2.2b.brief.md`
- [ ] D2.1 [human:A] [device] Person A `feat/native-cv-camera`: right after D2.0 merges run `eas build --profile development` (android, then ios) and install the Dev Client; after D2.2b confirm live MediaPipe landmarks through `PoseSourceProvider`, landmarks 1–10 zeroed in a debug dump, permission-denied notice
- [ ] D2.2 [human:A] [device] Person A: Skia skeleton overlay + framing HUD on a physical phone, front and back camera alignment; measure on-device FPS via `telemetry-fps` (target ≥ 24 over a 30 s Ball Mastery drill, DEV-1); paste numbers in the session log
- [ ] D2.3 [human:B] [secret:EXPO_PUBLIC_SUPABASE_URL] Person B `feat/supabase-voice-polish`: create Supabase project, `supabase db push` migrations 001+002+003, enable pg_cron, `supabase test db` (pgTAP), set edge secrets, deploy `voice-debrief` + `voice-qa` + `purge-raw-video` (after D2.5a), switch app out of Demo Mode, Realtime group channel reaches SUBSCRIBED
- [ ] D2.4 [human:B] [local-only] [secret:ELEVENLABS_API_KEY] Person B: after D2.4a run `npx --yes tsx scripts/generate-cue-audio.ts` → 39 cached cue clips (13 cues × 3 personas) in `assets/audio/cues/` + regenerated `src/services/audio/cueSources.ts`; listen-check ducking on a device
- [ ] D2.5 [human:B] [secret:EXPO_PUBLIC_SUPABASE_URL] Person B: after D2.3 run live DEV-2 checks on the deployed functions (legacy `{system,user}` body → 400, strava wearable → 400, monthly-cap refusal, `voice-qa` grants 0 at cap) and approve the server prompt wording

### Day 4 — Wed Nov 25
- [ ] D4.1 [secret:EXPO_PUBLIC_SUPABASE_URL] Live Haiku 5.5 + ElevenLabs Flash debrief end-to-end; log real cost per debrief vs `costModel.ts`
- [ ] D4.2 [device] Two-device Group Session leaderboard sync test (Realtime)

### Day 5 — Thu Nov 26 (Thanksgiving, light)
- [ ] D5.1 [device] `ui-qa-verifier` + Maestro MCP smoke on simulator: spacing, dark-mode contrast, Reanimated transitions, audio ducking; fix visual defects

### Day 6 — Fri Nov 27
- [ ] D6.1 [device] Native `ffmpeg-kit` 15 s peak-streak clip (`-movflags +faststart`) using `buildHighlightClipArgs`; verify output with `ffprobe` (h264/aac/yuv420p/progressive/faststart)
- [ ] D6.2 [device] 640×480 transparent OVR sticker PNG (view-shot) + Instagram Stories/Reels pasteboard + TikTok Share Kit v2 handoff

### Day 7 — Sat–Sun Nov 28–29 (field test & release)
- [ ] D7.1 [device] Outdoor grass/turf video: calibrate Butterworth cutoff + drill thresholds in `soccer-cv-math` and tests
- [ ] D7.2 `code-scout` bug triage; `security-privacy-auditor` read-only audit (RLS, COPPA, BIPA, Strava, secrets) — fix all Critical/High
- [ ] D7.3 [device] Full Maestro smoke suite green
- [ ] D7.4 [secret:EXPO_TOKEN] EAS build → TestFlight internal + Play Internal App Sharing
- [ ] [HUMAN GATE 3] Owner: field-test sign-off on the pitch; MVP release go/no-go

## Track: hardware (local only)
### Day 1B / Day 2 AM — Sun night – Mon Nov 23 before 9:00 AM
- [ ] H1 [local-only] Rev-0.1: `cad-engineer` + `eyewear-cad-rulebook` builds the 4-part shield (frame, temple L/R, TPU bumper) from `hardware/glasses/params.py`; iso/front/side/top PNGs inspected; `validate()` on every part
- [ ] H2 [local-only] Rev-0.2: fix Rev-0.1 findings; export `assembly.step`, 4 STLs, `lens_flat_pc2mm.dxf`, `PRINT_ORDER.md` to `hardware/glasses/exports/rev-0.2/`
- [ ] [HUMAN GATE 2] Owner: submit SLS Nylon 11 (frame, temples) + TPU 90A (bumper) job to Penn State OriginLabs, 123 S. Burrowes St., Mon Nov 23 9:00 AM (separate powders ⇒ separate builds); buy 2.0 mm clear PC sheet + coupon for 24 h bend test

### Day 4 / Day 6
- [ ] D4.3 [local-only] Pick up OriginLabs print; assemble with 2.0 mm PC; record fit notes in `hardware/glasses/CHANGELOG.md`
- [ ] D6.3 [local-only] Rev-0.3 CAD tweaks if foam-headform ball-impact test shows stress points

## Decisions
- D-1 (Nov 22) Navigation is a zero-dependency typed stack in `src/navigation/` (no React Navigation) to keep Expo Go compatibility on Day 1; revisit if deep links are needed.
- D-2 (Nov 22) Voice debrief keys live only in Supabase edge-function secrets; client sends metrics-only prompts; server enforces 6 000-char prompt and 16 000 TTS-char/month caps.
- D-3 (Nov 22) **OPEN — owner decides before H1:** a 6-base (R 88.3 mm) cylinder gives 20.9° wrap at a 63 mm PD (target 15–18°) and 1.13 % lens strain (cold-curve guideline R ≥ 200 mm for 2 mm PC). 5-base gives 17.3° / 0.94 %. Default stays 6-base as specified. Run `python hardware/glasses/params.py` for live numbers.
- D-4 (Nov 22) Upstream `ffmpeg-kit` was retired in 2025 (binaries pulled). D6.1 must pick a maintained fork or a native AVFoundation/MediaCodec path; command builders are library-agnostic.
- D-5 (Nov 24) **PROPOSED — Person A decides before D2.0:** Day 2–3 live pose uses `expo-mediapipe-pose@0.5.2` (Expo Module wrapping native MediaPipe Pose Landmarker; own camera session; peer `react-native-svg ^15.15.4`) instead of a `react-native-vision-camera` frame processor → MediaPipe, because the v3/v4 MediaPipe frame-processor plugins do not build against vision-camera v5. vision-camera 5.2.4 (+ -worklets, -resizer, nitro-modules 0.37.2, nitro-image 0.15.2) is deferred to D6.1 recording, which must solve the single-camera-session constraint (never mount two camera sessions). Skia stays `@shopify/react-native-skia` 2.14.0.
- D-6 (Nov 24) **PROPOSED — Person B decides before D2.0:** contract v1.1.0. The debrief prompt is built server-side (`voice-debrief` accepts only `DebriefRequest` v2 and rejects `{system,user}`), `DebriefTransport.requestDebrief(request)` replaces `(prompt, persona)`, `buildDebriefPrompt` is removed from the client barrel, and migration `003_voice_usage_rpc.sql` adds service-role-only RPCs `reserve_debrief_chars`, `refund_debrief_chars`, `consume_qa_seconds` (atomic 16 000-char and 300–600 s monthly caps).

## Blockers
- ~~B-1~~ Resolved Nov 22: owner created private repo `OAKinti/pitch-iq-mvp`; `main` is the default branch.
- B-2 (Owner) `uv` not installed — required for `build123d-mcp` (hardware track H1/H2).

## Contract changes
- v1.0.0 frozen Nov 22.

## Cold start (any machine / cloud)
1. `git clone https://github.com/OAKinti/pitch-iq-mvp.git && cd pitch-iq-mvp && npm ci`
2. `cp .env.example .env` (Demo Mode needs no keys)
3. `npm run verify` → must exit 0; `npm run test:hooks` → must exit 0
4. `npx expo start` → Expo Go (mock pose "Simulate Live Drill" works without camera)

## Session log
<!-- newest first; see .claude/skills/sprint-handoff/SKILL.md -->
### 2026-11-22 — local (Opus 5.5) — claude/day-1-mvp
- Did: created remote `main` at empty root commit `fd96ec6` (via GitHub API, no code on main), set `main` as default branch, opened Day 1 PR. No Day 2 work started.
- Next: owner reviews + merges the PR (HUMAN GATE 1).
