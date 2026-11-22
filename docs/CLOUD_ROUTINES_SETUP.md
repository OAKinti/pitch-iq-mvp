# Cloud Routines (Scheduled Tasks) Setup

Anthropic renamed **Routines** to **scheduled tasks**. They are still managed at
[claude.ai/code/routines](https://claude.ai/code/routines) or with `/schedule` (alias `/routines`) in the CLI.
The feature is a research preview, so labels may shift; this guide was checked against the docs on Nov 22 2026.
Each run is a full Claude Code cloud session on a fresh clone. The repo's committed `CLAUDE.md`,
`.claude/skills/`, `.claude/agents/`, `.claude/settings.json` hooks and `.mcp.json` all load
automatically, which is why only this one repo should be attached.

## 5-minute setup checklist

1. **Merge Day 1.** On GitHub, open a PR `claude/day-1-mvp → main`, review it, and merge it. Routines start from `main`.
2. **Protect `main` so it holds against your own access.** Go to GitHub → Settings → Rules → Rulesets → *New branch ruleset*. Target `main`, enable *Restrict deletions*, *Block force pushes* and *Require a pull request before merging*, and **leave the bypass list empty**.
   Cloud runs push with *your* GitHub identity. Branch rules you can bypass do not block them.
3. **Grant clone access.** In a local terminal in this repo, run `claude` and then `/web-setup`. This grants repository access for cloning only.
4. **Install the Claude GitHub App** (needed for the PR webhook in Routine 2). Open [github.com/apps/claude](https://github.com/apps/claude), choose *Install*, select **only** `OAKinti/pitch-iq-mvp`, and do not grant all repositories.
   `/web-setup` does not install the app and does not enable webhooks.
5. **Create a dedicated environment.** In the task dialog, go to *Advanced settings → General → Cloud environment → (settings icon) → new environment*. Name it `pitchiq-ci`.
   - *Network access*: **Limited** with **Allow package managers** checked. npm is covered; add more allowed domains only if a task needs them.
   - *Setup script*: `npm ci --no-audit --no-fund` (the result is cached between runs).
   - *Secrets*: Day 1–3 routines need **none** (Demo Mode). Later, if a task must call Supabase or ElevenLabs during a run, add those keys as **network secrets** on `pitchiq-ci`, never as plain environment variables. Plain variables are visible to anyone using the environment. Never use the shared **Default** environment for secrets.
6. **Connectors.** All connected claude.ai connectors are attached by default. **Remove all of them** for both routines. They need only GitHub, which comes through the repo, and an attached connector can be used for writes.
7. Create the two tasks below. For each, select repo `OAKinti/pitch-iq-mvp` (only this one), environment `pitchiq-ci`, and model **Claude Sonnet 5.5** at the default effort.
8. Use **Run now** once on Routine 1 and open the run from *History*. It should report `BLOCKED by HUMAN GATE 2` or run one task. Either result confirms the wiring works.

Limits: 100 scheduled runs per hour per account; 30 per hour per task for *Run now* and API fires. GitHub events have hourly caps; events beyond them are dropped. Runs count against your plan usage.

---

## Routine 1 — Nightly Sprint Worker

- **Trigger:** Schedule → Daily, 2:00 AM (your local time)
- **Model:** Claude Sonnet 5.5
- **Prompt (copy-paste):**

```text
You are the nightly sprint worker for the PitchIQ MVP repository.

1. Read CLAUDE.md and SPRINT_STATE.md in full, then follow .claude/skills/next-sprint-day/SKILL.md exactly.
2. Find the first unchecked task in SPRINT_STATE.md. If any unchecked "- [ ] [HUMAN GATE N]" line appears before it, print "BLOCKED by HUMAN GATE N: <text>" and stop. Do not edit code, do not commit, do not open a PR.
3. Also stop cleanly without edits if that task is tagged [device], [local-only], or [secret:NAME] where NAME is not set in this environment. This cloud container has no simulator, phone, or CAD MCP server.
4. Otherwise execute exactly ONE unblocked software task. Use the vertical-builder agent for feature work. Keep changes inside that task's slice.
5. Run and record exit codes: npm run typecheck, npm test, npm run lint:tokens, npm run check:compliance. If any fails, fix it or revert your change. Never commit a red build.
6. Update SPRINT_STATE.md per .claude/skills/sprint-handoff/SKILL.md: tick the task only if all gates passed, and add a session-log entry with commands and exit codes.
7. Commit with a conventional message and push to a new branch named claude/nightly-<YYYY-MM-DD>. Never push to main and never force-push. Open a pull request into main titled "nightly: <task>" whose body lists the gate results.
8. Finish with a 5-line summary: task, branch, PR link, gate results, next task or blocking gate.
```

## Routine 2 — Partner PR & Compliance Gatekeeper

- **Trigger:** GitHub → event **Pull request**, action **`pull_request.opened`** only (not *synchronized*, not every push). Filter: base branch `main`.
- **Model:** Claude Sonnet 5.5
- **Prompt (copy-paste):**

```text
You are the PR & compliance gatekeeper for the PitchIQ MVP. A pull request into main was just opened; this session starts from its head commit.

Follow .claude/agents/ui-qa-verifier.md as your checklist. You verify; you do not fix or push.

1. Run and capture exit codes: npm run typecheck, npm test, npm run lint:tokens, npm run check:compliance.
2. Review the PR diff (git diff origin/main...HEAD) for:
   - zero hardcoded hex/rgba colors or magic spacing in src/screens and src/components
   - COPPA: neutral age gate (empty inputs), under-13 forced private, no birthdate stored
   - BIPA: consent before camera tracking, no face/voice biometrics, face landmarks 1-10 redacted
   - 90-day raw video TTL intact in supabase/migrations
   - Strava write-only: no Strava reads, never imported by voice/AI prompt or leaderboard code
   - no secrets in client code or EXPO_PUBLIC_* variables
   - soccer-only scope (no other sports implemented)
3. Post ONE concise PR comment:
   "PitchIQ Gatekeeper: PASS ✅" or "PitchIQ Gatekeeper: FAIL ❌",
   then a table (check | exit code / finding), then numbered blocking issues as path:line plus a one-line fix.
   Do not approve or merge. Do not push commits.
```

---

## Ongoing hygiene

- After each nightly PR, a human reviews and merges it. The next night starts from the updated `main`.
- To pause the sprint, toggle the routine off on its detail page. Unchecked `[HUMAN GATE]` lines already make runs no-ops.
- Rotate any network secret immediately if a run transcript ever prints it.
