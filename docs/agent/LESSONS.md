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

**The gate.** `node scripts/check-lessons.mjs` fails on a missing or repeated field, an
unknown status or lane, ids that do not run L1..Ln in order (a duplicate, a gap, a
deleted row), a heading that looks like a row but is not `### L<n>`, a future or
impossible date, a `landed` row whose landing says "pending" anywhere or names nothing
checkable (a tracked path, `#<PR>`, `DR-0NN`, a sha, or `recorded only — <reason>`), and
a landing that names a file git does not track. It REPORTS, not fails, every row still
pending more than 14 days after its date. `--self-test` plants each failing shape and
asserts it fails.

**What no gate can see.** The gate checks shape only. It cannot see an incident that
never got a row, or whether a row's evidence supports it; the ledger is as complete as
the LOOP END ritual makes it. Which model tier ran a stage inside a session is invisible
too. The record of that is the `TIERS THIS SESSION` line in the [LOOP](LOOP.md) STATE
block; a stage run on the wrong tier is a lesson here.

---

### L1 — an orphaned api-server held a test port and failed two preflights
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A read-only measurement subagent booted the api-server to reproduce plan rows 97–99 and left five `dist/index.mjs` processes running (ppid 1, cwd in a scratch worktree) on 127.0.0.1:5395–5399. Two local preflight runs on two tranche branches then failed at the OIDC middleware test, whose JWKS fixture port is 5399. Reaping the five processes fixed it; the third run passed.
- **evidence:** both preflight logs: `Error: listen EADDRINUSE: address already in use 127.0.0.1:5399` at `OIDC middleware test (the PRODUCTION auth branch actually executes)`; the process inventory showed PORT=5395..5399 in the environment.
- **landing:** the cause that landed is `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters": a read-only brief boots no server. `scripts/preflight.mjs` also runs `scripts/mac/free-test-port.sh` first, but it reaps only orphans (ppid 1) under its OWN tree, so it would not have caught these, which sat in a scratch worktree. The ROOT CAUSE — the fixed ports 5397–5399 in `artifacts/api-server/test/oidc.test.mjs`, plus the two other fixed ports #1106 left behind — is now fixed: `artifacts/api-server/test/oidc.test.mjs` (`JWKS_PORT`/`PORT`/`ABSENT_PORT`/each broken-config `brokenPort`), `artifacts/api-server/test/load.test.mjs` (`PORT`/`LIMIT_PORT`), and `scripts/src/observability-proof.ts` (`PORT`) all bind OS-assigned ports via the same `freePort()` shape #1106 introduced for `api.test.mjs`; no fixed port in this range can collide across trees again.
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
- **incident:** The coordinating session, on the creative tier DR-047 says never runs an engineering stage, wrote patch scripts, PR bodies and commit messages and parsed a CI job listing itself instead of dispatching them to cheaper workers. The owner restated the routing directive in his own words the same day.
- **evidence:** `git log origin/SignalGrid_Alpha --since=2026-09-26T00:00Z --grep="Co-Authored-By: Claude Fable 5.1"` lists cloud-lane commits carrying the creative tier's trailer, among them b0b3c038 (a one-line stamp fix) and 5750b04e (a lane-mail heartbeat). The job-listing parse left no saved output, so only the commits are evidenced here.
- **landing:** `docs/DECISION_RECORDS.md` DR-060; the stage table in `.claude/skills/orchestrator-over-workers/SKILL.md` "Stage table — the coordinator runs none of the bulk"; the `TIERS THIS SESSION` line in `docs/agent/LOOP.md`.
- **status:** landed

### L6 — the Mac tick and the self-hosted runner booted the api-server on the same port
- **date:** 2026-09-25
- **lane:** mac
- **incident:** The tick's 20:30Z evidence run failed test:api with ECONNREFUSED because the self-hosted runner ran a job on the same Mac from 20:25Z to 20:31Z and both harnesses boot the api-server on the same fixed port. Same class as L1, on the other host.
- **evidence:** `artifacts/lane-messages/mac-correction-to-my-ack-on-the-20-30z-evidence-.json`
- **landing:** the Mac lane's PR #1106, merged to mainline as 9222c677: `artifacts/api-server/test/api.test.mjs` and `scripts/run-bruno-collection.mjs` bind ephemeral ports, so the tick's evidence run and the self-hosted runner no longer race for :5310.
- **status:** landed

### L7 — DR-060's own PR broke its stage table on day one
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** The coordinator, on the creative tier, wrote the DR-060 spec, a stage DR-047 rule 2 puts on Opus; one Opus worker then built the PR, a stage the table puts on Sonnet; and DR-060's first draft said "the coordinator writes specs and reviews", giving a creative-tier coordinator the review stage DR-047 forbids it. Review caught all three. The fix round also ran on Opus.
- **evidence:** the `TIERS THIS SESSION` line in `docs/agent/LOOP.md` ("one Opus worker built this PR"; "the coordinator (creative tier) wrote the spec"); review findings on DR-060 rule 1 and the SKILL stage table.
- **landing:** `docs/DECISION_RECORDS.md` DR-060 rule 1 now puts spec, review and gate design on Opus and has a creative-tier coordinator dispatch them; the `TIERS THIS SESSION` line in `docs/agent/LOOP.md` records the break instead of presenting it as compliant.
- **status:** landed

### L8 — the GitHub Pages branch build had failed on every mainline push for 34 days and nothing watched it
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** The Pages workflow "pages build and deployment" (deploy-from-branch, Jekyll) concluded failure on every push to SignalGrid_Alpha from 8dbea78d (PR #263, 2026-08-23 06:06Z, which vendored `third_party/everything-claude-code`) through 2026-09-26: Jekyll's Liquid parser dies on `{{ height: ... }}` inside a vendored skill file's JSX code sample. No gate reads a non-gating workflow's conclusion, so a red mainline workflow was invisible for a month; `docs/OWNER_ACTIONS.md` meanwhile said Pages was "already enabled and deploying".
- **evidence:** job 108343230933 step "Build with Jekyll": `Liquid Exception: Liquid syntax error (line 368): Variable '{{ height: `${virtualizer.getTotalSize()}' was not properly terminated with regexp: /\}\}/ in third_party/everything-claude-code/skills/frontend-patterns/SKILL.md`; last success run 300 at 982ae6b0 (2026-08-23 05:54Z), first failure run 301 at 8dbea78d.
- **landing:** pending — PR #1111 (root `.nojekyll` so Pages serves statically with no build step; the publication-boundary entry classifying it; the OWNER_ACTIONS correction naming the owner-only Pages-source setting), and a backlog row for a CI-side check that reads the last conclusion of each non-gating mainline workflow and reports a red streak.
- **status:** pending

### L9 — a gate run before `git add` measured the old tree and passed
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A build worker ran check-publication-boundary and five other gates while the new root file was still untracked (`?? .nojekyll`), saw them all pass, then committed. The gate scans TRACKED paths only, so it had measured the tree without the file; CI's gating job then failed on the first push with ".nojekyll falls under NO declared area". Reproduced locally after the commit (exit 1), fixed by one classification entry.
- **evidence:** PR #1111 gating job 108345723055 "Publication-boundary gate FAILED: 1 problem area(s)"; the worker's report quoting `?? .nojekyll` at gate time and "Publication-boundary gate passed" before the commit.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` — a rule under "Sequential chains and waiters" (or the nearest section about worker briefs): gates run AFTER `git add -A` (or after the commit), never on a tree with untracked new files; a worker's report quotes `git status --short` immediately before the gate run.
- **status:** landed
