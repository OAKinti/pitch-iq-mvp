# Collaborator Setup — PitchIQ MVP

Two people, seven days. Work is split by **vertical ownership**, so you rarely touch the same files.

| | Person A — Native CV + CAD | Person B — Live backend + Voice + UI polish |
|---|---|---|
| Owns | `src/cv/` (new), `app.json` plugins, `eas.json`, `hardware/glasses/` | `supabase/`, `src/services/`, `assets/audio/`, `src/screens/` polish |
| Branch | `feat/native-cv-camera` | `feat/supabase-voice-polish` |
| Needs | A physical phone (iOS or Android), `uv` for CAD, an Expo account | A Supabase project, ElevenLabs + Anthropic API keys |
| Days 2–3 | Vision Camera → MediaPipe Pose → `PoseFrame`; Skia overlay | Live Supabase, Realtime groups, 39 cached voice cues |
| Day 4 | Fit check of the printed glasses | Live Haiku + ElevenLabs debriefs, two-device sync |
| Day 6 | Native FFmpeg clip + share handoff | Visual polish, share-screen UX |

## 1. One-time setup (both)
1. Install **Node 22+**, **Git** and **VS Code**. On Windows, also install Git for Windows (Git Bash).
2. Clone and verify:
   ```bash
   git clone https://github.com/OAKinti/pitch-iq-mvp.git
   cd pitch-iq-mvp
   npm ci
   cp .env.example .env
   npm run verify        # must end with exit code 0
   npm run test:hooks    # Claude Code hook self-test
   ```
3. Install Claude Code, run `claude` in the repo, and accept the project settings and `build123d` MCP server. `CLAUDE.md`, skills, agents and hooks load automatically.
4. Run `npx expo start`, scan the QR code with **Expo Go**, finish onboarding, and toggle **Simulate Live Drill**.

## 2. Daily loop
1. `git checkout main && git pull`, then `git checkout -b feat/<your-area>` (or continue your branch).
2. In Claude Code, run `/next-sprint-day` to resume the plan, or describe your task. Claude reads `SPRINT_STATE.md` first.
3. Before pushing: run `npm run verify`. It must exit 0, and the Stop hook also blocks on type errors.
4. Push your `feat/*` branch and open a PR into `main`. The **PR Gatekeeper** routine posts a PASS/FAIL comment. The other person reviews and merges.
5. Update `SPRINT_STATE.md` (skill `sprint-handoff`): tick what passed and log commands with exit codes.

## 3. Rules that protect the product
- **Never commit `.env`** or put secrets in `EXPO_PUBLIC_*`. Server keys go in `supabase secrets set ...`.
- **Contracts are frozen.** Changing `src/types/contracts.ts`, `tokens.ts` or the migrations requires a note in `docs/INTERFACE_CONTRACTS.md` and a heads-up to the other person.
- **UI uses tokens only.** `npm run lint:tokens` fails on any hex color or magic number in screens and components.
- **No face or voice biometrics, ever.** Skeleton joints only.
- **Strava is export-only.** Never read Strava data.
- **Never push to `main` directly.** Never force-push.

## 4. Person A quick links
- Camera: `react-native-vision-camera` with a frame processor, `pixelFormat="rgb"`, run through MediaPipe Pose Landmarker (Tasks Vision), 33 landmarks.
  Map the output to `PoseFrame` and call `sanitizePoseFrame()` before handing frames to `createDrillEngine()`. The drill math does not change.
- Requires a **Dev Client**: `npx expo install expo-dev-client`, then `npx eas-cli@latest build --profile development`. Expo Go cannot load these native modules.
- CAD: see `docs/MCP_SETUP.md` §1 and `.claude/skills/eyewear-cad-rulebook/SKILL.md`. Read **Decision D-3** in `SPRINT_STATE.md` before modelling.

## 5. Person B quick links
- Create the Supabase project. Run `supabase link`, `supabase db push` (migrations 001 + 002), then enable `pg_cron`.
- Deploy with `supabase functions deploy voice-debrief purge-raw-video`.
- Secrets: `supabase secrets set ANTHROPIC_API_KEY=... ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_CAPTAIN=... ELEVENLABS_VOICE_DRILL_SERGEANT=... ELEVENLABS_VOICE_HYPE=...`
- Put the URL and anon key in `.env` and set `EXPO_PUBLIC_DEMO_MODE=false`.
- Voice economics: Tier 1 cached cues cost $0. A Tier 2 debrief is at most 400 chars, about $0.016 of TTS. Tier 3 Q&A is capped at 5–10 min per month. Never stream live voice during drills.
