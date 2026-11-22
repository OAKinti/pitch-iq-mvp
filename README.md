# PitchIQ — AI Soccer Coach (MVP)

PitchIQ uses the phone camera to track a player's skeleton during soccer drills, scores them on a
FIFA-style **OVR card**, matches them to a pro **archetype**, coaches them by **voice**, and turns their
best 15 seconds into a shareable **highlight**.

> **Status:** 7-day sprint, Nov 22–29 2026. See [`SPRINT_STATE.md`](SPRINT_STATE.md) for live progress.
> Day 1 runs fully in **Demo Mode**: no API keys and no camera, with simulated pose data at 30 FPS.

## Quick start
```bash
git clone https://github.com/OAKinti/pitch-iq-mvp.git
cd pitch-iq-mvp
npm ci
cp .env.example .env        # Demo Mode needs no keys
npm run verify              # typecheck + tests + token lint + compliance
npx expo start              # open in Expo Go, then toggle "Simulate Live Drill"
```

## What's inside
| Area | Path | What it does |
|---|---|---|
| Contracts | `src/types/contracts.ts` | Frozen `PoseFrame` (33 MediaPipe joints) and all shared types |
| Drill math | `src/domain/` | 8 Hz zero-phase Butterworth, Ball Mastery and Agility Shuttle state machines, OVR, badges, archetypes, mock pose generator |
| Services | `src/services/` | Supabase + Demo repository, 3-tier hybrid voice coach, wearables (HealthKit / Health Connect / WHOOP in, Strava export-only), FFmpeg + Instagram/TikTok share builders |
| UI | `src/screens/`, `src/components/` | Dark broadcast-HUD screens: Onboarding, Combine, OVR Card, Group Session, Highlight Share |
| Theme | `src/theme/tokens.ts` | The only place colors and sizes live |
| Database | `supabase/migrations/` | Postgres schema with row-level security on every table and a 90-day video TTL |
| Edge functions | `supabase/functions/` | `voice-debrief` (Claude Haiku 5.5 + ElevenLabs Flash), `purge-raw-video` |
| Hardware | `hardware/glasses/` | Parametric 3D-printable panoramic sports shield (build123d) |
| AI workflow | `.claude/`, `CLAUDE.md` | Skills, subagents, hooks for Claude Code and cloud routines |

## Privacy by design
- Only **skeletal joints** are processed. Face keypoints are redacted, and no faceprints or voiceprints are collected.
- The neutral age gate stores only an age bracket. Under-13 accounts are private by default and need parental verification.
- Camera tracking starts only after explicit consent. Raw video expires after **at most 90 days**.
- Strava is **export-only**. Strava data never feeds AI prompts or leaderboards, as Strava's 2026 API terms require.

## Scripts
| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript strict compile |
| `npm test` | Jest with coverage thresholds |
| `npm run lint:tokens` | Fails on raw colors or magic spacing in UI |
| `npm run check:compliance` | RLS, TTL, COPPA, BIPA, Strava, secrets invariants |
| `npm run test:hooks` | Self-test for the Claude Code hooks |
| `npm run verify` | All of the above except hooks |

New collaborator? Start with [`COLLABORATOR_SETUP.md`](COLLABORATOR_SETUP.md).
