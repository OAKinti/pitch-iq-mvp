# Agenticverse sprint runner — PitchIQ Day 2–7 in combined waves

All remaining **agent** work (Day 2–3, plus the no-device halves of Day 4–7) runs in one local session, as 5 waves. It lands in **3 PRs** instead of about 13 nightly runs and PRs. Human, device and secret work (`[human:A|B]`, `[device]`, `[secret:*]`) runs in parallel by the people who own it.

## Before you start (owner, about 2 minutes)
1. Tick `[HUMAN GATE 1]` in `SPRINT_STATE.md` on `main` once its items are done. The orchestrator refuses to start while it is unchecked.
2. **Pause Routine 1** (claude.ai/code/routines). It reads `main` and would rebuild tasks that are in flight here. Keep Routine 2 (gatekeeper) on: it reviews each PR below.
3. Start in the repo root: `cd "D:\company ideas\pitch-iq-mvp"` then `claude --model opus`. Use the default effort, medium. Opus only orchestrates; builders run on Sonnet. Paste the prompt below.
4. Rough cost for the whole run: **$12–30** in total, covering Fable once for the spec, about 13 Sonnet builder runs, the Opus orchestrator, and Gemini one-shot research and audits at cents each. Expect 3–5 h of wall-clock time. Check `/cost` at any time.

## Waves
| Wave | Tasks (queue; at most 2 builders at once) | Ships in |
|---|---|---|
| 0 | **D2.0** prereq (frozen files authorized) ‖ **D6.0** D-7 research (no code) | PR-A `claude/d2-0-prereq` |
| 1 | D2.1a pose source · D2.2a skeleton overlay · D2.3a realtime rejoin · D2.4a cue player · D2.5a server debrief · D7.4a release config | PR-B `claude/sprint-d2-d6` |
| 2 | D2.2b integration (after 2.1a, 2.2a, 2.4a) · D4.1a debrief telemetry · D4.2a leaderboard sync tests · D6.1a clip service · D6.2a sticker + share | PR-B |
| 3 | D5.1a Maestro flows + contrast tests (after D2.2b, D6.2a) | PR-C `claude/sprint-d5-d7` |
| 4 | D7.2 release audit: `code-scout` triage, `security-privacy-auditor`, `/agenticverse audit-security` + `slim`; fix Critical/High | PR-C |

**Human parts can start while the waves run:**
- **Person A:** `eas build --profile development` from `claude/d2-0-prereq` as soon as PR-A is pushed, then the D2.1/D2.2 device checks after wave 2.
- **Person B:** Supabase provisioning (D2.3) after PR-A, then D2.4/D2.5/D4.1 after wave 2.

## The prompt (paste into the session)

```text
You are the Agenticverse orchestrator for the PitchIQ MVP combined sprint. Load the agenticverse-orchestrate skill first. Project rules (CLAUDE.md, SPRINT_STATE.md parse rules, frozen files, branch policy) win over generic Agenticverse defaults.

Sources of truth: SPRINT_STATE.md (task lines, tags, gates, decisions), docs/AGENTICVERSE_SPRINT.md (waves, PR plan), .agenticverse/sprint_contract.json (clauses), .agenticverse/briefs/<ID>.brief.md. CLAUDE.md is already loaded; don't re-read it.

0. Preflight, read-only.
   - git fetch. If SPRINT_STATE.md on origin/main has an unchecked gate under "## Gates", print "BLOCKED by HUMAN GATE N: <text>" and stop.
   - Run the Agenticverse status and doctor commands. If Gemini is down, continue: Claude fallback is automatic.
   - Check free RAM. Run 2 builders at once if free RAM is 2-6 GB, 1 if under 2 GB, 3 if over 6 GB.
   - Ask the owner nothing unless a step below says so.
1. Spec (phase spec).
   - Call av_research_strategy once for D6.0 (the SPRINT_STATE D6.0 line, plus D-4 and D-5 as constraints). Have it return the exact packages, their `npm view` versions and Expo config plugins.
   - Verify each version yourself with `npm view <pkg> version peerDependencies`.
   - Record "D-7 (date) PROPOSED" in Decisions, with the install line.
   - If the owner is present, ask once (AskUserQuestion) whether to fold the D-7 packages into D2.0, which saves a second Dev Client build. With no answer, leave them for a later D6.0b install.
   - Then run av-fable-architect once. It adds contract clauses and briefs `.agenticverse/briefs/<ID>.brief.md` for D4.1a, D4.2a, D6.1a, D6.2a, D5.1a and D7.4a, each with exact write paths that are pairwise disjoint within a wave and a scoped jest command. Barrel/index lines go to the orchestrator, not to builders. If Fable reports a credit/quota error, run `/agenticverse fable off` and use av-opus-pm instead.
   - Validate the contract JSON and the briefs with av-haiku-qa.
2. Wave 0.
   - `git checkout -b claude/d2-0-prereq origin/main`, then `/agenticverse phase build`. This records base_commit, so the Stop gate audits committed work too.
   - Run D2.0 per its brief with one vertical-builder authorized for exactly the brief's frozen-file list, or do it yourself.
   - Then verify (step 4), audit (step 5), commit, push, and open PR-A. Tell me the Person A Dev Client command.
3. Waves 1-4.
   - Each wave branch starts from the previous wave's head: PR-B branch `claude/sprint-d2-d6` from `claude/d2-0-prereq`; PR-C branch `claude/sprint-d5-d7` from `claude/sprint-d2-d6`. Don't wait for PR merges; the "after" rule counts tasks merged into these branches.
   - Builders share this working tree. Run the wave's queue at the concurrency from step 0, never two builders whose write paths overlap.
   - Give each vertical-builder:
     - its brief path;
     - its exact write paths;
     - this override: "Ignore the brief's Runner/Base/Branch/commit/push lines and its full `npm run verify` step. Run only the scoped jest (--maxWorkers=2), typecheck and lint:tokens (UI), then report."
   - When a builder reports, check `git status` shows changes only inside its paths. Then `git add <its paths>` and commit `feat(<slice>): <task id> ...` with the session attribution trailer. Add any barrel/index lines yourself in a separate small commit.
   - Single failing test with a clear trace: one av_one_shot_fix call (paths plus the failure), then re-run that test. Anything stateful or multi-file goes back to the builder (av-opus-pm if it fails twice).
   - Tick a task line in SPRINT_STATE.md only after its tests and the wave's verify pass. Never tick human/device/secret lines or gates.
4. Verify, once per batch of finished builders, not per builder. Run `npm run verify` (plus `npm run test:hooks` if .claude/hooks changed) and record .agenticverse/test_results.json {passed, command, ran_at}. UI waves: run ui-qa-verifier once, giving it that verify output to reuse.
5. Audit, once per wave. Call av_cross_audit with:
   - project_dir set to this repo;
   - diff_or_branch set to the wave's start SHA;
   - sprint_contract_path set to .agenticverse/sprint_contract.json;
   - author_provider set to "anthropic".
   Fix only findings that cite file:line, a failing test or a contract clause. Allow at most 2 rounds, then av-fable-architect tie-break, then mark ESCALATED_TO_HUMAN and continue with the next wave's independent tasks. Never hand-edit audit_report.json.
6. Ship.
   - After wave 2 and after wave 4: follow sprint-handoff (reuse this session's verify output), push the wave branch (never main, never --force), and open the PR into main titled "sprint: <waves> (<task ids>)", with a body listing gates, audit verdict and the human follow-ups now unblocked.
   - Append one line per wave to .agenticverse/progress.md.
7. Stop conditions: an unchecked gate; a contract gap that needs a frozen-file change not authorized by a brief (record it under Blockers, skip that task, continue the rest); free RAM under 1 GB (drop to 1 builder); or all agent lines done. Finish with: PRs opened, tasks ticked, audits, the human/device lines now unblocked with owners, and `/agenticverse phase done` if nothing is in flight.
```

## Why it's shaped this way
- **Waves stack on branches, not on `main`.** Builders keep going while PRs wait for review. The human merges 3 PRs for the whole run.
- **One working tree, disjoint paths, the orchestrator commits.** This avoids worktrees branching from `main` (the wrong base), a `npm ci` per worktree, and the RAM pressure of several jest runs on a 15 GB machine that typically has about 1.5 GB free.
- **Verify once per batch, audit once per wave.** This replaces the old 3–4 verify runs per task. The cross-family audit (Gemini Neon, medium effort) costs cents and satisfies the Agenticverse Stop gate, which counts commits since `base_commit`.
- **Gemini is used only for one-shot calls** (D-7 research, isolated test fixes, audits). Iterative work stays with the Claude agents.
- **D2.0 ships alone and first**, so the Dev Client build (the longest human-side step) starts while wave 1 is still running.
