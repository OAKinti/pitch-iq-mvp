# PitchIQ release checklist (TestFlight internal and Play Internal App Sharing)

Tags follow SPRINT_STATE: `[human:A]` / `[human:B]` are owned by that person, `[device]` needs a phone, `[secret:NAME]` needs that variable. Agents never execute tagged steps.

## Prerequisites

- [ ] `[human:A]` Run `eas init` once. It writes `expo.extra.eas.projectId` and `expo.owner` into `app.json`. Commit them.
- [ ] `[human:A]` Create the App Store Connect app record for bundle id `com.pitchiq.mvp`.
- [ ] `[human:B]` Create the Play Console app record for package `com.pitchiq.mvp`.
- [ ] `[human:A]` TikTok Share Kit review approved, and the universal link configured.
- [ ] `[human:A]` Second Dev Client rebuild done after the local native modules landed (`eas build --profile development`).
- [ ] The working tree is clean and the branch is merged.

```bash
npm run verify
npx expo-doctor
```

## Version bump

`cli.appVersionSource` is `remote` in `eas.json`: EAS owns the live build numbers. The `app.json` values (`ios.buildNumber` "1", `android.versionCode` 1) are only the initial ones. The production profile uses `autoIncrement`, so every store build bumps them on the EAS side.

- Marketing version: edit `expo.version` (x.y.z) in `app.json`.
- To re-base the remote counters, for example after a manual upload:

```bash
eas build:version:set --platform ios
eas build:version:set --platform android
```

## Secrets and environment

Names only. Values live in EAS secrets, Supabase edge-function secrets or a local untracked env file, never in the repo.

- `[secret:EXPO_TOKEN]` `EXPO_TOKEN` for CI and non-interactive `eas` runs.
- Allowlisted public variables (set as EAS environment variables): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DEMO_MODE`, `EXPO_PUBLIC_FACEBOOK_APP_ID`, `EXPO_PUBLIC_TIKTOK_CLIENT_KEY`. No other `EXPO_PUBLIC_*` name may exist.
- Edge-function secrets (Supabase only): `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `QA_CAP_SECONDS`, `SUPABASE_SERVICE_ROLE_KEY`, plus the WHOOP and Strava client secrets.
- Set `EXPO_PUBLIC_DEMO_MODE` to false only after the Supabase project and edge functions are live.

## iOS - TestFlight internal

- [ ] `[human:A]` `[secret:EXPO_TOKEN]` Build and submit.

```bash
eas build --profile production --platform ios
eas submit --platform ios --latest
```

- [ ] `[human:A]` In App Store Connect, add the build to the internal testing group and answer the export-compliance prompt: exempt, HTTPS only (`ITSAppUsesNonExemptEncryption` is false).
- [ ] `[human:A]` `[device]` Install from TestFlight and run the smoke test below.

## Android - Play Internal App Sharing

- [ ] `[human:B]` `[secret:EXPO_TOKEN]` Build the app bundle.

```bash
eas build --profile production --platform android
```

- [ ] `[human:B]` Download the `.aab` from the EAS build page. In Play Console open Internal App Sharing, upload the `.aab` and copy the share link. Store-track uploads via `eas submit --platform android` need a service account and are out of scope for the MVP.
- [ ] `[human:B]` `[device]` Open the share link on a phone, install and run the smoke test below.

## Database and scheduled jobs (contract v1.2.0)
Project: `pitchiq-mvp` (ref `rindwhaciqfovylqhqdq`, org OAK, us-east-1), created and linked Nov 25. All of the steps below are CLI-only, so no dashboard clicks are needed. With CLI 3.x, every hosted command needs `--remote` and `--yes`.

- [x] `npm run test:db` is green locally (migrations 001–006 and the RLS tests on PGlite). `npx supabase test db` needs Docker; `test:db` replaces it here.
- [x] `npx supabase db push --remote --password "$SUPABASE_DB_PASSWORD" --yes` applies 001–006 (done Nov 25).
- [x] Auth config, including **anonymous sign-ins** (D-9A): `npx supabase config push --remote --yes` from `supabase/config.jsonc`.
- [x] Nightly raw-video purge: migration 005 enables `pg_cron` and `pg_net` and schedules `purge-raw-video-edge` at 03:15 UTC. It reads two Vault secrets at run time, `purge_cron_secret` and `project_url`. The same token is the edge secret `PURGE_CRON_SECRET`: purge-only, never the service-role key. To rotate it, update the Vault secret and run `npx supabase secrets set PURGE_CRON_SECRET=… --yes`.
- [x] Deploy the functions: `npx supabase functions deploy voice-debrief voice-qa purge-raw-video --use-api --yes`.
- [x] Live check: `node --env-file=.env scripts/smoke-live.mjs` (17 checks, Nov 25). Afterwards, delete the smoke users with the fallback SQL the script prints.
- [ ] Voice keys, when you have them: `npx supabase secrets set ANTHROPIC_API_KEY=… ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_CAPTAIN=… ELEVENLABS_VOICE_DRILL_SERGEANT=… ELEVENLABS_VOICE_HYPE=… --yes`. No redeploy is needed. Until they are set, debriefs fall back to the on-device template.
- [ ] Before public launch: CAPTCHA for anonymous sign-up (B-6). Turn it on under Auth → Attack Protection, or set `auth.captcha` in `config.jsonc`.
- Local `.env` (git-ignored) holds the server-only `SUPABASE_DB_PASSWORD` and `PURGE_CRON_SECRET`. These must never be `EXPO_PUBLIC_`. It also holds the public `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key) and `EXPO_PUBLIC_DEMO_MODE=false`.

## Privacy and store declarations

- Camera: skeletal joint tracking only. Face landmarks 1-10 are redacted. No face or voice biometrics.
- Microphone: only when the user saves a highlight clip.
- Photo library: add-only for saving highlight clips, plus a read-back of the clip just saved for TikTok.
- Under-13 users are private and share-locked. The age gate starts with empty inputs.
- Raw video TTL is 90 days.
- Strava is write-only: never ingested, never in AI prompts or shared leaderboards.
- Android blocks media, storage and location permissions (see `blockedPermissions` in `app.json`).
- [ ] `[human:A]` App Store privacy label: declare camera-derived skeletal data and user content as applicable. No tracking.
- [ ] `[human:B]` Play Data safety entries: declare the same data types, encrypted in transit, deletion on request.
- [ ] `[human:A]` Export compliance: exempt, uses only HTTPS.

## Smoke test

- [ ] `[device]` Cold start in Demo Mode, no keys: onboarding, age gate, consent screen before first camera use.
- [ ] `[device]` Run one drill with live pose, then the Tier 2 debrief.
- [ ] `[device]` Save a highlight clip and open the share sheet.
- [ ] `[device]` Deny the camera permission and confirm the notice appears without a crash.
- [ ] `[device]` Maestro: `maestro test .maestro/mvp-smoke.yaml`.

## Rollback

- iOS: expire the TestFlight build in App Store Connect and re-enable the previous build for the testing group.
- Android: remove the Internal App Sharing link and share the previous `.aab` link.
- Do not reuse a build number. If counters drift, run `eas build:version:set` as in the version bump section, then rebuild.
- Server side: redeploy the previous edge-function version; undo a migration only with a new forward migration.
