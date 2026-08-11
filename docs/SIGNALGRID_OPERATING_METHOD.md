# SignalGrid Operating Method

**The handbook for how SignalGrid is run** — company process, product design,
AI-assisted engineering, launch discipline, and documentation. Adapted from the
Fleet Device Management handbook's operating patterns (intake ledger row 76) to
SignalGrid's reality: a solo founder, an AI-assisted build lane, a proof-gated
monorepo, and a launch wedge that must not be buried by breadth.

Rule zero, taken from Fleet's strongest pattern: **opinions are not decisions.**
A decision may be questioned later, but it is followed until changed, and a
challenge routes to the owner who can actually change it — not into a new
document, branch, or catalog. This page is where decisions live. If practice
and this page disagree, one of them changes *in the same pull request*.

## 1. Handbook-first product truth

The order of operations for anything that changes what SignalGrid *is*:

**Docs first. Code second. Proof third. Launch claim last.**

- No feature is launch-scope until `scripts/launch-profile.mjs` says so.
- No product claim is public until [WHAT_SIGNALGRID_DOES_TODAY.md](WHAT_SIGNALGRID_DOES_TODAY.md)
  supports it.
- No automation result is trusted until a proof's own output supports it.
- No customer claim exists until external evidence exists.

## 2. Opinion vs decision

An idea entering the system (screenshot, URL, PDF, article, review finding)
is an **opinion** until it lands in exactly one of these buckets:

| Bucket | Meaning | Where it is recorded |
| --- | --- | --- |
| launch-critical | Closes a launch blocker or strengthens the wedge | task + plan of record |
| deferred roadmap | Valuable, parked under the freeze until first pilot | [INTAKE_LEDGER.md](INTAKE_LEDGER.md) |
| research reference | Positioning/strategy material | `docs/research/` |
| refused | Assessed and declined, with the reason named | INTAKE_LEDGER.md |
| owner decision required | Only the owner can decide | surfaced to the owner, once, with a recommendation |

Nothing gets a branch, a catalog, or a doctrine document by default. The
widened freeze (plan of record §2/§11) is the standing decision; challenges to
it route to the owner.

## 3. Directly responsible owner

Every phase of work, every YELLOW/RED change (§6), and every launch surface has
exactly one owner. For SignalGrid today that is the founder for product and
publication decisions, and the AI lane for execution within ratified scope.
Refusal reason codes already carry owners mechanically — a code without an
owner from the closed role set fails the build (`check-it-layer-model.mjs`).
The same principle applies upward: work without an owner is an opinion.

## 4. Wireframe-first design

**No code before wireframe** for: new operator UI, new workflow page, new API
route family, new connector setup flow, and any new customer-facing status
state. Wireframes cover more than screens — layout, flow, messaging, error
states, URLs, parameters, and response shapes, agreed before engineering
commits. The current wireframe-first queue (in order):

1. Operator dashboard · 2. Microsoft connector setup · 3. Decision detail ·
4. Evidence/audit · 5. Policy version · 6. Limited-GA assurance status.

Feature breadth waits until those six screens are coherent.

## 5. One repo, and the private-core exception

Most work happens in one canonical repo, because split work loses context,
duplicates automation, and hides progress. The repo roles are fixed, not
aspirational:

| Role | Repo | Status |
| --- | --- | --- |
| Active public product + review repo | SignalGrid-Review-Hub | this repo; the launch spine |
| Private protected repo | the private SignalGrid core | secrets, protected implementation, customer matters only |
| Research/reference | `docs/research/` + inspiration sets | inside this repo, labelled |
| Legacy | DEV and stale branches | archive or prune (estate report §6, owner-gated) |

Anything not in one of those categories gets cleaned up, not accumulated.

## 6. AI-generated work accountability

AI can generate, test, open PRs, summarize, and propose fixes. **A human-owned
gate approves what matters.** The ladder:

- **GREEN** — mechanical/refactor/doc work fully covered by existing proofs and
  gates: may land on the working branch after the full local suite passes.
- **YELLOW** — product scope, launch claims, customer-facing surfaces, publish
  actions: owner review required before it takes effect outside the repo.
- **RED** — security-sensitive code, credentials/publication boundary, anything
  regulated: owner plus assessor/security review
  ([SECURITY_REVIEW_RUNBOOK.md](SECURITY_REVIEW_RUNBOOK.md)).

AI review is not a substitute for human review; the value of human review is
the guarantee that someone understood the work. The reviewer of AI-generated
work owns it as if they wrote it.

## 7. AI tooling policy

One primary AI/code environment for repo changes; one visible PR flow; one
launch checklist (the plan of record); one human approval point for
YELLOW/RED. AI tooling is centralized, budgeted, and visible — no hidden
personal-tool sprawl, and no AI bottleneck: if the tooling blocks the work,
that is an operating incident, not a personal problem.

## 8. Issue intake and work visibility

Intake is optimized for the person submitting, not the process. The whole
required form:

> **Source · What it is · Why it might matter · Launch impact · Disposition ·
> Owner · Next action**

Every intake gets a ledger row with a disposition (§2). A screenshot is enough
to open a row; the receiver fills in the rest. No intake is forced to become a
large document.

## 9. Launch-scope discipline

The launch wedge is the Shared-Device Trust Gateway
([LAUNCH_PROFILE.md](LAUNCH_PROFILE.md)): three connector families, one
console, one host-app reference, seven `/v1` routes. The launch profile gate
fails the build when reality and the declared edge diverge — in either
direction. New scope enters through §2, never through momentum.

## 10. Incident and break-loudly doctrine

Breaking states are made loud, never absorbed — the operational form of the
unearned-affirmative law. Unknown, stale, unverified, contradictory, deferred,
and fixture-backed are all **visible states**, not absences. Every launch
status surface shows: signal source, freshness, evidence mode, assurance
posture, fixture/live mode, step-up answerability, route owner, and
verification state. A failing gate is reported as failing; an outage-shaped
signal opens work before its full impact is known.

## 11. Customer outreach principles

Helper-first: no spam, fewer words, no puffery, fair to alternatives, and help
people pick the right solution even when it is not SignalGrid. The positioning
sentence is additive, never a replacement claim:

> You already have IAM, UEM, EDR, SIEM, ITSM. SignalGrid helps determine what
> their combined evidence means for the workflow happening right now.

Language follows platform honesty: say *management data available*,
*management enforcement available*, *local authority available*, *step-up
answerable*, *offline lease valid* — not "device enrolled", "device healthy",
or "device trusted". Multi-platform over cross-platform: platforms differ, and
pretending otherwise is a claim the product would have to walk back.

## 12. Roles: simple UI roles, granular API permissions

The shipped role set is deliberately small and matches real job functions:
**owner, operator, auditor** (UI) and **connector** (service) — enforced in
`lib/signalgrid-core/src/auth.ts` with per-permission checks underneath. No
custom per-action RBAC UI before launch; strict automation needs are met with
granular API permissions, not configuration surface. The operator deliberately
lacks `audit:read` (separation of duties) — the console demonstrates that
rather than papering over it.

---

*Enforced by `proof:operating-method`: the sections above exist, the buckets
and ladder are defined, every intake row carries a disposition, and every
relative link resolves. The method is a gate, not a memory.*
