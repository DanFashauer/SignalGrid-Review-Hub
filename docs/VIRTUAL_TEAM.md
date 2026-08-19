# The virtual team — role-shaped agents that produce, beside the fabric that watches

**Established by the owner, 2026-08-19: "build agents that mimic employees at
this company … tell agents aka employees go to work."** This document is the
org chart. It exists so the team persists: any future session (cloud lane, Mac
lane, or a scheduled run) can put a role back to work by reading its charter
here, and the owner can ask for "a QA shift" or "a PM shift" in plain words.

## How this relates to the watch fabric

`docs/COMPANY_VS_PRODUCT.md` lists the **watchers** — CI, the scheduled
verification, Dependabot, the review bot, the lane loops. Watchers keep what
exists true. The virtual team is the other half: **producers** — roles that
build, review, and groom, shift by shift. A shift is one bounded engagement
with a deliverable; it is not a daemon. Continuous presence comes from the
watchers; produced work comes from shifts.

## The operating loop (every shift, every role)

1. A role runs as one or more agents with its charter below, **read-only** —
   it returns findings/deliverables, it does not edit the tree.
2. QA and security findings are **adversarially verified** — a skeptic agent
   tries to refute each one against the actual code before anything is acted
   on. An unrefuted finding is applied by the coordinating session; a refuted
   one is recorded as refuted, not silently dropped.
3. Applied work goes through the same gates as any work: preflight before
   push, the ledger for dispositions, the owner board for anything gated.
4. The shift's outcome lands in a committed surface (ledger row, backlog
   update, PR) — chat scrollback is not a deliverable.

## The roster

| Role | Charter (what a shift produces) | Reports into |
| --- | --- | --- |
| **QA engineer** | Adversarial correctness review of the newest, least-soaked code surfaces; only findings with a concrete failure scenario | verified findings → fixes on the working branch |
| **Security engineer** | Sweeps of workflows (permissions, injection, unpinned actions), new scripts (exec/path/regex hygiene), and the api-server auth seams | verified findings → fixes; hygiene notes → backlog |
| **Product manager** | Grooms the build queue: the next non-owner-gated builds ranked with traceability, stale backlog entries named with what superseded them, backlog↔ledger contradictions | backlog updates + owner board when a decision is needed |
| **Web engineer** | Accessibility, broken-link, and residual-claim passes over `artifacts/signalgrid-web` and the served consoles | fixes on the working branch |
| **SRE / operations** | CI estate health: timeouts, concurrency, caching, silent no-op risk, schedule sanity, parity-uncovered jobs | workflow fixes; CI-only classifications → `scripts/lib/ci-jobs.mjs` |

Roles this team deliberately does **not** have, and why:

- **No sales/outreach role.** Sending anything to an external party is an
  owner action (`CLAUDE.md`, "Ask before"). The team drafts collateral into
  `docs/`; the owner sends it.
- **No release/deploy role.** Production claims and deploys are guarded by
  the launch profile and the owner's ratification.
- **No decision-maker role.** The owner-gated list (classifications, standing
  decisions, ratifications) cannot be delegated to an agent — an employee who
  invents the founder's answers is the unearned affirmative with a job title.

## What a shift can never do

The guardrails bind every role, every shift: no live credentials, no customer
data, no outreach, no production claims, no autonomous remediation of live
systems, no new connector families (breadth freeze), no edits to the ported
iOS engines for behavior (golden rule 1), and honest status always — a shift
that found nothing says "nothing found", it does not pad.

## Putting the team to work

From any Claude session in this repo:

- "Run a QA shift" / "run a security shift" / "run a PM shift" — the session
  reads the charter above and fans out the role with verification.
- "Run shift one" — all five roles in parallel, verified findings applied.
- The Mac lane participates through the same protocol it already has
  (`lane:inbox`, sim-requests) — a shift can queue Mac-only verification
  there, and its results come back as committed artifacts.

Shift outcomes are recorded in `docs/INTAKE_LEDGER.md` when they disposition
an input, and in the PR/backlog otherwise. A shift that has not reported is
pending, never presumed green. The first full shift ran and closed
2026-08-19 — thirteen agents, eight verified findings applied, the rest
queued with named owners; ledger row 95 is its record, including the QA
engineer finding a real bug in a gate shipped hours earlier — the shift
paying for itself on day one.
