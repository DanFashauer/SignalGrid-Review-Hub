---
name: orchestrator-over-workers
description: Use when a build task splits into independent pieces and the cloud lane is about to run them — before dispatching sub-agents, when reviewing what they send back, and when landing more than one worker branch.
---

# Orchestrator over workers

The cloud lane's build pattern since 2026-09-12
(`docs/LANE_COORDINATION.md`, "How the cloud lane runs build work"): the
orchestrator owns the spec and the review, run on Opus (by the session itself only
when its model is Opus); execution fans out to tiered sub-agents per the stage table
below, each in its own worktree; the loop closes on a check that fails without the fix, never on
a description of one. The mechanics of dispatch are already written down in the
vendored `dispatching-parallel-agents` and `subagent-driven-development` skills —
this is what the orchestrator owns on top of them.

## 1 — Write the spec before anyone starts

One spec per worker, and each one states, in this order:

- **what changes** — the files, named;
- **which check must FAIL without it** — a proof assertion, a gate, a mutation
  survivor count. If no check can fail, the work is not specified yet;
- **which gates must stay green**, by command;
- **which files the worker may touch**, and that everything else is out of scope;
- **where the result lands** — one file path per worker, under the run's scratch
  directory or worktree. The worker returns that path and a one-line status; the
  orchestrator reads the file. A chat return is the handoff that gets lost between
  sessions (the ICM clip, 2026-09-19: "the artifact becomes the next stage's input,
  not buried chat history"); `subagent-driven-development`'s brief → report files
  already work this way.

The orchestrator holds the census — the full list of pieces and who has which —
because no worker can see its siblings.

## 2 — One worktree per worker, its own install

```bash
git fetch origin
git worktree add -b lane/<topic>-<stamp> <scratchpad>/w-<topic> origin/SignalGrid_Alpha
pnpm install --frozen-lockfile
```

No worker touches the main checkout or another worker's worktree. Dispatch them in
parallel; each reports back against its own spec.

## 3 — Review every report against the spec, not against its confidence

- Every **deletion** must be provably shadowed: the worker shows the check that
  still passes with the line gone AND the reason it can never be reached, not one
  of the two.
- Every **survivor** kept must have a check that fails without it. A guard with no
  falsifier is indistinguishable from a deleted one.
- Every **number** comes from quoted output. A number in a report that is not in an
  output block is a memory, and memories are what this repo's gates exist against.
- **Consistency across workers is part of review.** Sibling workers facing the
  identical shadowed shape must resolve it the same way: one worker allowlisting a
  guard as inert while its siblings delete the same shape is a defect in the
  orchestrator's review, not a worker's preference.

## 4 — Send defects back as a NEW commit

Reply with the exact defects and let the worker push another commit. Never amend a
worker's commit and never rewrite its history: the review trail is the evidence
that the loop closed, and an amended commit erases what was wrong.

## 5 — Land one branch at a time

Each branch moves the sync manifest and the coverage page, so they serialize.
Merge `SignalGrid_Alpha` in, regenerate on top of the previous landing, re-run the
gates, then land the next. The landing conditions are DR-037's
(`landing-under-dr-037`).

## Two pitfalls seen on the first fan-out, 2026-09-12

- **A silencing flag quoted between `run` and the script name.** The
  cited-commands gate reads the token straight after `run` as the script name, so
  the flag is cited as a script no package.json defines and the gate fails on the
  worker's own report. This exact bullet tripped it while being written, which is
  the proof it is real. Workers cite `pnpm run <script>` with nothing between; put
  flags after the script name or leave them out.
- **A worker allowlisting what its siblings deleted.** Four workers, one shape,
  two answers. The orchestrator holds the census, so the orchestrator is the only
  party that can see it — check the four reports against each other before any of
  them lands.

## Never

- Never let a worker land its own branch, or merge another worker's.
- Never accept "the check passes" as the close condition; the close condition is
  the check FAILING without the change and passing with it.
- Never dispatch a worker without the spec — an under-specified worker returns
  plausible work that no check can falsify, which is the most expensive outcome
  available.
- Never run two worktrees' gates against the same install.
- Never let the orchestrator also be the author of the code it reviews; the fixer
  is never the reviewer.

## Which model runs a stage, and what happens when one runs out (owner directive, 2026-09-12; DR-047)

The owner's words: "You need to be passing off tasks to other models and or use best
ultracode model that uses the least amount but best results." So a stage runs on the
cheapest model that can do it, and the choice is stated in the brief. The per-stage
table is the "Stage table" subsection below (DR-060); these are its tiers:

- **Reading, mapping, checking, mechanical edits, adversarial verification** run on the
  smaller tier (Sonnet). These stages are bounded by what is in the tree, not by
  judgment, and three cheap verifiers with distinct lenses beat one expensive one.
- **Bulk, high-volume, fully-recheckable mechanical work** — log/output scanning, reads for
  mapping, doc and codemap regeneration, simple reformatting — drops one tier further to
  **Haiku**, the floor of the ladder (this is why `doc-updater` is `model: haiku`).
- **Authorship and judgment** (a decision record, a doctrine paragraph, a design
  choice, gate-and-proof design, fail-closed auditing, decision-core reading, the
  reconciliation of two lanes' edits) run on the main model (Opus).
- **Fable / Mythos are the creative tier and never run an engineering or review stage.**
- **The orchestrator never does a worker's reading itself.** It writes the brief,
  names the model, reads the report, and keeps the conclusion.

The first run in this shape was the session-puck absorption on 2026-09-12: three
Sonnet readers, one main-model author, three Sonnet verifiers, one fix round.

### The tier is named in every spawn, and is never inherited (DR-047)

A second owner directive, 2026-09-12: "no matter the model I'm currently running the
fallback is ultracode and use Opus or whichever other model makes most sense for smarter
token usage." A session on Fable 5.1 spawned subagents with no `model:`; each inherited
Fable, and when the coordinator hit its Fable limit every inherited subagent started
failing with 429 — a one-tier limit became a lane-wide stall. So:

- **Every spawn states its model.** Registered `.claude/agents/*.md` roles do this by
  frontmatter; an ad-hoc or background spawn sets the `model:` argument on the spawn itself
  (the tool field beside the prompt), not in the brief prose — a brief-only tier does not
  select the runtime model. A spawn with no named
  tier is under-specified and does not run — the same bar as a worker with no falsifying check.
- **Never inherit the coordinator's model.** Routing the bulk of work to Haiku/Sonnet keeps
  those workers off the coordinator's Opus quota, so exhausting one tier does not cascade into
  the others. The honest exception: an Opus judgment worker shares an Opus coordinator's quota
  — naming the tier makes no separate bucket — so keep Opus-worker spawns few, and when the
  Opus tier is exhausted let judgment work WAIT for the reset rather than downgrade it.

### When a model hits its usage limit — fall back and continue, never go dark (DR-047)

- **An unavailable or unknown tier resolves UP to Opus, never down to the limited model.**
  Unknown tightens, never loosens (golden rule 2).
- **A subagent killed by a 429 is logged as a still-open, pending unit and re-issued on the
  fallback tier** — never silently absorbed. This is the `check-sim-requests.mjs` "pending
  never counts green" discipline applied to an in-session spawn.
- **What the orchestrator cannot do itself:** re-point its *own* coordinating model mid-turn.
  Only the CLI's primary-model auto-fallback setting can, and the owner sets that to Opus so
  the session continues at full capability instead of waiting for a human to notice silence.
  Name that limit honestly in any run report rather than claiming the coordinator self-healed.

### Stage table — the coordinator runs none of the bulk (owner directive, 2026-09-26; DR-060)

The owner's words: "when I’m asking you to be the 🧠 you have the ability to expand to
other 🧠 to do other tasks the can be done at lower token cost and model". Spec, review
and gate design run on Opus. A coordinator on Opus may run them itself; a coordinator on
the creative tier (Fable / Mythos) dispatches them to an Opus spawn too, keeps the
conclusion, and runs no stage at all. Every other stage is dispatched:

| Stage | Tier |
| --- | --- |
| Spec, review of a worker's report, judgment calls, decision records, doctrine, gate design | Opus |
| Reads that feed a decision, measurement, adversarial verification, patch scripts and other mechanical edits, building in a worktree; PR bodies (Sonnet since L16 — Haiku fabricated a check-run id and file attributions twice on 2026-09-26) | Sonnet |
| Commit messages, log and CI job-list parsing, doc regeneration, gate runs | Haiku |

- **The coordinator's own tier never runs a bulk stage.** Parsing a CI job listing,
  writing a commit message or re-running a gate by hand in the coordinating session is a
  defect, and it gets a row in `docs/agent/LESSONS.md` (L5 is the first).
- **No gate can see which tier ran a stage inside a session.** The record is the
  `TIERS THIS SESSION` line in the LOOP STATE block; write it honestly, including the
  stages the coordinator did itself.

## Sequential chains and waiters (DR-060; lessons L1, L3, L4, L9, L11, L13, L14, L15)

- **One sequential chain per host for port-bound gates.** Preflight, verify:breadth and
  test:api boot servers on fixed ports; two chains on one host collide. Queue them in one
  chain.
- **A read-only brief forbids booting a server.** A measurement worker that starts the
  api-server leaves it holding a test port when the worker ends (L1). The first preflight
  step now reaps api-servers under its own tree, but a brief that says "read" means no
  listening process.
- **Wait on a sentinel file, never on a process pattern.** Each step of a chain writes
  `<NAME>_EXIT=<code>` to its log; a waiter checks that line exists in the log. A waiter
  that matches processes by pattern can match its own command line or the other
  waiter's, and two such waiters wait on each other forever (L3).
- **Chain state lives in files under the scratchpad, never only in a process.** The run
  head, each exit sentinel and the worker notes are files; a container restart kills the
  processes and keeps the files, and the chain is rebuilt from them (L4).
- **A self-scheduled check-in is the recovery signal after a restart.** Before a long
  chain, schedule a message back into the session; when it fires, read the sentinels and
  resume what has no exit line.
- **Gates run after `git add`, never before.** A gate that scans the tracked tree cannot
  see a file still sitting as `?? path`; run it before staging and it measures the tree
  without the new file and passes for the wrong reason (L9). Stage or commit first, then
  run the gates, and have the worker's report quote `git status --short` right before the
  gate run so the reviewer can see the tree the gates actually saw.
- **A worker never runs a depth-limited or shallow fetch in the shared repository or any
  of its worktrees.** `git fetch --depth=1 origin <ref>` inside a worktree of this repo
  wrote `.git/shallow` with the current mainline head as a boundary commit, and every
  history-based check (loop:state, `git branch -vv`, ahead/behind) then read a clean tree
  as diverged (L10). A fresh, disposable clone of some OTHER repository may still use
  `git clone --depth`; the rule is about re-fetching a checkout everyone shares, not
  about shallow clones in general. If a chain step's history seam looks broken after a
  subagent ran, check `git rev-parse --is-shallow-repository` first (it prints `true` or
  `false` from any worktree; `ls .git/shallow` fails open there, since a worktree's `.git`
  is a file) — `git fetch --unshallow origin` is the fix.
- **A generated file is regenerated only with `git ls-files -u` empty.** Running
  `--write` on `scripts/check-surface-review-coverage.mjs` while
  `docs/agent/SURFACE_REVIEW_COVERAGE.md` sat mid-merge-conflict made the generator walk
  an index holding three stages of the page and render wrong counts (L11). The generator
  now refuses (exit 1, naming the unmerged paths) when `git ls-files -u` prints anything;
  the same check applies to any other worker step that regenerates a file from the tree.
- **A stacked branch waits for its base PR to land, then merges `origin/SignalGrid_Alpha`
  — never the base branch's own tip (L15).** Landings are merge commits, so merging the
  base tip early leaves the stacked branch with two merge bases against mainline: git's
  recursive merge is clean, GitHub's single-base mergeability check reports `dirty`, and
  the merge button refuses a PR in which nothing conflicts (#1127). An adjacent-line edit
  shared with the base is resolved on the Alpha merge after the base lands, not before.
- **Land a worker branch through the saved `land-branch` workflow, never a hand-run
  chain that pushes.** Workflow tool, `name: "land-branch"`, `args: { repo, scratch,
  worktree, branch, tag, klass, title, trailers, sessionUrl, preBrief?, bodyNotes? }` —
  `repo`, `scratch`, `worktree`, `branch`, `tag`, `klass`, `title`, `trailers` and
  `sessionUrl` are ALL required (the script throws on a missing one, and validates
  `tag`/`repo`/`scratch`/`worktree`/`branch` for shape before using them); `klass` is
  only the caller's GUESS at the owner-decision class — the Merge stage runs
  `scripts/check-owner-gated-surfaces.mjs --classify-branch` over the actual diff and
  `resolveKlass()` lets that DERIVED class win, never the caller's; `trailers`
  and `sessionUrl` are the caller's own attribution — the workflow has no session
  baked in, so a call that omits them is not a shorter invocation, it is one that
  throws before Pre even starts. It merges Alpha, regenerates on a clean index, runs
  preflight+breadth behind a file lock (L13), starts the chain as one detached job so
  a worker's own turn ending cannot kill it (L14), pushes only on a 0/0 sentinel
  verified DETERMINISTICALLY by `scripts/lib/land-branch-gate.mjs --verify` on the
  unchanged expected head (L2), and — once its base has landed — merges
  `origin/SignalGrid_Alpha`, never the base branch's own tip (L15).
