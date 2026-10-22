---
name: backlog-landing
description: Use when the open PR, issue and branch backlog has to be worked down to zero honestly — the owner asks to get all the branches merged, clear the PR queue, or find what is stale. One queue command, DR-037 landings one at a time, owner-gated PRs kept mergeable, everything else filed as one evidenced list. The brain never approves, closes, deletes or force-pushes. Not for one green PR (landing-under-dr-037), one stuck item (raised-hands) or fanning out build work (orchestrator-over-workers).
---

# Working the backlog to zero

The owner, 2026-10-22: *"look for all these issues and pull requests plus need to get
all the branches merged into main branch."* This skill is how any lane does that
without cutting a corner the repo already forbids. Read "Never" before you act.

**Zero is not an empty list.** It is: every open PR, issue and unmerged branch has a
disposition, a named actor and one quoted piece of evidence. The lane lands what
DR-037 lets it land. Everything else is filed, in one list, with the person who can
act. A PR closed to shrink the number, or merged to shorten the owner's queue, is the
failure this skill exists to prevent (CLAUDE.md, "Truth and completion").

## What leaves the machine

| What leaves | To whom | Under whose credential | Can it be turned off | Credential absent |
| --- | --- | --- | --- | --- |
| GET requests carrying the repository slug, PR and issue numbers, head SHAs and changed-file paths, all of which GitHub already holds. No local file, no file content and no PR text is sent. | `api.github.com` over HTTPS; the host is a constant in `scripts/backlog-triage.mjs` | `GH_TOKEN` or `GITHUB_TOKEN`, sent as the Authorization header to that host only, never printed | Do not run the queue command. `--no-local-git` only stops the tool running git | exit 2 and no queue; a placeholder, a rejected or an anonymous answer is the same |

The `gh api` commands later in this skill are the same kind of read under the harness's own
credential. The one write the skill asks for is the section 5 comment, and that is the
brain's act, not the tool's.

## 1 — Start, then get the queue

```bash
pnpm run loop:state     # quote the output (CLAUDE.md, session ritual)
pnpm run lane:inbox     # what the other lane needs you to know, before you touch its PRs
pnpm run hands          # what is stuck, grouped by who clears it
node scripts/backlog-triage.mjs > "$SCRATCH/queue.md"
```

The last command is the queue. It sends GET requests only (`docs/agent/BACKLOG_LANDING.md`
lists its flags) and writes nothing unless you pass `--snapshot <page>`, which rewrites the
one block between that page's markers. If it ever merges, comments, closes or writes
anywhere else, that is a defect: raise a hand. It needs `GH_TOKEN` or `GITHUB_TOKEN`
(it does not call `gh`) and says so, with exit 2, when the token is missing, a
placeholder, rejected or anonymous; exit 3 when the lists disagree with the repository's
own open count. In both cases there is no queue, and an empty page is never an empty
queue. Do not rebuild one from memory. Read the exit code and the first lines of output:
they say what was read, when, against which mainline sha, and which source answered
ancestry. If the tool is missing or exits non-zero, stop and raise a hand (DR-054). A
by-hand fallback is quoted `gh api` output only: `--paginate`, and `pulls/<n>` for each PR,
because the list endpoint omits `mergeable_state`.

It prints, in order: that header, the disposition totals, a disposition-by-lane matrix,
one row per PR (sorted by disposition, then number), an UNKNOWN section with the reason
for each unplaced PR, the open issues with same-title groups, and the branches that carry
no open PR. `--json` is the same data for a script. Save the output and quote every count
from it. It costs about six requests per open PR from the account-wide rate limit that every
other session shares: read it once per sweep, not once per PR.

Tell it what only a person knows: `--declared-live 1559,1586:worker B91` names PRs a
worker is pushing to now, and `--threads-file` supplies exact review-thread counts you read
elsewhere (below).

| Disposition | What the tool checked | The brain |
| --- | --- | --- |
| LAND-UNDER-DR-037 | a cloud-lane branch (`claude/*`, `lane/cloud-*`), or a `mac/*` PR whose body asks the cloud lane to land it; no DECISION_PATH, OWNER_RESERVED or owner-named file; not a draft, not stacked; the gating check passed on the current head; nothing failing or still running; not conflicted; no review thread it cannot show resolved; the body mentions preflight and breadth | lands it, one at a time (section 3), after the checks in section 3 the tool cannot make |
| MAC-ASK-NEEDED | a `mac/*` PR DR-037 lets the cloud lane land only on the Mac's ask, and no ask in its body, or an ask but a blocker the row names | cloud: read `pnpm run lane:inbox` for a mail ask, else one mail; lands none until the Mac names them. Mac: sends the ask |
| OWNER-MERGE | the diff reaches DECISION_PATH or OWNER_RESERVED, or an owner-named surface (AGENTS.md, the decision records, the launch profile, the launch-claims gate, the publication boundary); or it is a Dependabot PR; or its head is in a fork or its branch prefix is not a lane's own | keeps it mergeable, lists it, never merges it |
| SUPERSEDED | its head is an ancestor of mainline, or a `mac/tick-*` PR whose every file was rewritten on mainline after its head commit (or is a sim-request whose result is on mainline); the row's evidence lines say which | proposes CLOSE with the evidence, never closes |
| STALE | idle more than 14 days AND (conflicting OR red: the gating check, the Mac-only check or CodeQL failed). Code scanning, `phase-pr-evidence` and the SBOM check never make a PR red. The row keeps what it would be if revived (`natural`) | asks the owner: revive or close |
| IN-FLIGHT | only when you passed `--declared-live`. The tool cannot see a worker; a PR touched in the last 3 hours and not declared is flagged, not classified | leaves it alone (section 4) |
| STANDING | the mailbox PR named in `docs/agent/lane-mailbox.json`: a draft with no files | never lands it, never closes it |
| UNKNOWN | the rules have no row for what was read, or a fact could not be read; the reason is printed. For a cloud PR it usually means "would be LAND-UNDER-DR-037 once the named blockers clear" | treats it as not landable; fixes the read or waits |

The rules are first-match in the order STANDING, IN-FLIGHT, SUPERSEDED, STALE, then the
class by lane and diff. The tool computed the row; this table says what you may do with
it. UNKNOWN is never LAND: unknown tightens (golden rule 2).

**What the tool cannot know, and what you do about it.**
- *Review-thread resolution.* GitHub shows it through GraphQL only. The tool reads each
  PR's review comments through REST and prints `~a/b` (b threads, a with no reply), so any
  PR with a review thread is held back from LAND. Read the exact count the way
  `landing-under-dr-037` does, then pass it as `--threads-file` (`{"1321":{"total":79,"unresolved":0}}`)
  if you want that PR to place as LAND.
- *Mac mail.* A `mac/*` ask is read from the PR body only. Check the inbox before you
  mail an ask the Mac already sent.
- *Whether preflight and breadth really passed.* The tool only checks the body mentions
  both. Condition 2 is yours to verify (section 3).
- *Whether a branch's work reached mainline another way.* Section 2, step 5.

## 2 — Order of work

Dispatch the bulk by the stage table in `orchestrator-over-workers` (DR-047, DR-060),
naming a tier on every spawn: job-list and log parsing on Haiku; reads that feed a
decision and every PR comment on Sonnet; the judgment on each close or owner proposal
on Opus. The coordinator runs none of the bulk.

1. **Land LAND-UNDER-DR-037 one at a time, newest-green first.** Each landing moves the
   manifest and the coverage page, so rebuild the next PR on the new mainline
   (`landing-under-dr-037`, "Order, when several land in a row") and re-read that PR.
2. **Refresh OWNER-MERGE PRs once, after the last landing**, not after each: every
   landing moves the generated files again. Merge `origin/SignalGrid_Alpha` into the
   branch, regenerate with the repo's tooling on a clean index, run preflight and
   breadth, push normally. Touch only your lane's own branches and `mac/tick-*`
   (lesson L12); mail the owning lane for any other. Skip IN-FLIGHT. Each refresh is a
   full preflight and breadth chain, one per host, so work in the owner's list order
   and report the PRs you did not reach as dirty rather than hiding them.
3. **File the rest.** MAC-ASK-NEEDED becomes one mail. SUPERSEDED and STALE become one
   close list. OWNER-MERGE becomes one owner list (section 5).
4. **Issues.** Machine-owned issues (`raised-hands`, `scheduled-verification`) are
   refreshed by their workflows: do not comment lists on them and do not open
   replacements (section 6). Any other open issue gets one line in the owner list:
   what closes it, and whether a merged PR already did. The queue's issue section groups
   same-title issues; a group is a finding, not a licence to close.
5. **Branches with no open PR.** The tool labels each one: PRUNABLE (a merged PR has this
   head ref and the tip is that PR's head), TIP-MOVED (a merged PR has the ref but commits
   came after it) or UNMERGED (no merged PR has the ref). UNMERGED is not "lost": this repo
   can land a branch another way, so read `ahead_by` with
   `gh api repos/{owner}/{repo}/compare/SignalGrid_Alpha...<branch>` before saying so.
   Contained in mainline: list it for a person to delete. Ahead: find its PR or list the
   branch for the owner. Either way it stays on the remote. The report prints how many
   branches say `protected: true`; a protected branch cannot be deleted by the prune
   scripts, so a prune list is only a proposal until that is settled.

## 3 — Landing one PR

Run `landing-under-dr-037`: its five conditions on the current head, "The merge call"
(full 40-character `expectedHeadSha`), the native-client suites, and the merge-alone
rule. Do not retype them here. A sweep adds five checks.

1. **Re-classify the head, not the queue's snapshot.** A push can add a file, and the
   tool's row is as old as the queue. This uses the tool's own classifier and owner-named
   list, so there is no second copy of either to drift:

   ```bash
   gh api "repos/{owner}/{repo}/pulls/<n>/files" --paginate -q '.[].filename' > "$SCRATCH/files-<n>.txt"
   node --input-type=module -e 'import { classifyFiles } from "./scripts/backlog-triage.mjs"; import { readFileSync } from "node:fs"; const r = classifyFiles(readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((filename) => ({ filename }))); console.log(r.tier, "|", r.ownerNamed.map((o) => o.rule).join("; ") || "no owner-named surface");' "$SCRATCH/files-<n>.txt"
   ```

   `autonomous`, or only SAFETY_MACHINERY with no owner-named surface, is landable under
   the five conditions, with "merged under DR-037" and the check-run id in the PR body. Any
   DECISION_PATH or OWNER_RESERVED category, or any owner-named surface, is the owner's. The
   owner-named list is deliberately wider than DR-037's words: a false hit costs the owner a
   glance, a miss lands a boundary change. A PR that adds a first-party skill edits
   `scripts/publication-boundary.mjs`, so it is the owner's too.
2. **Read the review threads exactly.** The tool could only count them. DR-037 condition 3
   is every thread resolved and every bot finding verified: read that on the head, then
   re-run the tool with `--threads-file` if you want the row to say so.
3. **Establish who opened it.** `user.login` cannot tell: every lane pushes as one
   account, and the rest are Dependabot. The queue's lane column is the branch prefix.
   `claude/*` and `lane/cloud-mail-*` are the cloud lane's; `mac/*` is the Mac's, landed
   only on the Mac's ask; anything else (`codex/*`, `dependabot/*`) is not yours to land,
   so file it.
4. **No quoted preflight and breadth for this head means not landable as it stands.**
   The path is: merge Alpha in, regenerate, run both, push, wait for the check on the
   new head. On the cloud lane that is the saved `land-branch` workflow
   (`.claude/workflows/land-branch.js`), never a hand-run chain that pushes
   (`orchestrator-over-workers`).
5. **After the merge, read it back.** `pulls/<n>` must say `merged: true` with the merge
   sha, and mainline's own gating run on that merge commit must pass. A green merge-ref
   run is not proof (lesson L12). Name the merged sha in your PR comment.

A stacked PR (base is not `SignalGrid_Alpha`) waits for its base to land, then merges
`origin/SignalGrid_Alpha`, never the base's tip (lesson L15). The tool lists it as
"stacked on <base>" among the blockers.

## 4 — Worker PRs and lane-mail PRs

**Live worker PRs** (`claude/build-*`, opened by workers under `orchestrator-over-workers`)
are IN-FLIGHT only when you declare them. Declare every one whose worker is mid-round,
or the tool will place it as an ordinary PR. The reviewer is not the author.

- Review the report against the spec: Sonnet reads every PR, Opus refutes DR-037
  landings and decision-path ones. Quote the verdict.
- Send defects back as a PR comment so the worker pushes a NEW commit. Never push into
  its branch, amend, or rebase it, and never land it while its worker is running.
- When the round ends (new head, CI on it), it is an ordinary row: land it under
  section 3, or list it with the verdicts quoted if it touches `lib/` or `artifacts/api-server/`.
- A worker with no push in 14 days (the tool's STALE window) and no raised hand: raise a
  hand that names it. Do not adopt its branch silently.

**Lane-mail PRs.**

- `lane/cloud-mail-<stamp>` carries the cloud lane's mail, heartbeats and hands. It is
  the cloud lane's own PR: land it under section 3. When a message file was added it
  also moves the coverage page, so it serializes with the rest.
- `mac/tick-<stamp>` carries the Mac tick's results. The cloud steward lands them under
  DR-037 (`docs/LANE_COORDINATION.md`, rule 2) after the lesson L12 check: has mainline
  moved a counted surface since the page was generated? If so, merge Alpha in and
  regenerate first. A tick PR is SUPERSEDED only on the tool's per-file evidence (the
  rewriting commit, or the fulfilled request): `artifacts/sim-results/*.json` are records
  of an execution, and closing one that is not on mainline loses the record.
- `lane/mailbox` is the standing wake channel (`docs/agent/lane-mailbox.json`). The tool
  prints it as STANDING. It is never merged and never closed, and it never appears in a
  close list.
- Only the addressee acks a message. Never ack the other lane's mail.

## 5 — Report

- **One comment per PR per sweep**, through REST. It carries: the disposition; the full
  head sha; the tier and the rule that matched; the gating check-run id for that head,
  or "none"; `mergeable_state`; the open-thread count and which method counted it; the
  next action and who owns it. Each figure is pasted from command output with the command.
  Never write an id from memory (lesson L16: a PR body invented a check-run id). Sonnet
  writes the comments, not Haiku.
- **Look before you create.** List the PR's comments first. If your last sweep comment
  names the same head and disposition, post nothing. A comment write is content
  creation: pace the loop. GitHub's secondary limit does not show in `rate_limit`, and a
  call that reported failure may have succeeded (`scripts/mac/gh-pr.mjs`).
- **SUPERSEDED proof** is a table: path, blob sha at the PR head, blob sha on mainline,
  or the merged PR that replaced it. The tool's evidence lines are where it starts (they
  name the rewriting commit); the blob table is this skill's own bar. No table, no CLOSE
  proposal. **STALE** is a question to the owner. Closing leaves the branch: the prune
  script refuses a branch with unmerged commits unless a person names it, and tags
  `archive/<branch>` first.
- **Two lists, one per audience**, in `owner-comms` form (what happened, what I need
  from you, what happens next; a PR link and the exact action on each line, merge or
  close). Raise one hand each, `who` set to `owner` and to `mac lane`, as `raise` ops in
  the sweep's single `pnpm run lane:deliver batch` (`raised-hands`, step 6). Do not run
  `pnpm run hand:raise` in your checkout: it writes an untracked file. Do not ping the
  owner twice about one hand in a day.
- **The heartbeat counts.** If a registered routine fired the sweep, its heartbeat line
  carries the counts from the queue: landed, mailed, owner list, close list, left. An
  ad hoc sweep puts them in the LOOP STATE line at `loop-end`.
- Mail follows `docs/LANE_COORDINATION.md` rule 3: it asks a person for judgment, never
  for a build. `scripts/lane-deliver.mjs` takes the subject and body as positional words
  and sends to the other lane: `pnpm run lane:deliver send "subject" "body"`.

## 6 — Duplicate "Raised hands" issues: one issue, refreshed

`.github/workflows/raised-hands.yml` keeps ONE open issue labelled `raised-hands`. It
rewrites that issue's body each run and comments only on a new hand. It creates a new
issue only when its open-and-labelled lookup returns nothing, and otherwise refreshes
the first result, which is the newest created.

Seen 2026-10-22: eight open issues with the same title and label (#1068, #1575, #1588,
#1589, #1591, #1594, #1596, #1597). Seven were created within about 26 hours, six of
them on 2026-10-22, each during a run of the workflow that finished `success`, and each
older one stopped being refreshed when the next appeared. Re-running the same lookup
25 times that day returned the open issues every time; the empty answers coincided with
GitHub incidents, which correlates and does not prove the cause. The seven older issues
were then closed as `duplicate` by the shared account, leaving #1597. The backlog row is
in `docs/BUILD_BACKLOG.md` ("Raised-hands issue: a lookup that returns nothing during a
GitHub incident opens a duplicate").

- Re-derive before you act: the queue's issue section groups same-title open issues, and
  `gh api "repos/{owner}/{repo}/issues?state=open&labels=raised-hands"` lists the labelled ones.
- More than one open: list the older ones in the close list as duplicates and name the one the workflow refreshes (the newest).
- Never open a `raised-hands` issue by hand, and never post a sweep list on it.
- Raise a hand for the cause. A fix to the workflow is SAFETY_MACHINERY, so it lands
  through section 3. The page must still be fresh: updated within two hours (`raised-hands`).

## 7 — For the Mac brain

The Mac proposes, builds and opens; the cloud lane is the final review board (DR-050).
No DR gives the Mac a merge button. The queue command is `node` plus `fetch`, so it runs
unchanged on the Mac wherever `GH_TOKEN` or `GITHUB_TOKEN` is set; the `gh api` commands in
this skill need a `gh` on `PATH`.

- **Can:** run the queue (read-only); keep its own `mac/*` PRs mergeable (separate
  worktree, merge Alpha, regenerate, preflight and breadth, normal push); mail the
  cloud lane ONE ask naming the Mac PRs ready to land (DR-037 condition 5; #653 did),
  and put the same ask in the PR body so the queue can read it; dry-run branch cleanup
  with `pnpm run branches:stale` and the "Branch prune" workflow with `apply` unchecked.
- **Deleting prunable branches is a person's action.** `pnpm run branches:clean` and
  Branch prune with `apply` delete remote branches. CLAUDE.md puts branch deletion
  under "Ask before" and `docs/BRANCHES.md` calls it an owner action. The brain prepares
  the dry-run output and the exact command; the owner, or his explicit say-so in the
  session, runs it. `dependabot/*`, open PRs and unmerged work stay (`docs/BRANCH_HYGIENE.md`).
- **Cannot:** land cloud PRs (`claude/*`, `lane/cloud-mail-*`, Dependabot) unless the
  cloud lane mails the ask.
- **Keep the checkout clean.** The five-minute tick refuses a dirty or non-Alpha
  checkout, and sim-result provenance is sampled from `git status --porcelain`,
  untracked files included. Scratch lives outside the repo, PR work in a separate
  worktree. Delete a worktree's build output, not the worktree (lesson L22).
- **Bash 3.2.** A loop you write over the queue runs under it: guard empty arrays as
  `cmd ${ARGS+"${ARGS[@]}"}` (CLAUDE.md).

## Never

- Never approve a PR; never merge a PR you did not open or were not asked to drive
  (DR-037, condition 5).
- Never merge a change to DECISION_PATH (`lib/**`, `artifacts/api-server/`, the
  `DecisionEngine.swift` and `AppWorkflows.swift` ports), to OWNER_RESERVED paths, to
  `docs/DECISION_RECORDS.md`, or to the launch profile, the launch-claims gate or the
  publication boundary. DR-061, which would let lanes merge decision-path PRs under
  conditions, was an open proposal on 2026-10-22: re-check
  `grep -n '^## DR-061' docs/DECISION_RECORDS.md` before you assume it.
- Never merge a Mac PR without an ask; never merge on CI green alone; never merge
  on a head you have not re-read; never land two PRs in parallel that both move the
  manifest.
- Never close a PR or an issue, delete a branch, or remove a worktree. File the
  proposal with its evidence; a person acts.
- Never force-push, rebase someone's branch, amend a worker's commit, or use
  `--no-verify`, `git stash`, `git reset --hard`, `rm -rf` or `git branch -D`. A hook or
  classifier refusal is reported, not routed around.
- Never hand-edit `artifacts/sync/live-sync-manifest.json`,
  `docs/agent/SURFACE_REVIEW_COVERAGE.md`, or the block between the snapshot markers in
  `docs/agent/BACKLOG_LANDING.md`.
- Never act for the owner or clear a hand you did not resolve.
- Never report a figure that is not in output you can quote, and never present the tool's
  heuristic thread count or a body-only ask as more than it is.

## When you're stuck, raise your hand

Be fail-closed about your own progress, not only the code you inspect. If you hit a wall
you cannot clear alone — a tool or permission you lack, a dependency you cannot reach, an
input that is missing or self-contradictory, an ambiguous call that is the owner's to
make, a usage limit, or a refusal — STOP and say so plainly. Report it the way you report
a finding: what you were doing, what blocked you, exactly what you need to continue, and
who can unblock it (the owner, the other lane, a named tool). Never hand back an empty,
partial, or best-guess result as if it were complete; never silently drop a step; never
narrate past the blocker. A raised hand is the job done right — a silent stall is the one failure this system
will not tolerate.

## Where each rule comes from

| Rule | Source |
| --- | --- |
| Five landing conditions, merge call, merge alone, regenerate order | `landing-under-dr-037`; DR-037 |
| Tiers and categories; SAFETY_MACHINERY landable under the five conditions | `scripts/check-owner-gated-surfaces.mjs`; DR-037, "What stays owner-gated" |
| `AGENTS.md`, decision records, launch profile, launch-claims gate, publication boundary stay the owner's | DR-037, "What stays owner-gated"; the owner-named list in `scripts/backlog-triage.mjs` |
| The dispositions, their order, the 14-day window and what counts as red | `scripts/backlog-triage.mjs` (its header and `--self-test`); `docs/agent/BACKLOG_LANDING.md` |
| Sonnet reads every PR; Opus refutes DR-037 landings and decision-path ones | `docs/agent/LOOP.md`, the forward-build routine record |
| Dependabot merges stay the owner's | `docs/agent/scheduled-routines.json`, `dependabot-queue-review` (retired 2026-10-15; its `writeScope` records the rule and no routine merges them) |
| Mac PRs only on an ask; never approve; never delete branches | DR-037, condition 5 and "What stays owner-gated" |
| Mac proposes, cloud reviews | DR-050 |
| Branch deletion is a person's act; the prune rules | CLAUDE.md "Ask before"; `docs/BRANCHES.md`; `docs/BRANCH_HYGIENE.md`; `scripts/prune-merged-branches.mjs` |
| New commit not amend; worker never lands itself; `land-branch` | `orchestrator-over-workers` |
| Hands, bundling, never ack the other lane's mail | `raised-hands`; DR-054 |
| Mailbox PR never merged or closed; tick PRs; mail asks for judgment | `docs/LANE_COORDINATION.md` |
| Stacked PRs, stale coverage page, fabricated ids, worktrees | `docs/agent/LESSONS.md` L15, L12, L16, L22 |
| Look before you create; secondary limits | `scripts/mac/gh-pr.mjs` |

Instructions with no record behind them yet (the coordinator's, 2026-10-22; they bind
until a decision record or this table says otherwise): land newest-green first; one
PR comment per sweep; the Mac lands no cloud PR unless mailed; the brain files close
proposals and never closes, which the table backs only for branches and for the
owner's merge-or-close call on an idle PR (`docs/agent/hand-routing.json`, `pr-idle`);
the heartbeat carries the counts. The exclusion check in section 3, the refresh-once
note in section 2 and the hand-per-audience filing in section 5 are this skill's own
derivations from DR-037, the landing skill and `raised-hands`.
