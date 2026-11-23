---
name: sprint-handoff
description: How to update SPRINT_STATE.md at the end of any work session — check off tasks, record exact commands with exit codes, log blockers and decisions, and leave cold-start instructions for the next local session, cloud routine, or human collaborator. Use before every commit that ends a work block.
---

Use this skill whenever you finish, pause or hand off sprint work; the next session must be able to resume from `SPRINT_STATE.md` alone.

## Steps
1. **Re-run the gates** you are about to report, and record what you actually ran. Never copy results forward from an earlier session.
   `npm run typecheck` · `npm test` · `npm run lint:tokens` · `npm run check:compliance` (plus `npm run test:hooks` if you touched `.claude/hooks`).
2. **Update the checkboxes** in `SPRINT_STATE.md`:
   - Tick `- [x]` only for tasks whose gates passed in step 1.
   - Leave partial work unchecked, and append ` — PARTIAL: <what remains>`.
   - Never tick a `[HUMAN GATE N]` line. Only the human does that.
   - Keep the exact checkbox syntax (`- [ ]` / `- [x]` at line start). Cloud routines parse it with a regex.
3. **Append a Session Log entry** at the top of the log section:
   ```
   ### <YYYY-MM-DD HH:MM TZ> — <local|cloud-routine|human> — <branch>
   - Did: <1–3 bullets>
   - Verified: `npm run typecheck` → 0; `npm test` → 0 (N tests, cov X %); `npm run lint:tokens` → 0; `npm run check:compliance` → 0
   - Not verified: <e.g. "no device — Maestro not run">
   - Commit: <sha> on <branch>; pushed: yes/no
   - Next: <the single next unblocked task, quoted exactly from the checklist>
   ```
4. **Record blockers and decisions.** Add to *Blockers* any missing secret, device or human decision, with the person who owns it (Person A / Person B / Owner). Add to *Decisions* any contract change or spec deviation, with its reason.
5. **Cold-start block.** Make sure *Cold start* still holds: clone → `npm ci` → copy `.env.example` → `npm run verify`. Fix it if anything changed, such as a new env var or native step.
6. **Commit** on a `claude/*` branch (agents) or `feat/*` (humans): `chore(sprint): handoff <day> — <summary>`. Push only to non-`main` branches. Never force-push.
7. Keep the file skimmable. Collapse log entries older than 2 days into one line each.
