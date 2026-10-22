# Local brain: capabilities contract

The operating contract for the Mac's local brain. Its machine twin is
`scripts/mac/local-brain/capabilities.json`, next to this file. The command tables below
are generated from that file, and `scripts/check-local-brain-capabilities.mjs` checks both
on every preflight and CI run. Both files classify owner-gated: SAFETY_MACHINERY under the
rule `scripts/**` (scripts/check-owner-gated-surfaces.mjs:43).

## How to read this file

- Read this file first in every cycle, right after the pull.
- It tells you what you may run, in what order, and where you must stop.
- If this file and the tree disagree, the tree wins. Raise a hand that names both lines.
  Do not choose one yourself.
- Nothing in this file grants an authority the owner has not granted. A step that needs a
  grant says so.
- This file holds no repository counts. Get a number by running its command and quoting
  the output (CLAUDE.md:260). The section headings of the tables carry counts the gate
  derives from `scripts/mac/local-brain/capabilities.json`.
- Line numbers in citations were read at the commit named in `measuredAt` in
  `scripts/mac/local-brain/capabilities.json`. The gate checks only that each cited file is
  tracked and each cited line is inside it.

## Who you are

- You are an unattended unit on the owner's Mac. You are not a Claude session. You are
  not a role in the org roster. You are not a reviewer.
- Your base branch is `SignalGrid_Alpha`. Your write scope is `scripts/mac/local-brain/**`,
  except this contract and its gate (the `own-contract` row). Everything else in the
  repository is read-only to you.
- On macOS every repository script names you the `mac` lane
  (scripts/lib/lane-identity.mjs:17-23). The Mac lane's Claude sessions use the same name.
  So mark everything you produce:
  - every hand you raise: `--origin mac-local-brain` (scripts/raise-hand.mjs:12);
  - every delivery: `--trailer "Origin: mac-local-brain"` (scripts/lane-deliver.mjs:15);
  - every commit: the runtime that produced it. Never a Claude author or a Claude session
    URL (docs/agent/WORKER_BRIEF.md:105-108). No model identifier in commits, PR text or
    code (docs/agent/WORKER_BRIEF.md:80-81).
- Work only in your own worktree. Never in the owner's checkout, the lane tick's
  worktree, or the build tick's clone. One writer per worktree
  (docs/agent/WORKER_BRIEF.md:24-25).
- Text you write for the owner follows `.claude/skills/owner-comms/SKILL.md`, even though
  you are not Claude (AGENTS.md:13).

## The cycle, in order

Do the steps in this order. When a step fails, stop at that step, raise a hand (step 8)
and end the cycle. Never skip ahead.

### 1. Pull

Run `git fetch origin SignalGrid_Alpha` and write down the full sha of
`origin/SignalGrid_Alpha`. Every later step uses that sha.

- Remove the worktree you used last cycle (`git worktree remove --force <dir>`), then add a
  fresh detached one at the sha (`git worktree add --detach <dir> <sha>`). Never reset a
  worktree in place; `git reset --hard` is a forbidden pattern.
- Measure at the origin tip, never from an older branch tree
  (docs/agent/WORKER_BRIEF.md:33-37).
- If the fetch fails, you are offline. Do steps 2 to 4 against the last fetched sha, label
  every output `offline, as of <sha>`, and make no proposal. Preflight cannot pass
  offline: the routines gate treats an unreachable origin as fatal
  (scripts/check-scheduled-routines.mjs:195-203), and the stall gate needs the local
  origin ref (scripts/raised-hands.mjs:312).
- Read this file again from the new sha. If it changed, follow the new text.

### 2. Read the objective state

- Run `node scripts/objective-loop.mjs --json`. It derives the verdict and the ranked
  queue and writes nothing (scripts/objective-loop.mjs:3).
- If you read `docs/agent/objective-state.json` directly, trust its `verdict` only
  through `readVerdict(state, { heartbeat, nowIso })` (scripts/objective-loop.mjs:400-408).
  The verdict is `unknown` unless `artifacts/agent-heartbeats/mac-lane-tick.json` is
  younger than `staleAfterHours` AND its `result` names `objective: <verdict>`
  (docs/DECISION_RECORDS.md:3982). `unknown` means escalate. Never build on it.
- Read `escalations[]`. An item with `clears: owner` belongs to the owner. You may remind
  the owner of it. You never answer it.

### 3. Run the read-only queue tools

Run each of these every cycle. None writes the tree, none needs a token, none needs a
model:

- `pnpm run loop:state`
- `pnpm run lane:inbox`
- `pnpm run hands`
- `pnpm run sim:run-requests --plan`
- `node scripts/objective-loop.mjs --json` (already run in step 2)

Keep every output. Quote it in anything you write later. A triage tool for the backlog is
being built on the branch `claude/build-backlog-landing-skill` and is not on mainline at
the `measuredAt` commit. Use it only once a row for it appears in the tables below.

### 4. Run the checks

Every cycle, run the rows in "Run any cycle (read-only)" that check something: the mail,
sim-request, raised-hand, objective and coverage gates, the local-brain test rows, this
contract's gate, and every self-test those rows name.

Run the heavy rows (preflight, breadth, `test:api`, the Mac harness, the mutation guard,
the falsification check) only for a proposal in step 6, only in your own worktree, and
only while you hold the host verification lock:

- Take the lock the way the ticks do. Write mainline's helper to a temp file with
  `git show <sha>:scripts/mac/host-verification-lock.sh`, source it in the shell that will
  run the chain, then call
  `sg_host_verify_acquire "$HOME/Library/Caches/signalgrid/host-verification.lock"`
  (scripts/mac/lane-tick.sh:285-298, scripts/mac/host-verification-lock.sh:9-22).
- The lock lives on file descriptor 9 of that shell. Run the heavy chain as children of
  that shell, and call `sg_host_verify_release` as soon as the chain ends.
- A non-zero return means another chain holds the lock. Skip the heavy rows this cycle.
  Do not wait in a loop.
- Yield to the lane tick. Read the last two committed versions of
  `artifacts/agent-heartbeats/mac-lane-tick.json` at your sha
  (`git log -2 --format=%H <sha> -- artifacts/agent-heartbeats/mac-lane-tick.json`, then
  `git show <commit>:artifacts/agent-heartbeats/mac-lane-tick.json`). If both `result`
  strings start with `deferred:`, do not take the lock this cycle. A `skipped:` result is
  not a deferral. A deferred tick does not evaluate the objective
  (scripts/mac/lane-tick.sh:281), and the tick is the only writer of the objective state
  (docs/DECISION_RECORDS.md:3980).
- A check that could not run is reported as "could not run", never as a pass
  (docs/DECISION_RECORDS.md:4033). A skip is not a pass. Compare failures against 0 AND
  read the skips (CLAUDE.md:44-56).

### 5. Pick one bounded task

Pick at most one task per cycle. A task is bounded when you can name, before you start,
the exact files you will change, the check that fails without the change, and the checks
that must stay green (docs/agent/ORG.md:196-203, docs/agent/WORKER_BRIEF.md:14-15).

Choose in this order:

1. **Your own scope.** A task whose every file is under `scripts/mac/local-brain/**` and is
   not this contract or its gate. For example, a missing test for one of the local-brain
   modules.
2. **Nothing else.** A ranked `tasks[]` row outside your scope is not yours to build. You
   may read its files and write a triage note, labelled `local-model advice, unreviewed`,
   into a raised hand or a mail draft. You may not edit its files.

Check every candidate:

- Run `classifyDiff` on the file list (the `classify-diff` row). Drop the task if any file
  is DECISION_PATH or OWNER_RESERVED, or SAFETY_MACHINERY outside your scope. Your own
  scope is SAFETY_MACHINERY too: you may propose a change there, never land it.
- Test every file path against the `pathPatterns` of every forbidden row in
  `scripts/mac/local-brain/capabilities.json`. A match drops the task.
- Skip a row that a remote branch or an open PR already names
  (docs/LANE_COORDINATION.md:101-102). If you cannot read the open PR list (no token),
  treat every ranked row as claimed.
- `selectEligible(tasks, "scripts/mac/local-brain")` needs each task as
  `{id, status, priority, scope, dependencies}`
  (scripts/mac/local-brain/task-selector.mjs:1-21). The objective queue's `tasks[]` carries
  none of those fields, so the selector throws `Malformed task` on it. A row you cannot map
  honestly is not eligible.
- Track the task with `JobState` (scripts/mac/local-brain/job-state.mjs:50). It completes
  only after a fresh verification checkpoint by you, with exit code 0 and `passed` above 0
  (scripts/mac/local-brain/job-state.mjs:26-35).
- Drop any task that needs a secret, a tenant, a live vendor call, real customer data, a
  compliance or production claim, a new vertical, connector or platform, or a shared
  surface someone else is editing (docs/agent/ORG.md:176-188).

### 6. Prepare, never merge

- Your local model drafts the change in your worktree, on a branch named
  `mac/local-brain-<slug>-<stamp>`. No registry row declares that prefix yet.
- Test first: write the failing assertion, then the change. A gate ships with a self-test
  that plants at least two mutants (docs/agent/WORKER_BRIEF.md:45-48).
- Deterministic gates judge the change. Your model's opinion of its own work is not
  evidence. Run the changed files' own tests, the local-brain test rows, then
  `node scripts/preflight.mjs` and `pnpm run verify:breadth` on the exact head, holding the
  lock (CLAUDE.md:68-74). Quote each final line.
- Then run `assessProof({ exitCode, tests, pass, fail, skipped, command, changedFiles },
  "scripts/mac/local-brain")` (scripts/mac/local-brain/proof-policy.mjs:42-61). `review`
  means ready for a reviewer. It never means ready to merge. `blocked` means stop.
- Before you run any shell command, test it against the `commandPatterns` of every
  forbidden row. A match means you do not run it.
- Commit locally with the git hooks on. Push nothing unless the grant in step 7 exists.

### 7. Deliver

Every delivery is a push, and a push needs the owner (CLAUDE.md:245-249). Use the first
case that applies.

1. **The owner has granted you pushes in a registry row.** Push your branch. Open a DRAFT
   PR against `SignalGrid_Alpha` with the headings in docs/agent/WORKER_BRIEF.md:65-68.
   Under `## Owner decision needed`, state the `classifyDiff` tier of every file and the
   words `local-model draft, review pending`. Then send one mail to the cloud lane:
   `pnpm run lane:deliver send "<subject>" "<body>" --trailer "Origin: mac-local-brain"`.
   Subject and body are positional; there is no `--to`, `--subject` or `--body` flag
   (scripts/lane-deliver.mjs:83-98). On the Mac this pushes straight to
   `SignalGrid_Alpha` (scripts/lane-deliver.mjs:31-32).
2. **No grant.** Deliver nothing. Prove the mail would pass with `--dry-run`
   (scripts/lane-deliver.mjs:13). Keep the branch, the gate output and the dry-run output
   locally. Tell the owner through your own channel.

No registry row grants you anything today, so case 2 applies until the owner decides.

Mail rules:

- Mail carries knowledge and asks a person for judgment. It never asks for a build
  (docs/LANE_COORDINATION.md:62-66).
- Work for the Mac goes as a sim request, and the lane tick runs it
  (docs/LANE_COORDINATION.md:194-198).
- Only the addressee closes a message. Mail to the Mac lane is not yours to acknowledge
  unless your own work answered it; the repository cannot tell your ack from the Mac
  lane session's (scripts/lane-message.mjs:279-295).

### 8. Raise a hand when stuck

Stop when any step fails, or when you lack a tool, a permission, a token, a reachable
dependency, a consistent input, or a cloud model. Write four things: what you were doing,
what blocked you, exactly what you need, and who can unblock it
(docs/DECISION_RECORDS.md:4009-4016).

- Write it: `pnpm run hand:raise -- --doing "..." --blocked "..." --need "..." --who
  owner|"mac lane"|"cloud lane" --origin mac-local-brain` (scripts/raise-hand.mjs:83-123).
- Deliver it only with a grant: `pnpm run lane:deliver batch <ops.json>` with an op
  `raise` (scripts/lane-deliver.mjs:7-9).
- First check that mainline does not already cover the stall. A duplicate covering hand
  turns stale-fatal later (docs/agent/WORKER_BRIEF.md:38-44).
- Never return partial work as complete. A raised hand is the job done right
  (CLAUDE.md:264).

## Commands: what you may run without cloud credits, and what you must never run

Columns: RO = read-only. Net = `read` reaches the network to read, `write` pushes or opens
a PR. Token = needs a GitHub credential (`optional` uses one if present). macOS = refuses or
only works on macOS. Cloud model = needs Claude or Codex. Self-test = the command, run by a
lane, that keeps the row honest.

Forbidden rows carry regular expressions in `scripts/mac/local-brain/capabilities.json`:
`commandPatterns` for a shell command line and `pathPatterns` for a file you would change.
Each row also carries controls the gate asserts on every run. The patterns are a floor: a
command they miss can still be forbidden by the row's words.

<!-- generated:capabilities:begin (regenerated from capabilities.json by the gate's write mode; never hand-edit) -->

### Run any cycle (read-only) (36 rows)

| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| fetch-mainline | `git fetch origin SignalGrid_Alpha` | Bring the local origin/SignalGrid_Alpha ref up to date before any measurement. | yes | - | read | - | - | - | - | docs/agent/WORKER_BRIEF.md:33-37; scripts/raised-hands.mjs:312 |
| loop-state | `pnpm run loop:state` | Does reality match docs/agent/LOOP.md; the session-start check. | yes | - | read | - | - | - | - | scripts/loop-state.mjs:16-18; package.json:264; CLAUDE.md:263 |
| objective-queue | `node scripts/objective-loop.mjs --json` | Re-derive the objective verdict and the ranked tasks[], needsExecutor[] and escalations[]. Writes nothing. This is the read-only queue tool on mainline today. | yes | - | - | - | - | - | `node scripts/objective-loop.mjs --self-test` | scripts/objective-loop.mjs:3; scripts/objective-loop.mjs:9 |
| objective-check | `node scripts/objective-loop.mjs --check` | The contract gate over the committed docs/agent/objective-state.json. | yes | - | - | - | - | - | - | scripts/objective-loop.mjs:8 |
| objective-read-verdict | `import { readVerdict } from './scripts/objective-loop.mjs'  // readVerdict(state, { heartbeat, nowIso })` | The only correct way to trust the committed verdict: unknown unless the mac-lane-tick heartbeat is within staleAfterHours AND names that verdict. | yes | - | - | - | - | - | - | scripts/objective-loop.mjs:394-406; docs/DECISION_RECORDS.md:3982 |
| lane-inbox | `pnpm run lane:inbox` | Mail addressed to this lane (mac on macOS) and your origin branches mainline does not carry. Never reaches the network; reads refs from the last fetch. | yes | - | - | - | - | - | - | scripts/lane-message.mjs:334; scripts/lib/lane-identity.mjs:20-23; package.json:229 |
| lane-messages-gate | `pnpm run lane:messages` | Mail gate: unread is reported, never fatal; only incoherent acks fail. | yes | - | - | - | - | - | `node scripts/check-lane-messages.mjs --self-test` | scripts/check-lane-messages.mjs:4 |
| sim-requests-gate | `pnpm run sim:requests` | Every sim result binds to a request; pending is reported, never green. | yes | - | - | - | - | - | `node scripts/check-sim-requests.mjs --self-test` | scripts/check-sim-requests.mjs:4 |
| sim-plan | `pnpm run sim:run-requests --plan` | What the Mac owes: one PENDING line per request; runs and writes nothing. | yes | - | - | - | - | - | `node scripts/mac/run-requests.mjs --self-test` | scripts/mac/run-requests.mjs:293; scripts/mac/run-requests.mjs:327; package.json:237 |
| hands | `pnpm run hands` | Everything stuck, grouped by who can clear it. | yes | - | - | - | - | - | - | scripts/raised-hands.mjs:312-314; package.json:278 |
| hands-stall-gate | `node scripts/raised-hands.mjs --check` | Exit 1 when a stall is past 3x its limit with no hand covering it. | yes | - | - | - | - | - | `node scripts/raised-hands.mjs --self-test` | scripts/raised-hands.mjs:6; scripts/raised-hands.mjs:790-797; docs/agent/WORKER_BRIEF.md:38-44 |
| hands-register | `node scripts/check-raised-hands.mjs --json` | Validate every hand file and route it to a role, lane, tool or a named GAP. | yes | - | - | - | - | - | `node scripts/check-raised-hands.mjs --self-test` | scripts/check-raised-hands.mjs:6 |
| hands-list | `node scripts/raise-hand.mjs --list` | List open hands from the local ledger. | yes | - | - | - | - | - | - | scripts/raise-hand.mjs:18 |
| classify-diff | `node --input-type=module -e 'import {classifyDiff} from "./scripts/check-owner-gated-surfaces.mjs"; console.log(JSON.stringify(classifyDiff(process.argv.slice(1))))' <path>...` | Tier of the files you would touch: autonomous or owner-gated (DECISION_PATH, SAFETY_MACHINERY, OWNER_RESERVED). The CLI of that script does NOT classify; use the import. | yes | - | - | - | - | - | - | scripts/check-owner-gated-surfaces.mjs:119-129; scripts/check-owner-gated-surfaces.mjs:318-323; scripts/check-owner-gated-surfaces.mjs:43 |
| owner-gated-manifest | `node scripts/check-owner-gated-surfaces.mjs --self-test` | Validate the owner-gated manifest itself. | yes | - | - | - | - | - | `node scripts/check-owner-gated-surfaces.mjs --self-test` | scripts/check-owner-gated-surfaces.mjs:8; scripts/check-owner-gated-surfaces.mjs:321-323 |
| check-absence | `pnpm run check:absence <topic>` | Four probes before any sentence of the form 'X does not exist'. Exit 0 corroborated, 1 refuted, 2 inconclusive. | yes | - | - | - | - | - | `node scripts/agent/absence-check.mjs --self-test` | scripts/agent/absence-check.mjs:3-9; package.json:232 |
| docs-retrieve | `pnpm run docs:retrieve -- "<question>"` | Local-embedding retrieval over tracked docs: returns paths and line ranges, a pointer, never a fact. No key, no LLM. | yes | - | - | - | - | - | - | scripts/docs-retrieval.mjs:2; scripts/docs-retrieval.mjs:7; package.json:276 |
| dispatch | `pnpm run dispatch "<task text>"` | Deterministic LOCAL vs CLOUD nudge for a task. Not a law. | yes | - | - | - | - | - | - | scripts/dev-dispatch.mjs:2-6; package.json:42 |
| role-queue | `pnpm run role:queue [-- <role-id>]` | Per role: owned files and the unread remainder, ordered by consequence. | yes | - | - | - | - | - | - | scripts/role-work-queue.mjs:3-5 |
| readiness-figure | `node scripts/check-readiness-figure.mjs --json` | The derived readiness figure (DR-036). Exit 0 on any number, 1 only if broken. | yes | - | - | - | - | - | `node scripts/check-readiness-figure.mjs --self-test` | scripts/check-readiness-figure.mjs:6 |
| statusline | `bash scripts/mac/statusline.sh` | Branch, open hands and unread mail from files on disk; no fetch, no network. | yes | - | - | - | - | - | `bash scripts/mac/statusline.sh --self-test` | docs/LANE_COORDINATION.md:349-368; scripts/mac/statusline.sh:6 |
| local-brain-job-state-tests | `node scripts/mac/local-brain/test/job-state.test.mjs` | Proof of the job state machine: a job completes only after a fresh, successful verification checkpoint by the worker that holds it. | yes | - | - | - | - | - | `node scripts/mac/local-brain/test/job-state.test.mjs` | scripts/mac/local-brain/job-state.mjs:26-35; scripts/preflight.mjs:110-112 |
| local-brain-task-selector-tests | `node scripts/mac/local-brain/test/task-selector.test.mjs` | Proof of the eligible-task selector: queued, in scope, dependencies reviewed, ordered by priority then id; a malformed task throws. | yes | - | - | - | - | - | `node scripts/mac/local-brain/test/task-selector.test.mjs` | scripts/mac/local-brain/task-selector.mjs:1-21; scripts/preflight.mjs:110-112 |
| local-brain-proof-policy-tests | `node scripts/mac/local-brain/test/proof-policy.test.mjs` | Proof of the proof-policy assessor: 'review' only when every test passed, none failed or skipped, and every changed file is in scope. | yes | - | - | - | - | - | `node scripts/mac/local-brain/test/proof-policy.test.mjs` | scripts/mac/local-brain/proof-policy.mjs:42-61; scripts/preflight.mjs:110-112 |
| local-brain-capabilities-gate | `node scripts/check-local-brain-capabilities.mjs` | This contract's own gate: every row's command exists, every self-test runs in a lane, every forbidden pattern holds its controls, and capabilities.json and CAPABILITIES.md agree. | yes | - | - | - | - | - | `node scripts/check-local-brain-capabilities.mjs --self-test` | scripts/check-local-brain-capabilities.mjs:1 |
| land-branch-gate | `node scripts/lib/land-branch-gate.mjs --self-test` | The pure push gate: refuses unless both exits are 0 AND both sentinel lines name the head. canPush(run, expectedHead) is importable. | yes | - | - | - | - | - | `node scripts/lib/land-branch-gate.mjs --self-test` | scripts/lib/land-branch-gate.mjs:14 |
| stage-helper-self-test | `node scripts/mac/build-tick-stages.mjs --self-test` | Self-test of the build tick's stage helper (the SG_STAGE_RUNNER seam lives here). | yes | - | - | - | - | - | `node scripts/mac/build-tick-stages.mjs --self-test` | scripts/mac/build-tick-stages.mjs:10; scripts/mac/build-tick-stages.mjs:191-199 |
| lane-deliver-dry-run | `pnpm run lane:deliver send "<subject>" "<body>" --dry-run` | Build and gate a delivery in a throwaway worktree, push nothing, keep nothing. Use it to prove a mail would pass before you ask for a push. | yes | - | read | - | - | - | - | scripts/lane-deliver.mjs:13; scripts/lane-deliver.mjs:296; scripts/lane-deliver.mjs:83-98 |
| launchd-status | `bash scripts/mac/install-launchd.sh --status` | Is the 5-minute lane tick loaded; tail of its log. | yes | - | - | - | yes | - | - | scripts/mac/install-launchd.sh:33-36; scripts/mac/install-launchd.sh:45-47 |
| build-tick-status | `bash scripts/mac/install-build-tick.sh --status` | Is the build tick's launchd job loaded, at which interval (it retries every 5 minutes), and the tail of its log. | yes | - | - | - | yes | - | - | scripts/mac/install-build-tick.sh:4-10; scripts/mac/install-build-tick.sh:39-41 |
| build-tick-dry-run | `bash scripts/mac/build-tick.sh --dry-run` | Print the row a real run would pick and every stage command; runs no stage. | yes | - | read | yes | yes | - | - | scripts/mac/build-tick.sh:390-393 |
| coverage-gate | `node scripts/check-surface-review-coverage.mjs` | Every tracked file belongs to a surface; the generated page must not be stale. | yes | - | - | - | - | - | `node scripts/check-surface-review-coverage.mjs --self-test` | scripts/check-surface-review-coverage.mjs:6 |
| preflight-list | `node scripts/preflight.mjs --list-steps` | Print every preflight step as JSON; runs none. | yes | - | - | - | - | - | - | scripts/preflight.mjs:804-808 |
| breadth-membership | `node scripts/verify-breadth.mjs --self-test` | Breadth-lane membership derivation only; runs no proof. | yes | - | - | - | - | - | `node scripts/verify-breadth.mjs --self-test` | scripts/verify-breadth.mjs:248-249 |
| routines-gate | `node scripts/check-scheduled-routines.mjs` | Hold the routine registry against heartbeats; lists origin heads for retired routines. | yes | - | read | - | - | - | - | scripts/check-scheduled-routines.mjs:195-203 |
| scan-estate | `pnpm run scan:estate` | Cited-path check across the declared estate; a repo it cannot reach is NOT SCANNED, never clean. | yes | - | - | - | - | - | - | scripts/scan-estate-citations.mjs:16-19; scripts/scan-estate-citations.mjs:29-40 |

### Run only in your own worktree (9 rows)

| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| typecheck | `pnpm run typecheck` | tsc over the libs and every artifact. | yes | - | - | - | - | - | - | CLAUDE.md:113-114 |
| review-invariants | `pnpm run review:invariants` | The determinism and fail-closed invariants (golden rule 2). | yes | - | - | - | - | - | - | CLAUDE.md:28-31 |
| proof | `pnpm run proof:*` | One deterministic in-process proof: replace * with the name of a proof script in package.json. A proof that self-skips without DATABASE_URL is SELF-SKIPPED, never passed. | - | yes | - | - | - | - | - | CLAUDE.md:113-114; scripts/preflight.mjs:677; scripts/preflight.mjs:684 |
| build-loop | `pnpm run loop` | Fast gate set turned into findings. | - | yes | - | - | - | - | - | scripts/build-loop.mjs:144-152 |
| hand-raise-file | `pnpm run hand:raise -- --doing "..." --blocked "..." --need "..." --who owner\|"mac lane"\|"cloud lane" --origin mac-local-brain` | Write one DR-054 hand record. It is not delivered until it reaches mainline. | - | yes | - | - | - | - | - | scripts/raise-hand.mjs:6-13; scripts/raise-hand.mjs:83-123; CLAUDE.md:264 |
| lane-send-file | `pnpm run lane:send "<subject>" "<body>"` | Write a mail file addressed to the OTHER lane (cloud, from the Mac). Writing is not delivering. | - | yes | - | - | - | - | - | scripts/lane-message.mjs:208-215; docs/LANE_COORDINATION.md:62-66 |
| sync-manifest | `node scripts/generate-sync-manifest.mjs` | Regenerate the live-sync manifest after a cross-surface contract change. Never hand-edit it. | - | yes | - | - | - | - | - | docs/LANE_COORDINATION.md:438-439 |
| coverage-write | `node scripts/check-surface-review-coverage.mjs --write` | Regenerate docs/agent/SURFACE_REVIEW_COVERAGE.md, only on a fully staged index. | - | yes | - | - | - | - | - | docs/LANE_COORDINATION.md:317-320 |
| local-commit | `git commit (hooks on) on your own branch in your own worktree` | Record a proposal locally. Attribute it to the runtime that produced it; never a Claude author or session URL. | - | yes | - | - | - | - | - | docs/agent/WORKER_BRIEF.md:105-108; CLAUDE.md:262 |

### Run only in your own worktree, holding the host lock (6 rows)

| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| preflight | `node scripts/preflight.mjs` | The per-push lane CI mirrors. Stops at the first failure; classifies each pass as ok, SELF-SKIPPED, NOT VERIFIED, REPORTED or UNAVAILABLE. | - | yes | read | optional | - | - | - | CLAUDE.md:68-74; docs/agent/WORKER_BRIEF.md:58-62; scripts/mac/host-verification-lock.sh:9-22; scripts/mac/lane-tick.sh:296; scripts/preflight.mjs:46-58 |
| verify-breadth | `pnpm run verify:breadth` | The breadth lane: every STEPS entry, its own CI job. | yes | - | - | - | - | - | - | CLAUDE.md:68-74; scripts/mac/host-verification-lock.sh:9-22; scripts/mac/lane-tick.sh:296; scripts/preflight.mjs:46-58 |
| test-api | `pnpm --filter @workspace/api-server run test:api` | Boots the api-server on loopback and asserts N/N; compare passed against total. | yes | - | - | - | - | - | - | CLAUDE.md:107-112; scripts/mac/host-verification-lock.sh:9-22; scripts/mac/lane-tick.sh:296; scripts/preflight.mjs:46-58 |
| validate-sim-macos | `./validate-sim-macos.sh` | The local Mac harness. Narrower than preflight. Compare M against 0 AND read S. | - | yes | - | - | yes | - | - | validate-sim-macos.sh:109-111; CLAUDE.md:44-56 |
| mutation-guard | `pnpm run guard:mutations` | Mutation sweep; writes mutated copies over tracked source files and restores them. About 40 minutes. | - | yes | - | - | - | - | - | scripts/mutation-guard.mjs:2226-2234; docs/LANE_COORDINATION.md:436-437 |
| gate-falsification | `node scripts/check-pr-gate-falsification.mjs --base <ref> --head <ref>` | For the lines a diff changed, can any gate still go red. Fail-closed by construction. | - | yes | - | - | - | - | `node scripts/check-pr-gate-falsification.mjs --self-test` | scripts/check-pr-gate-falsification.mjs:2-15 |

### Only after the owner grants it (8 rows)

| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| lane-deliver-send | `pnpm run lane:deliver send "<subject>" "<body>" --trailer "Origin: mac-local-brain"` | Deliver mail. On the Mac it pushes straight to SignalGrid_Alpha from a throwaway worktree. | - | - | write | yes | - | - | - | scripts/lane-deliver.mjs:4; scripts/lane-deliver.mjs:31-32; scripts/lane-deliver.mjs:302; CLAUDE.md:245-249 |
| lane-deliver-via-pr | `pnpm run lane:deliver send "<subject>" "<body>" --via-pr --trailer "Origin: mac-local-brain"` | Deliver mail on a lane/mac-mail-&lt;stamp&gt; branch instead of mainline; someone must still land it. | - | - | write | yes | - | - | - | scripts/lane-deliver.mjs:14; scripts/lane-deliver.mjs:302-303 |
| lane-deliver-raise | `pnpm run lane:deliver batch <ops.json>   # op: raise / take / clear` | Deliver a raised hand (or take / clear one) in one step. | - | - | write | yes | - | - | - | scripts/lane-deliver.mjs:7-9 |
| lane-deliver-heartbeat | `pnpm run lane:deliver heartbeat <routine-id> "quiet \| acted: what"` | A heartbeat for a registered routine. | - | - | write | yes | - | - | - | scripts/lane-deliver.mjs:196-204 |
| lane-deliver-ack | `pnpm run lane:deliver ack <message-id> "<what you did>"` | Close a message addressed to the Mac lane. | - | - | write | yes | - | - | - | scripts/lane-message.mjs:279-295 |
| push-own-branch | `git push origin HEAD:refs/heads/mac/local-brain-<slug>-<stamp>` | Publish a proposal branch. Never SignalGrid_Alpha, never another unit's branch, never forced. | - | - | write | yes | - | - | - | CLAUDE.md:245-249; docs/agent/WORKER_BRIEF.md:88-92 |
| open-draft-pr | `open a DRAFT pull request against SignalGrid_Alpha with the WORKER_BRIEF headings` | Carry a proposal to review. Under '## Owner decision needed' state the classifyDiff tier of every file. | - | - | write | yes | - | - | - | docs/agent/WORKER_BRIEF.md:63-76; AGENTS.md:73-82 |
| build-tick-with-runner | `be the host executable named by SG_STAGE_RUNNER (protocol 1: one JSON request on stdin, one result envelope on stdout)` | The in-tree seam that lets a host executable replace the claude CLI for each build-tick stage, once the owner points SG_STAGE_RUNNER at it. The build tick, not the runner, pushes and opens the PR; nothing merges. | - | - | write | yes | yes | - | - | scripts/mac/build-tick-stages.mjs:191-199; scripts/mac/build-tick-stages.mjs:222-258; docs/LANE_COORDINATION.md:76-86; docs/agent/scheduled-routines.json:92-93; docs/agent/scheduled-routines.json:101-102 |

### Your floor: these need a cloud model (4 rows)

| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| review-stage | `independent review of a proposal (DR-060 rule 1: review runs on Opus)` | The judgment a landing needs. When the Opus tier is unavailable, the review WAITS; it is never downgraded. | yes | - | - | - | - | yes | - | docs/DECISION_RECORDS.md:4122; docs/DECISION_RECORDS.md:3159; docs/agent/WORKER_BRIEF.md:21-23 |
| dr037-landing | `landing a product PR under DR-037` | The cloud lane's conditional merge: five conditions, including reading review threads and judging bot findings. | - | - | write | yes | - | yes | - | docs/DECISION_RECORDS.md:2230-2261; .claude/skills/landing-under-dr-037/SKILL.md:13-34 |
| land-branch-workflow | `.claude/workflows/land-branch.js (Claude Workflow tool)` | Generic landing workflow run by Claude worker agents. | - | yes | write | yes | - | yes | - | .claude/workflows/land-branch.js:1-45 |
| brain-cycle-board | `node scripts/brain-cycle.mjs --board <dir>` | Decide and report over an audit board that Claude lens agents wrote; the script cannot spawn the lenses, and its routine is retired. | - | yes | read | - | - | yes | `node scripts/brain-cycle.mjs --self-test` | scripts/brain-cycle.mjs:1-19; docs/agent/scheduled-routines.json:105 |

### Never run or change these (10 rows)

| Name | What it covers | Why | Command patterns | Path patterns | Source |
| --- | --- | --- | :-: | :-: | --- |
| merge | any merge of a pull request or push to SignalGrid_Alpha that lands code: gh api -X PUT .../pulls/&lt;n&gt;/merge, a merge_pull_request tool, enabling auto-merge, git push origin HEAD:SignalGrid_Alpha | Agents never merge their own work; a local model's advice grants no writer or merge authority. | 6 | 0 | AGENTS.md:84; docs/agent/WORKER_BRIEF.md:92; docs/agent/ORG.md:165; docs/agent/scheduled-routines.json:93 |
| approve | submitting a pull-request review with event APPROVE | Approval is a human act. | 2 | 0 | docs/DECISION_RECORDS.md:2244-2245 |
| close | closing any pull request or issue; above all the mailbox PR (docs/agent/lane-mailbox.json) | The mailbox PR is never merged and never closed; closing it removes the wake channel. | 3 | 0 | docs/LANE_COORDINATION.md:159-163 |
| delete | pnpm run branches:clean; APPLY=true node scripts/prune-merged-branches.mjs; git push origin --delete &lt;ref&gt; or :&lt;ref&gt;; git branch -D or -d (any); deleting files under artifacts/raised-hands or artifacts/lane-messages; a DELETE call to the GitHub API; rm -rf outside your own worktree | Branch deletion and other destructive git are the owner's to approve. | 6 | 0 | CLAUDE.md:245-249; docs/DECISION_RECORDS.md:2261; scripts/cleanup-merged-branches.sh:1-6; scripts/prune-merged-branches.mjs:5-6 |
| force-push | git push --force / --force-with-lease / -f / a +refspec; git rebase (any); git reset --hard (any); git filter-branch or filter-repo | Never force-push or rewrite history. | 4 | 0 | CLAUDE.md:262; docs/agent/WORKER_BRIEF.md:88-89 |
| bypass | --no-verify; git -c core.hooksPath=...; lane:deliver --allow-ungated; git stash (any); setting CI or GITHUB_ACTIONS on the Mac; deleting or moving the build tick's paused file; quiet flags | Never bypass a check. The paused file is for a person to clear. | 6 | 0 | CLAUDE.md:262; scripts/lane-deliver.mjs:16-17; scripts/check-ci-liveness.mjs:110; scripts/mac/build-tick.sh:395-404 |
| send-outside | uploading, quoting or embedding anything under reference/knowledge; sending repository content to any remote service other than the owner's own Claude or Codex escalation; posting PR comments, issues, email or chat in the owner's name | The corpus is confidential; sending data to an external service needs the owner. | 2 | 1 | scripts/mac/sg-brain-link.sh:12-18; CLAUDE.md:245-249; docs/agent/RESOURCE_INTAKE.md:72-74 |
| run-another-units-job | bash scripts/mac/lane-tick.sh; bash scripts/mac/build-tick.sh (a real run); node scripts/objective-loop.mjs --write [--deliver]; pnpm run sim:run-requests (without --plan); install-launchd.sh or install-build-tick.sh without --status; pnpm run sync; bash scripts/mac/mcp-up.sh; bash scripts/mac/sg-brain-link.sh; verify:all --emit-evidence | Those are launchd jobs, the tick's single-writer steps, or the owner's one-time commands. Running them by hand races them or pushes. | 11 | 0 | docs/DECISION_RECORDS.md:3980; docs/LANE_COORDINATION.md:47-52; docs/LANE_COORDINATION.md:88-91; scripts/sync.mjs:1-8 |
| product-boundary | any edit under lib/**, artifacts/api-server/**, native/ios/EnterpriseShell/Services/DecisionEngine.swift or AppWorkflows.swift, the launch profile, the launch-claims gate, the publication boundary, AGENTS.md or docs/DECISION_RECORDS.md; db:restore; db:migrate | Decision path and owner-reserved surfaces; a model never decides a verdict. | 1 | 9 | CLAUDE.md:24-31; scripts/check-owner-gated-surfaces.mjs:89-91; docs/DECISION_RECORDS.md:2254-2261; docs/AGENT_GATEWAY.md:23-27 |
| own-contract | editing this contract (scripts/mac/local-brain/CAPABILITIES.md, scripts/mac/local-brain/capabilities.json) or its gate (scripts/check-local-brain-capabilities.mjs) | You never change your own rules or your own judge. A change to either is the cloud lane's or the owner's. | 0 | 2 | scripts/check-owner-gated-surfaces.mjs:43; docs/DECISION_RECORDS.md:3272-3274 |

<!-- generated:capabilities:end -->

## Authority rules, with their sources

1. You never merge, approve, close or delete. AGENTS.md:84, docs/agent/ORG.md:165,
   docs/agent/WORKER_BRIEF.md:92, docs/DECISION_RECORDS.md:2244-2245,
   docs/DECISION_RECORDS.md:2261.
2. A local model's advice grants no writer or merge authority
   (docs/agent/scheduled-routines.json:93). A provider being available or unavailable
   changes who does the work, never what is authorized (docs/LANE_COORDINATION.md:344-345,
   docs/agent/WORKER_BRIEF.md:3-7).
3. A model may propose, block or escalate. It never authorizes
   (docs/DECISION_RECORDS.md:3968).
4. Review, specs and gate design run on the Opus tier (docs/DECISION_RECORDS.md:4122). When
   that tier is unavailable, judgment work waits. It is never downgraded to a weaker model
   (docs/DECISION_RECORDS.md:3158-3159). An unavailable capable provider leaves the task
   pending; it never counts as a completed worker (docs/agent/WORKER_BRIEF.md:21-23).
5. A usage limit is an event, not an ending. Record the unit as pending and re-issue it
   later. Never drop it (docs/DECISION_RECORDS.md:3160).
6. No model enters the decision path. Nothing under `lib/*`, the `/v1` decision path, a
   connector or a proof may call, import or depend on a model, local or remote
   (docs/AGENT_GATEWAY.md:23-27, docs/AGENT_GATEWAY.md:67-71). You may read and run that
   code; you may not wire a model into it.
7. Ask the owner before destructive git, before sending data to an external service, and
   before committing or pushing unless asked (CLAUDE.md:245-249).
8. Never bypass a check: no `--no-verify`, no stash to dodge a gate, no quiet flags, no
   force-push (CLAUDE.md:262).
9. Owner-gated surfaces. SAFETY_MACHINERY includes `scripts/**`, `.github/workflows/**`,
   the `.claude` instruction surfaces and the decision records. DECISION_PATH is `lib/**`,
   `artifacts/api-server/**` and the two byte-faithful Swift ports. OWNER_RESERVED includes
   the launch profile, pricing, compliance documents and the buyer-facing site
   (scripts/check-owner-gated-surfaces.mjs:43-91).
10. You never edit this contract, `scripts/mac/local-brain/capabilities.json` or
    `scripts/check-local-brain-capabilities.mjs`. You never change your own rules or your
    own judge (docs/DECISION_RECORDS.md:3272-3274).
11. Shared surfaces have one holder at a time. Announce in the commit. If another lane has
    recent or uncommitted changes there, stop and hand back to the owner
    (docs/agent/ORG.md:132-148, docs/LANE_COORDINATION.md:254-264).
12. The owner's knowledge corpus under `reference/knowledge` is confidential. Never upload
    it, quote it or commit it (scripts/mac/sg-brain-link.sh:12-18).
13. Keys stay out of the tree. No secrets into third-party tools
    (docs/AGENT_GATEWAY.md:28-30, docs/agent/RESOURCE_INTAKE.md:72-74).
14. Truth: never claim pass, exists, fixed or absent without running the command and
    quoting its output (CLAUDE.md:260). Before writing "X does not exist", run
    `pnpm run check:absence <topic>`. The accuracy doctrine binds you
    (docs/agent/ORG.md:3-27).
15. The build and verify lane preempts you. Never keep a GB-scale model resident; load it
    on demand and unload it (docs/DECISION_RECORDS.md:3278-3279,
    docs/DECISION_RECORDS.md:3351-3353).
16. Done means the gates passed with quoted output AND the commit is confirmed on origin
    with `git ls-remote` (CLAUDE.md:261). Without a push grant your work is "prepared",
    never "done".

## When no cloud model is available

This is the bounded-proposal path. Follow it whenever Claude and Codex are both out of
usage or credits.

1. **Your local model drafts.** Only inside your scope, only in your worktree, one bounded
   task at a time (steps 5 and 6).
2. **Deterministic gates judge.** The tests, preflight, breadth and `assessProof` decide
   whether the draft is ready for review. Your model does not.
3. **A PR or lane mail carries it.** With a push grant, a DRAFT PR plus one mail (step 7,
   case 1). Without one, the branch and its gate output stay on the Mac (step 7, case 2).
4. **Review waits.** It waits for Claude or Codex credits, or for a different capable
   model the owner names. A local model never stands in for the review tier
   (docs/DECISION_RECORDS.md:3159, docs/DECISION_RECORDS.md:4122).
5. **You never self-merge** (AGENTS.md:84).

What you keep doing while the cloud is dark:

- Steps 1 to 4 every cycle. They need no model.
- Look for stalls nobody raised a hand for (`pnpm run hands`), and draft the hand.
- Keep a pending list: each unit that needed a cloud model, what it was, and which tier
  it asked for, so it is re-issued when credits return (docs/DECISION_RECORDS.md:3160).
- Make at most one cloud call attempt per cycle. Record a refusal or a usage-limit reply.
  Do not retry it in a loop.

Precedent: the account's weekly Claude limit ran out on 2026-10-09 and reset on
2026-10-15. The hand that records it says the cloud brain and every worker were dark for
5 days 17 hours
(`artifacts/raised-hands/2026-10-15-the-account-s-weekly-claude-usage-limit-seven-da.json`).
That is the window this path is for.

### If the owner makes you the build tick's stage runner

The build tick can hand each stage to a host executable named by `SG_STAGE_RUNNER`
instead of the claude CLI (scripts/mac/build-tick-stages.mjs:191-199). Only the owner sets
it (the `build-tick-with-runner` row). If the owner points it at you:

- You get one protocol-1 JSON request on stdin and return the existing result envelope
  (scripts/mac/build-tick-stages.mjs:254-258).
- You enforce read-only triage and review, credential isolation, the limits, and fresh
  independent review sessions. You report the provider and model that actually ran;
  unknown cost stays unknown (docs/LANE_COORDINATION.md:76-86).
- Refuse any stage you cannot honestly serve. The review stage asks for the Opus tier
  (scripts/mac/build-tick-stages.mjs:75), so a local model refuses it. Today a refusal
  pauses the whole tick until a person clears it (scripts/mac/build-tick.sh:395-404). That
  is a known gap; raise a hand when it happens.
- The build tick, not you, pushes and opens the PR. Nothing in it merges.
- The registry lists the job `active`, retrying every 5 minutes
  (docs/agent/scheduled-routines.json:92). Its activation evidence proves a firing, not a
  completed build (docs/agent/scheduled-routines.json:102).
- With no runner and no Claude credits, its Claude stages break and the tick pauses
  itself until a person deletes the paused file (scripts/mac/build-tick.sh:395-404). That
  file is not yours to delete.

## How this contract is checked

`node scripts/check-local-brain-capabilities.mjs` runs in preflight and in CI. It fails
when any of these stops being true:

- every row has its fields, a known policy and a known kind, and no name repeats;
- every row's package script, tracked file and export exist;
- every self-test a row names is a step that preflight or the breadth lane lists, or a
  workflow `run:` line;
- every cited source file is tracked and every cited line is inside it;
- the flags agree with the policy: only `cloud-model` rows need a cloud model, an
  `allowed` row writes nothing, an `owner-grant` row writes to the network;
- every forbidden pattern compiles, matches each of its `mustMatch` controls and none of
  its `mustNotMatch` controls, and every pattern is exercised by a control;
- no command or self-test listed outside the forbidden rows matches a forbidden pattern;
- the tables above equal what the gate renders from `capabilities.json`;
- no typed count or pass ratio appears in this file outside the tables, or in a row's
  text.

`node scripts/check-local-brain-capabilities.mjs --self-test` plants one violation per
rule and requires each to fail, with the real contract as the control.
`node scripts/check-local-brain-capabilities.mjs --write` regenerates the tables; it is the
only writer of the generated block.

## Known gaps that affect you

The full list, with fixes and owners, is the section "The owner's 2026-10-22 local-brain
share — gaps (cloud lane)" in `docs/BUILD_BACKLOG.md`. The ones that change what you do
today:

- No registry row declares you, so no push, mail or heartbeat is granted, and the
  heartbeat channel refuses you (scripts/lane-deliver.mjs:196-204).
- Nothing you write in your own scope can land without an Opus-tier review, because the
  scope is SAFETY_MACHINERY (scripts/check-owner-gated-surfaces.mjs:43).
- The ranked queue carries no scope, so no ranked row is in your scope, and
  `selectEligible` throws on it.
- A refused review stage pauses the build tick instead of parking the row
  (scripts/mac/build-tick-stages.mjs:296-298).
- Your mail and acks are indistinguishable from the Mac lane session's
  (scripts/lib/lane-identity.mjs:17-23).
