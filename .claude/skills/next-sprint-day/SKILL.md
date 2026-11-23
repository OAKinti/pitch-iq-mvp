---
name: next-sprint-day
description: Resumable day-runner for the PitchIQ 7-day sprint. Invoke as /next-sprint-day in any fresh local or cloud session — reads SPRINT_STATE.md, exits cleanly if blocked by an unchecked HUMAN GATE, a physical device or a missing secret, otherwise runs the next unblocked tasks with the right subagents, verifies, commits and hands off.
---

Use this skill whenever a session is asked to "continue the sprint", "run the next day" or `/next-sprint-day`. Never improvise tasks that are not in `SPRINT_STATE.md`.

## 1. Orient (read-only)
1. Read `CLAUDE.md` and `SPRINT_STATE.md` in full. Run `git status` and `git log --oneline -5`. If the tree is dirty with someone else's work, stop and report it. Never stash or discard it.
2. Parse the checklist top to bottom. Task lines match `^- \[( |x)\] (\[HUMAN GATE \d+\] )?(.*)$`. Lines tagged `[device]`, `[secret:NAME]` or `[local-only]` declare their requirements.
3. **Blocking rule:** find the first unchecked task. If any unchecked `[HUMAN GATE N]` line comes before it, you are **blocked**. Print `BLOCKED by HUMAN GATE N: <text>`, make no code edits, and exit 0.

## 2. Decide whether this session can run the task
Stop cleanly and report (no edits, no empty commits) if the next task:
- is tagged `[device]` and no simulator or device is reachable (`adb devices`, `xcrun simctl list`, or a Maestro MCP tool) — this is always the case in cloud routines;
- is tagged `[secret:NAME]` and `NAME` is not set in the environment. Check with `node -e "process.exit(process.env.NAME?0:1)"` and never print the value;
- is tagged `[local-only]` and you are in a cloud container (`CLAUDE_CODE_REMOTE` set, or no Windows paths);
- needs `build123d-mcp` and the MCP server is not connected. Then fall back per `eyewear-cad-rulebook` §7, but only for local sessions.
A cloud routine runs exactly **one** unblocked software task per invocation. A local session may continue through the day's tasks.

## 3. Execute
1. Branch from the latest `main`: `git checkout main && git pull --ff-only && git checkout -b claude/<day>-<slug>`. Reuse the day branch if it already exists.
2. Route the work:
   - Software feature work goes to one `vertical-builder` per non-overlapping slice. Run them in parallel worktrees when the tasks touch disjoint directories. Give each builder its directories, the contract section, and the gates.
   - Exploration and log triage go to `code-scout`.
   - Hardware goes to `cad-engineer` with the `eyewear-cad-rulebook` skill.
   - Day 7 release audit goes to `security-privacy-auditor` (read-only).
3. Do small single-file fixes yourself, without a subagent.
4. Domain math must follow `soccer-cv-math`, and UI must follow `design-tokens`. If a frozen contract must change, change `docs/INTERFACE_CONTRACTS.md` and `CONTRACT_VERSION` in the same commit, and log it under *Decisions*.

## 4. Verify (mandatory, real commands)
1. `npm run verify`, which runs typecheck, test (with coverage thresholds), lint:tokens and check:compliance. All must exit 0.
2. Run `ui-qa-verifier` for any UI or compliance-relevant change. Include its PASS/FAIL table in the handoff.
3. Never claim simulator, Maestro or CAD results that you did not observe.

## 5. Commit & hand off
1. Commit with conventional messages ending in the attribution trailer the session provides.
2. `git push -u origin <claude/... branch>`. Never push `main`, never `--force`.
3. Follow `sprint-handoff`: tick tasks, add the session log entry with exit codes, and name the next task.
4. Final message: what ran, gate results, branch and SHA, and the next task or the gate that blocks it.
