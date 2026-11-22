# PitchIQ MVP — Claude Code project memory

Soccer-only AI sports coach (Expo React Native + Supabase + on-device pose CV + hybrid voice).
Two-person team; 7-day sprint Nov 22–29 2026. **Live sprint status: [`SPRINT_STATE.md`](SPRINT_STATE.md)** — read it first, every session.

## Stack (verify versions in package.json before using an API — Expo changes every SDK)
- Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 (`strict`, `noUncheckedIndexedAccess`)
- Reanimated 4 + worklets, Supabase JS v2, Jest 30 via `jest-expo`
- Docs: `https://docs.expo.dev/versions/v58.0.0/`, `https://docs.expo.dev/llms.txt`
- Add native deps ONLY with `npx expo install <pkg>`; native modules need a Dev Client (`npx expo prebuild` / EAS), not Expo Go.

## Verification commands (all must exit 0 before any commit is called "done")
```
npm run typecheck          # tsc --noEmit
npm test                   # jest --coverage (domain 100 %, services ≥ 85/90 %)
npm run lint:tokens        # no hex/rgba/magic spacing in src/screens + src/components
npm run check:compliance   # RLS, 90-day TTL, COPPA, BIPA, Strava write-only, secrets
npm run verify             # all four, in order
```

## Architecture boundaries
| Path | Owner slice | Notes |
|---|---|---|
| `src/types/contracts.ts` | frozen | change ⇒ update `docs/INTERFACE_CONTRACTS.md` + bump `CONTRACT_VERSION` |
| `src/theme/tokens.ts` | frozen | the only place raw colors/sizes live |
| `src/domain/**` | A | pure TS math, no React/timers/IO; skill `soccer-cv-math` |
| `src/services/**`, `supabase/functions/**` | B | IO behind interfaces; Demo Mode when keys absent |
| `src/components/**`, `src/screens/**`, `src/navigation/**`, `src/state/**` | C | tokens only; every interactive element has a `testID`; skill `design-tokens` |
| `supabase/migrations/**` | frozen | RLS on every table |
| `hardware/glasses/**` | CAD | skill `eyewear-cad-rulebook`, agent `cad-engineer` |

## Non-negotiables (enforced by tests + `check:compliance`)
1. **Soccer only** through Nov 29. Keep `sport` columns/types extensible, implement nothing else.
2. **Voice economics**: never stream live voice during drills. Tier 1 cached cues → Tier 2 Haiku 5.5 (`claude-haiku-5-5`) debrief + ElevenLabs Flash TTS via the `voice-debrief` edge function → Tier 3 Q&A hard-capped 5–10 min/month. Zero-key Demo Mode must always work.
3. **CV contract**: all drill math consumes `PoseFrame` only. `mockPoseGenerator` stays as the simulator/test fallback forever.
4. **Privacy**: skeletal joints only; face landmarks 1–10 redacted; no face/voice biometrics; neutral age gate (empty inputs); under-13 ⇒ private; consent screen before first camera use; raw video TTL ≤ 90 days.
5. **Strava is write-only**: never ingested, never in AI prompts or shared leaderboards. Ingestion = HealthKit / Health Connect / WHOOP via `IngestionAdapter` → `WearableDailySummary`.
6. **Highlights**: H.264 + AAC, `yuv420p`, progressive, `-movflags +faststart`; 640×480 transparent PNG sticker.
7. **Secrets**: only `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DEMO_MODE` may reach the client. Anthropic/ElevenLabs keys live in Supabase edge-function secrets.

## Workflow
- Branches: `main` (protected, human-merged), `claude/*` (agent work), `feat/*` (humans). Never push to `main`, never `--force`, never `sudo`.
- Windows-first: paths contain a space (`D:\company ideas\pitch-iq-mvp`) — always quote paths. Hooks are Node `.mjs` (cross-platform).
- Human gates: an unchecked `- [ ] [HUMAN GATE N]` in `SPRINT_STATE.md` blocks every later task. Agents stop there.
- Skills: `next-sprint-day` (resume the sprint), `sprint-handoff` (update state), `design-tokens`, `soccer-cv-math`, `eyewear-cad-rulebook`.
- Agents: `vertical-builder` (sonnet, worktree, one slice), `code-scout` (haiku, read-only), `ui-qa-verifier` (sonnet), `security-privacy-auditor` (opus, Day 7 only), `cad-engineer` (opus).
- Docs: `docs/INTERFACE_CONTRACTS.md`, `docs/MCP_SETUP.md`, `docs/CLOUD_ROUTINES_SETUP.md`, `COLLABORATOR_SETUP.md`.
