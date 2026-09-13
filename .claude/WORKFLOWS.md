# Workflows — the agent collection as repeatable passes

> Kept at `.claude/WORKFLOWS.md`, deliberately NOT inside `.claude/commands/`
> (every `.md` there becomes an invokable command — see the same note in
> `COMMANDS.md`).

The agents in `.claude/agents/` are a collection, not a prompt box. The value is
in running the RIGHT ones together, the same way every time, wired to this repo's
own gates — a workflow, not a one-off ask (DR-048, adopting the ECC agent-collection
idea that is already installed on demand via `pnpm run ecc:install`). This file names
the standard passes so the collection is used consistently instead of ad hoc.

## The three standard passes

| Pass | Command | Chains | Green when |
| --- | --- | --- | --- |
| Review a change / PR | `/review-pass` | DR-024 stack: ponytail-review FIRST, then fail-closed-auditor + security-reviewer + code-reviewer (+ verdict-core-reader / gate-and-proof-engineer by surface); the signalgrid-reviewer discipline applied as a SKILL, not a spawned agent; findings verified | `preflight` + `verify:breadth` green, `test:api` N/N if the API moved; findings ranked |
| Refactor (`lib/` only) | `/refactor-pass` | refactor-cleaner + ponytail (ultra), dead-code via typecheck + `check-package-reachability.mjs` + `git grep` (never `npx knip/depcheck/ts-prune`) | `typecheck` + `review:invariants` + `preflight` + `verify:breadth` green, one runnable check left behind |
| Fix the build | `/build-fix` | routed by failing surface: build-error-resolver (`artifacts/`), gate-and-proof-engineer (`scripts/`); decision paths + Swift twins escalate | the failing check, re-run, now passes (quoted) |

Each command file carries its own **failure mode** — read it before running.

## When to run which

- **Before any push or PR** that touches gates, docs figures, or the launch
  surface: `/review-pass`. It is the local mirror of what CI and the Codex
  reviewer will do, so it catches the finding before the round-trip.
- **On a red `typecheck` / `preflight` / `test:api`:** `/build-fix`.
- **When a file has grown dead code, duplication, or speculative abstraction:**
  `/refactor-pass`.

## Model tiering (DR-047)

Every spawn in a pass sets its own `model:`; none inherits the coordinator's.
Adversarial verification and mechanical edits run on Sonnet (three cheap distinct
lenses beat one expensive one); bulk log/output scanning on Haiku; the SignalGrid
judgment agents (fail-closed-auditor, gate-and-proof-engineer, verdict-core-reader)
run on Opus by their own frontmatter. Fable / Mythos never power a review pass.

## What this deliberately does NOT add (YAGNI until asked)

ECC ships more — per-language review passes, an adversarial dual-model convergence
loop (`/santa-loop`), and end-to-end orchestrated feature / defect workflows
(`/orch-*`: research → plan → TDD → review → gated commit). They are installed on
demand (`pnpm run ecc:install`) and are not wired into this repo's own command set
until a real need names one. Adding one is an `agent-platform-steward` change with a
decision record, the same as this file.

## Relationship to what already exists

- The generic built-ins `/code-review`, `/simplify`, `/security-review` still work;
  the passes above are the SignalGrid-specific version that also runs the repo's own
  agents and REQUIRES its gates green. Use the passes for repo work.
- The steward and merge cycles are already workflows (Routines in
  `docs/agent/scheduled-routines.json`); the per-session loop rituals are
  `/loop-start` and `/loop-end`.
- Ownership: this surface is `agent-platform-steward`'s. Changing a pass, or adding
  one, goes through it and gets a decision record.
