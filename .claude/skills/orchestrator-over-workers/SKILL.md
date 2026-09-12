---
name: orchestrator-over-workers
description: Use when a build task splits into independent pieces and the cloud lane is about to run them — before dispatching sub-agents, when reviewing what they send back, and when landing more than one worker branch.
---

# Orchestrator over workers

The cloud lane's build pattern since 2026-09-12
(`docs/LANE_COORDINATION.md`, "How the cloud lane runs build work"): the session
model writes the spec and reviews; execution fans out to Opus sub-agents, each in
its own worktree; the loop closes on a check that fails without the fix, never on
a description of one. The mechanics of dispatch are already written down in the
vendored `dispatching-parallel-agents` and `subagent-driven-development` skills —
this is what the orchestrator owns on top of them.

## 1 — Write the spec before anyone starts

One spec per worker, and each one states, in this order:

- **what changes** — the files, named;
- **which check must FAIL without it** — a proof assertion, a gate, a mutation
  survivor count. If no check can fail, the work is not specified yet;
- **which gates must stay green**, by command;
- **which files the worker may touch**, and that everything else is out of scope.

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
cheapest model that can do it, and the choice is stated in the brief:

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
