# Lessons — what each cycle got wrong, and where the fix landed

**The rule (DR-060, rule 2).** Every incident a cycle hits gets a row here in the same
session: a failed gate, a stuck waiter, a lost chain, a wrong figure, a missed rule. A
row names what happened, the evidence (quoted output or a path), and a **landing**: a
gate, a skill rule, a script change, a backlog row, or `recorded only — <reason>`. A
lesson with no landing is a story; the landing is what stops the next cycle repeating it.

**Row shape.** One block per lesson, append-only, ids never reused:

```
### L<n> — short title
- **date:** YYYY-MM-DD
- **lane:** cloud | mac | both
- **incident:** what happened
- **evidence:** quoted output or a path
- **landing:** where it landed, or "pending — <where it will land>"
- **status:** landed | pending
```

**The gate.** `node scripts/check-lessons.mjs` fails on a missing field, an unknown
status, a duplicate id, a future or malformed date, a `landed` row whose landing is
empty or pending, and a landing that names a file git does not track. It REPORTS, not
fails, every row still pending more than 14 days after its date. `--self-test` plants
each failing shape and asserts it fails.

**What no gate can see.** Which model tier ran a stage inside a session is invisible to
any check in this tree. The record of it is the `TIERS THIS SESSION` line in the
[LOOP](LOOP.md) STATE block; a coordinator doing a bulk stage itself is a lesson here.

---

### L1 — an orphaned api-server held a test port and failed two preflights
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A read-only measurement subagent booted the api-server to reproduce plan rows 97–99 and left five `dist/index.mjs` processes running (ppid 1, cwd in a scratch worktree) on 127.0.0.1:5395–5399. Two local preflight runs on two tranche branches then failed at the OIDC middleware test, whose JWKS fixture port is 5399. Reaping the five processes fixed it; the third run passed.
- **evidence:** both preflight logs: `Error: listen EADDRINUSE: address already in use 127.0.0.1:5399` at `OIDC middleware test (the PRODUCTION auth branch actually executes)`; the process inventory showed PORT=5395..5399 in the environment.
- **landing:** `scripts/preflight.mjs` now runs `scripts/mac/free-test-port.sh` as its first step on every platform, reaping api-servers whose binary is under the current tree (CI's Mac job already did this; local runs never did); `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters" forbids a read-only brief from booting a server.
- **status:** landed

### L2 — a hand-picked gate subset stood in for preflight and CI caught what it missed
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** Measurement-tranche PRs were pushed after seven hand-picked doc gates instead of the full preflight. The list left out cross-doc banner parity, and CI's Mac job failed on PR #1100 (efcead31) because a stamp cited an archived note without repeating its banner. Fixed by b0b3c038.
- **evidence:** Mac job 108335885542: `Preflight FAILED at: Cross-doc banner parity (no live doc cites a bannered doc as live)`
- **landing:** pending — the open `docs/BUILD_BACKLOG.md` row "The plan-row measurement tranche is a scripted workflow" (DR-060 section).
- **status:** pending

### L3 — two waiters each waited for the other forever
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** Two background wait loops each used `pgrep -f` on the verify-breadth pattern to wait for the other gate chain. Each loop's own command line matched the other's pattern, so both waited until stopped by hand.
- **evidence:** both waiters stopped by hand and replaced by one sequential command writing PREFLIGHT_EXIT / BREADTH_EXIT sentinels.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters": one chain per host for port-bound gates; wait on a sentinel file, never on a process pattern your own command line can match.
- **status:** landed

### L4 — a container restart killed every running chain
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A container restart stopped five background gate chains and four measurement agents mid-run. The scratchpad, worktrees and sentinel logs survived, so the chains were rebuilt from the sentinels and the agents re-spawned from the saved row texts.
- **evidence:** the harness reported five background tasks and four agents `stopped`; the per-tranche notes and run-head files in the scratchpad were intact.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters": chain state lives in files under the scratchpad, never only in a process; a self-scheduled check-in is the recovery signal after a restart.
- **status:** landed

### L5 — the coordinator did bulk stages itself
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** The coordinating session, on the creative tier DR-047 says never runs an engineering stage, wrote patch scripts, PR bodies and commit messages and parsed a 93 KB CI job listing itself instead of dispatching them to cheaper workers. The owner restated the routing directive in his own words the same day.
- **evidence:** the owner's 2026-09-26 message, quoted verbatim in DR-060.
- **landing:** `docs/DECISION_RECORDS.md` DR-060; the stage table in `.claude/skills/orchestrator-over-workers/SKILL.md` "Which model runs a stage — the coordinator runs none of the bulk"; the `TIERS THIS SESSION` line in `docs/agent/LOOP.md`.
- **status:** landed

### L6 — the Mac tick and the self-hosted runner booted the api-server on the same port
- **date:** 2026-09-26
- **lane:** mac
- **incident:** The tick's 20:30Z evidence run failed test:api with ECONNREFUSED because the self-hosted runner ran a job on the same Mac from 20:25Z to 20:31Z and both harnesses boot the api-server on the same fixed port. Same class as L1, on the other host.
- **evidence:** `artifacts/lane-messages/mac-correction-to-my-ack-on-the-20-30z-evidence-.json`
- **landing:** the Mac lane's PR #1106, merged to mainline as 9222c677: `artifacts/api-server/test/api.test.mjs` and `scripts/run-bruno-collection.mjs` bind ephemeral ports, so the tick's evidence run and the self-hosted runner no longer race for :5310.
- **status:** landed
