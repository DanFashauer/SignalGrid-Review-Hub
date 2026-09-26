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
- **landing:** the cause that landed is `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters": a read-only brief boots no server. `scripts/preflight.mjs` also runs `scripts/mac/free-test-port.sh` first, but it reaps only orphans (ppid 1) under its OWN tree, so it would not have caught these, which sat in a scratch worktree. The root cause, the fixed ports 5397–5399 in `artifacts/api-server/test/oidc.test.mjs`, is an open `docs/BUILD_BACKLOG.md` row (DR-060 section), the same move #1106 made for `api.test.mjs`.
- **status:** landed

### L2 — a hand-picked gate subset stood in for preflight and CI caught what it missed
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** Measurement-tranche PRs were pushed after seven hand-picked doc gates instead of the full preflight. The list left out cross-doc banner parity, and CI's Mac job failed on PR #1100 (efcead31) because a stamp cited an archived note without repeating its banner. Fixed by b0b3c038.
- **evidence:** Mac job 108335885542: `Preflight FAILED at: Cross-doc banner parity (no live doc cites a bannered doc as live)`
- **landing:** `.claude/workflows/land-branch.js` — the saved workflow's Chain stage refuses to push unless both `PREFLIGHT_EXIT` and `BREADTH_EXIT` sentinels read 0 on the exact expected head; the `docs/BUILD_BACKLOG.md` row "The plan-row measurement tranche is a scripted workflow" is closed against it.
- **status:** landed

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
- **landing:** PR #1111 (merged 5f586f96): a root `.nojekyll` so Pages serves statically with no build step, the publication-boundary entry classifying it, and the Pages lines in `docs/OWNER_ACTIONS.md` section 1 that now say the branch build failed and name the owner-only Pages-source setting. The watch: `scripts/check-mainline-workflow-streaks.mjs` reads the last 10 completed runs on SignalGrid_Alpha of every workflow that runs there unwatched by any other gate (Pages, the gating workflow itself, CodeQL, Supply Chain and nine more, every workflow file classified or the check fails) and REPORTS any with 3+ red in a row, with the streak's start and run URL; exit 0 on a streak by design, exit 1 on its own errors. Wired in `scripts/preflight.mjs` (SKIPPED without GITHUB_TOKEN, classified as a self-skip) and in `.github/workflows/review-hub-ci.yml`'s validation job with the workflow token. Its `--self-test` proves the verdict offline over a synthetic payload; the first CI run on SignalGrid_Alpha is what proves it reads the real history.
- **status:** landed

### L9 — a gate run before `git add` measured the old tree and passed
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A build worker ran check-publication-boundary and five other gates while the new root file was still untracked (`?? .nojekyll`), saw them all pass, then committed. The gate scans TRACKED paths only, so it had measured the tree without the file; CI's gating job then failed on the first push with ".nojekyll falls under NO declared area". Reproduced locally after the commit (exit 1), fixed by one classification entry.
- **evidence:** PR #1111 gating job 108345723055 "Publication-boundary gate FAILED: 1 problem area(s)"; the worker's report quoting `?? .nojekyll` at gate time and "Publication-boundary gate passed" before the commit.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` — a rule under "Sequential chains and waiters" (or the nearest section about worker briefs): gates run AFTER `git add -A` (or after the commit), never on a tree with untracked new files; a worker's report quotes `git status --short` immediately before the gate run.
- **status:** landed

### L10 — a worker's `git fetch --depth=1` made the shared repository shallow
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** At 05:59Z a read-only diagnostic subagent ran `git fetch --depth=1 origin SignalGrid_Alpha` (and `git fetch --depth=1 origin <sha>`) inside a worktree of the shared repository. That wrote `.git/shallow` with five boundary commits including the current mainline head, so every history-based check broke at once. `git fetch --unshallow origin` re-fetched every object (3.5s, all already local) and the seam went green again.
- **evidence:** `node scripts/loop-state.mjs` reported "Local tip ahead of its same-named Hub branch SignalGrid_Alpha (+1958)" and listed seven already-squash-landed branches as "Local work not on the Review Hub"; `git branch -vv` showed cloud-work "ahead 3075, behind 1"; `.git/shallow` was written at 05:59Z and removed by `git fetch --unshallow origin` (3.5 s, every object already local).
- **landing:** `.claude/hooks/block-dangerous.sh` denies `--depth`, `--deepen`, `--shallow-since` and `--shallow-exclude` on `git fetch` or `git pull` by one regex — wherever the flag sits and after any `-C <dir>`, `-c k=v` or `--opt` global options, so `git -C <wt> fetch origin x --depth=1` is caught — and its refusal names this lesson and `git fetch --unshallow origin` (`git clone --depth` and `git fetch --unshallow` stay allowed); `scripts/src/phase-pr-report.ts` fetches `--depth=1` only under CI (`GITHUB_BASE_REF`), as `phase-gate.ts` already did, because the hook cannot see what a script spawns and a local run with `PHASE_BASE_REF` set would have repeated this; `.claude/skills/orchestrator-over-workers/SKILL.md` gets a rule under "Sequential chains and waiters" that a worker never runs a depth-limited or shallow fetch against the shared repository or any of its worktrees, and that a broken history seam after a subagent ran is checked with `git rev-parse --is-shallow-repository` first (`ls .git/shallow` fails open in a worktree, where `.git` is a file).
- **status:** landed

### L11 — a coverage-page `--write` ran while the page itself sat mid-merge-conflict
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** In PR #1113 (DR-060, merged 428a12a8), after `git merge origin/SignalGrid_Alpha` at 7de35816 left `docs/agent/SURFACE_REVIEW_COVERAGE.md` in conflict, `node scripts/check-surface-review-coverage.mjs --write` was run BEFORE the conflict was resolved. The generator walked an index holding three stages of the page (ours/theirs/base) and rendered wrong counts; commit e3b444cf carried that page and `node scripts/check-surface-review-coverage.mjs` failed on it. d2d39883 regenerated on a clean index and passed. A rule in prose did not hold; the generator did — `.claude/skills/landing-under-dr-037/SKILL.md` already said "Regenerate the coverage page on a CLEAN index only" (line 54: "Regenerate the coverage page on a CLEAN index only, so the write is the") and the mid-conflict `--write` still happened.
- **evidence:** `git log --format='%h %s' e3b444cf -1` → `e3b444cf Merge origin/SignalGrid_Alpha into DR-060: coverage page regenerated on top of 7de35816`; `git log --format='%h %s' d2d39883 -1` → `d2d39883 coverage page regenerated on a clean index (the previous regeneration ran mid-conflict)`; `.claude/skills/landing-under-dr-037/SKILL.md` line 54.
- **landing:** `scripts/check-surface-review-coverage.mjs` — a pure `writeRefusal(unmergedListing)` function; `--write` now runs `git ls-files -u` first and, if it prints anything, refuses (exit 1, naming the unmerged path(s) and "resolve the conflict first, then regenerate") instead of writing. Three `--self-test` cases added: an empty listing proceeds, a listing naming the coverage page itself refuses, and a listing naming an unrelated file (any unmerged path means a mid-merge index) refuses too. Proved live in a throwaway worktree (`git worktree add --detach .../wt-l11probe origin/SignalGrid_Alpha`, a real conflict on `README.md` between two temp branches `l11-probe-a`/`l11-probe-b`): `node scripts/check-surface-review-coverage.mjs --write` printed "refusing to regenerate over a mid-conflict index — resolve the conflict first, then regenerate. Unmerged path(s): ✗ README.md" and exited 1; the probe worktree and both temp branches were then removed. `.claude/skills/orchestrator-over-workers/SKILL.md` "Sequential chains and waiters" gets a matching rule: a generated file is regenerated only with `git ls-files -u` empty.
- **status:** landed

### L12 — a Mac tick PR's coverage page went stale between its gating run and its merge
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** Mac tick PR #1114 (head 3cb08b9f) carried a coverage page generated before #1111 (5f586f96, 06:24Z) added the root file `.nojekyll` to mainline. CI on the PR's merge ref was green (gating 108352073887), but after the merge landed at 1f337e7d (06:30Z) mainline's own run failed the surface-read-coverage gate; #1116 (ffa8cc53, 06:49Z) regenerated the page in its delivery and mainline went green again.
- **evidence:** `git show 1f337e7d:docs/agent/SURFACE_REVIEW_COVERAGE.md` vs `git show ffa8cc53:docs/agent/SURFACE_REVIEW_COVERAGE.md` differ on one line: `2971 of 2971 in-scope tracked files` (1f337e7d) vs `2972 of 2972 in-scope tracked files` (ffa8cc53) — `.nojekyll` landing on mainline between the two runs is the extra file.
- **landing:** `.claude/skills/landing-under-dr-037/SKILL.md`, "Order, when several land in a row" — a numbered rule that this applies to a Mac tick PR too: if mainline has moved a counted surface (`docs/`, `scripts/`, `artifacts/sim-requests/`, `artifacts/sim-results/`; the mailbox trees `artifacts/lane-messages`, `artifacts/agent-heartbeats`, `artifacts/raised-hands` are not counted) since the tick's page was generated, merge `SignalGrid_Alpha` into the tick branch and regenerate before merging — a green merge-ref run is not proof, because a counted file can land between the run and the merge. `docs/LANE_COORDINATION.md`'s Rule 2 (the steward's tick-PR practice) gets a matching sentence.
- **status:** landed

### L13 — a bare /proc scan, used alone as a chain lock, can make two waiters wait on each other
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** Caught at design time, before it fired: a chain lock built as a BARE scan of running processes (`ps -eo args | grep -E 'scripts/preflight.mjs|verify-breadth.mjs'`, with no lock file at all) is unsafe, because each of two waiters can match the OTHER waiter's own `ps`/`grep` invocation as "someone is running the gates" and each then waits on the other forever — the same failure class as L3, one level up: L3 was two waiters polling a process pattern to detect completion, this would be two waiters polling a process pattern to decide who holds the lock. `.claude/workflows/land-branch.js` was written directly with the lock-file design below and never carried the bare-scan version, so this is a documented design hazard this codebase avoided, not a reproduced deadlock.
- **evidence:** no tracked artifact demonstrates the bare-scan failure firing; the class of bug is the one described above. The checkable path is `.claude/workflows/land-branch.js`, whose Chain stage acquires `<scratch>/chain.lock` as a FILE (`set -o noclobber`) and uses a bracketed ps pattern (`[s]cripts/preflight.mjs`) only as a precondition on acquiring that file — the brackets make the pattern not match the very `grep` command checking it, so a waiter cannot see its own check as "busy".
- **landing:** `.claude/workflows/land-branch.js` — lock state is a FILE, acquired with `noclobber` and a 40-minute stale-clear, in the script's own loop (never inside a worker that could return early and drop it); the bracketed-pattern ps check is only a same-host courtesy precondition on top of that file, not the lock itself.
- **status:** landed

### L14 — a worker-owned background chain died mid-preflight when the worker's turn ended
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** A background chain tagged `l8c`, started from inside a worker's own shell rather than detached, died mid-preflight when the worker's turn ended: its log stopped at 08:56:28Z after the line "Cost figures self-test", no process was left running, and no `PREFLIGHT_EXIT`/`BREADTH_EXIT` line was ever written. Three Haiku validators sent to check on it returned "blocked" after under a minute instead of waiting on the sentinel file, compounding the problem with L3's failure mode.
- **evidence:** the `l8c` run in this session — log's last line text: `Cost figures self-test` (no exit line follows, and no matching process remained); the `l8d` coordinator re-run, started as one detached `setsid nohup` job, passed.
- **landing:** `.claude/workflows/land-branch.js` — the Chain stage starts the whole preflight+breadth chain as ONE detached `setsid nohup` job that outlives the worker's own turn, and both the lock wait and the sentinel wait live in the workflow script's own loops (short mechanical readers, repeated by the script) rather than in one worker's patience — the chain-run worker returned exits of -1 after ~10 minutes on 2026-09-26 while the detached job ran on to 0/0, and only a script-side re-read turns that into a push.
- **status:** landed

### L15 — merging a base branch's tip into a stacked branch before the base lands gives GitHub a conflict git does not have
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** The MCP-roster branch was stacked on the L2 landing branch and, to pre-resolve an adjacent-row edit in `docs/BUILD_BACKLOG.md`, had the L2 tip (08949c61) merged INTO it before L2 landed. L2 then landed by merge commit (#1126, 8216cf6b), so the stacked branch and mainline had TWO merge bases (62b07014 and 08949c61). git's recursive merge of the two was clean, but GitHub's mergeability check uses one base and reported PR #1127 as `dirty`, naming `docs/agent/SURFACE_REVIEW_COVERAGE.md` and `scripts/preflight.mjs` — files neither side had edited against the other — so the merge button refused a PR in which nothing conflicted.
- **evidence:** `git merge-base --all b26d7f60 origin/SignalGrid_Alpha` printed both `62b07014…` and `08949c61…`; `git merge-tree --write-tree --merge-base=62b07014… b26d7f60 origin/SignalGrid_Alpha` exits 1 naming `docs/agent/SURFACE_REVIEW_COVERAGE.md` and `scripts/preflight.mjs`, while the same command without the forced base exits 0. The repair on this branch is the merge of `origin/SignalGrid_Alpha` at 8216cf6b, after which the merge base is single.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` — a stacked branch WAITS for its base PR to land and then merges `origin/SignalGrid_Alpha`; it never merges the base branch's own tip, and an adjacent-line edit shared with the base is resolved on that Alpha merge, not before.
- **status:** landed

### L16 — PR bodies written on Haiku fabricated facts twice; the saved workflow runs them on Sonnet and the stage table now says so
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** On 2026-09-26 a Haiku PR-body writer for the L10/L11/L12 landing (#1119) invented a check-run id and a Jekyll cause and mis-attributed files, and a Haiku body draft for the 07:20Z record and the L8 landing invented facts again; the coordinator rewrote each body by hand from verified output. The saved workflow `.claude/workflows/land-branch.js` therefore runs its PR-body stage on Sonnet (its prompt says so), while `.claude/skills/orchestrator-over-workers/SKILL.md`'s stage table still assigned PR bodies to Haiku — a wrong-tier stage by the table, recorded in the 11:45Z LOOP entry's TIERS line, with no ledger row (Codex flagged it on #1128, thread 4111450454). The coordinator's own bulk edits this window (registering the L2 gate self-test in preflight/CI, the sentinel-wait loop and canPush mirror in the saved workflow, the L15 row and skill rule, the criss-cross repair merge, two PR-body rewrites) are the L7 pattern recurring.
- **evidence:** the 11:45Z `TIERS THIS SESSION` line in `docs/agent/LOOP.md` (on origin/SignalGrid_Alpha once #1128 lands; cite the file); the #1119 and #1128 PR-body rewrites (cite the PR numbers); the body stage's prompt text in `.claude/workflows/land-branch.js`.
- **landing:** `.claude/skills/orchestrator-over-workers/SKILL.md` — the stage table's PR-body assignment moves to Sonnet with this row as the reason, so the table and the workflow agree; the coordinator's remaining stages are briefs, corrections and merges — the merge/regenerate/chain/push/open stages now run inside the saved workflow.
- **status:** landed

### L17 — A worktree that was never installed fails the chain at the first tsx proof; the Merge stage now installs it
- **date:** 2026-09-26
- **lane:** cloud
- **incident:** The coordinator created the `klass` landing worktree with a root `node_modules` SYMLINK to the shared checkout instead of running `pnpm install --frozen-lockfile` in it, though the orchestrator skill's own line 41 already says to install — every per-package bin dir was empty as a result. The klass1 chain died red at `Reason codes self-test` with `spawnSync <worktree>/scripts/node_modules/.bin/tsx ENOENT`, and at `Zero Trust principles` in breadth with `sh: 1: tsx: not found` / `WARN Local package.json exists, but node_modules missing` — an ENVIRONMENT failure, not a code failure. One chain slot and roughly 10 minutes were lost before the worktree was installed properly (`pnpm install --frozen-lockfile --offline`, 4 s) and `scripts/node_modules/.bin/tsx` confirmed present.
- **evidence:** the two quoted error lines above (`spawnSync <worktree>/scripts/node_modules/.bin/tsx ENOENT` and `sh: 1: tsx: not found` / `WARN Local package.json exists, but node_modules missing`) from the klass1 chain's preflight and breadth logs; this PR's landing run klass1 → klass2. The log files live in the session scratchpad and are not tracked in this repository, so they cannot be cited by path.
- **landing:** `.claude/workflows/land-branch.js` — the Merge stage's first step now runs `test -x scripts/node_modules/.bin/tsx || pnpm install --frozen-lockfile` in the worktree before anything else, so an uninstalled worktree is installed from the lockfile instead of burning a chain; `.claude/workflows/README.md`'s `worktree` row says the worktree must be a real `pnpm install --frozen-lockfile` checkout, never a node_modules symlink. (Codex round 2 on #1133: dropped `--offline` — the flag makes a genuinely stale lockfile fail with a confusing "not found in offline mode" error instead of pnpm's own clear `ERR_PNPM_OUTDATED_LOCKFILE`, and gains nothing since the registry is reachable here.)
- **status:** landed
