---
name: next-sprint-day
description: Resumable day-runner for the PitchIQ 7-day sprint. Invoke as /next-sprint-day in any fresh local or cloud session — reads SPRINT_STATE.md, exits cleanly if blocked by an unchecked HUMAN GATE, a physical device or a missing secret, otherwise runs the next unblocked tasks with the right subagents, verifies, commits and hands off.
---

Use this skill whenever a session is asked to "continue the sprint", "run the next day" or `/next-sprint-day`. Never improvise tasks that are not in `SPRINT_STATE.md`.

## 1. Orient (read-only)
1. Read `SPRINT_STATE.md` in full (`CLAUDE.md` is already loaded as project memory; do not re-read it). Run `git status` and `git log --oneline -5`. If the tree is dirty with someone else's work, stop and report it. Never stash or discard it.
2. Parse each `## Track:` section of the checklist top to bottom (cloud routines: only `## Track: software`). Task lines match `^- \[( |x)\] (\[HUMAN GATE \d+\] )?(.*)$`. Lines tagged `[device]`, `[secret:NAME]` or `[local-only]` declare their requirements.
3. **Blocking rule:** if an unchecked gate under `## Gates` exists, you are **blocked**. Otherwise, per track, find the first unchecked task; if an unchecked `[HUMAN GATE N]` line comes before it in the same track, that track is **blocked**. If every track you may run is blocked, you are **blocked**. Print `BLOCKED by HUMAN GATE N: <text>`, make no code edits, and exit 0.

## 2. Decide whether this session can run the task
Skip lines tagged `[human:A]`/`[human:B]` (a person owns them; agents never execute or tick them) and agent lines whose `after Dx` tasks are not all ticked on `main`; take the next runnable line in the track. Then stop cleanly and report (no edits, no empty commits) if the task you landed on:
- is tagged `[device]` and no simulator or device is reachable (`adb devices`, `xcrun simctl list`, or a Maestro MCP tool) — this is always the case in cloud routines;
- is tagged `[secret:NAME]` and `NAME` is not set in the environment. Check with `node -e "process.exit(process.env.NAME?0:1)"` and never print the value;
- is tagged `[local-only]` and you are in a cloud container (`CLAUDE_CODE_REMOTE` set, or no Windows paths);
- needs `build123d-mcp` and the MCP server is not connected. Then fall back per `eyewear-cad-rulebook` §7, but only for local sessions.
A cloud routine runs exactly **one** unblocked software task per invocation. A local session may continue through the day's tasks.

## 3. Execute
1. Branch from the latest `main`: `git checkout main && git pull --ff-only && git checkout -b claude/<day>-<slug>`. Use the branch name the caller gives instead, if any (Routine 1: `claude/nightly-<YYYY-MM-DD>`). Reuse the branch if it already exists.
2. Route the work:
   - Software feature work goes to one `vertical-builder` per non-overlapping slice. Builders share this working tree. Run at most 2 in parallel, and only when their write paths are disjoint. Give each builder its brief, its exact write paths and the gates, then commit each slice's paths yourself (`git add <paths>`). Multi-task local runs follow `docs/AGENTICVERSE_SPRINT.md`.
   - Exploration and log triage go to `code-scout`.
   - Hardware goes to `cad-engineer` with the `eyewear-cad-rulebook` skill.
   - Day 7 release audit goes to `security-privacy-auditor` (read-only).
3. Do small single-file fixes yourself, without a subagent.
4. Domain math must follow `soccer-cv-math`, and UI must follow `design-tokens`. If a frozen contract must change, change `docs/INTERFACE_CONTRACTS.md` and `CONTRACT_VERSION` in the same commit, and log it under *Decisions*.

## 4. Verify (mandatory, real commands)
1. Run `npm run verify` (typecheck, test with coverage thresholds, lint:tokens, check:compliance) **once, after the last code change**. All must exit 0. Builders' scoped jest runs do not replace it, and this run does not need repeating unless code changes again.
2. Run `ui-qa-verifier` only for UI or compliance-relevant changes. Hand it this session's verify output to reuse instead of re-running, and include its PASS/FAIL table in the handoff.
3. Never claim simulator, Maestro or CAD results that you did not observe.

## 5. Commit & hand off
1. Follow `sprint-handoff` first: tick tasks, add the session log entry with exit codes, and name the next task.
2. Commit the code and the handoff with conventional messages ending in the attribution trailer the session provides.
3. `git push -u origin <claude/... branch>` once. Never push `main`, never `--force`.
4. Final message: what ran, gate results, branch and SHA, and the next task or the gate that blocks it.
