# SignalGrid — agent operating model

You are one person running a repo that ordinarily needs a team. The agents are
the team. This defines who owns what, who is allowed to touch what, and how work
moves between them.

**The problem this solves is not capability. It is collision and drift.** Two
lanes already independently built nac discipline and webhooks gating; the
reconciliation cost eight files and an owner decision. Agents are good at doing
work and bad at knowing what someone else is doing. So a role here is defined
primarily by its **boundary**, not its skills.

---

## The four roles

| Role | Mode | Owns | Never touches |
| --- | --- | --- | --- |
| **Core** | Builds | Decision fabric, API, proofs, connectors, web console | `native/`, `firmware/`, docs prose |
| **Native** | Builds | iOS, Android, desktop, firmware, Mac harness | `lib/`, `artifacts/api-server` |
| **Reviewer** | Verifies only | Nothing — read-only | All source. Writes only evidence files |
| **Scribe** | Maintains truth | `docs/`, README, claims registries | All source |

Every role inherits the base `signalgrid` skill. These add ownership and a
narrower job.

### Why only four
Because breadth is the standing risk. Every extra role is another lane that can
collide, another set of half-finished work, and another thing to supervise. If a
task doesn't fit a role, it probably shouldn't be done this month.

### Why product and go-to-market are NOT agent roles
Design judgement, positioning, pricing, and outreach need a person who carries
consequences and holds relationships. Run those with me in chat, where you can
argue back. An agent that writes outreach unsupervised will produce plausible,
confident, slightly wrong claims — the exact failure mode this whole system
exists to prevent.

---

## Ownership map

Derived from the last 60 commits, so it matches what actually happens.

```
CORE                              NATIVE
  lib/**                            native/ios/**
  artifacts/api-server/**           native/android/**
  artifacts/signalgrid-app/**       native/desktop/**
  scripts/src/*-proof.ts            firmware/**
  scripts/check-*.mjs               validate-sim-macos.sh

SCRIBE                            REVIEWER
  docs/**                           (read-only everywhere)
  README.md                         docs/agent/EVIDENCE.md
  docs/agent/FALSE_CLAIMS.json      — its only write path
  docs/INDEX.md
```

### Shared surfaces — serialize, always announce

Touching one of these means checking recent commits **first** and naming it in
the commit message, not only in chat:

```
scripts/preflight.mjs
.github/workflows/review-hub-ci.yml
scripts/mutation-guard.mjs                (TARGETS / ALLOWED)
scripts/check-connector-discipline.mjs    (KNOWN_GAPS)
artifacts/sync/live-sync-manifest.json    (regenerate, never hand-edit)
lib/integrations/package.json             (subpath exports)
package.json / pnpm-lock.yaml
```

**Rule:** one agent holds a shared surface at a time. If you find uncommitted or
recent changes there from another lane, stop and hand back to the owner.

---

## How work moves

```
YOU              write the task. One task, one role, one branch.
  ↓
BUILDER          Core or Native. Plans first, shows the file list, waits.
  ↓              Builds only inside its owned paths.
REVIEWER         Adversarial pass. Never fixes. Produces findings only.
  ↓
BUILDER          Fixes what the reviewer found. Re-runs the ladder.
  ↓
SCRIBE           Updates docs to match what actually shipped.
  ↓
YOU              Merge. Agents never merge their own work.
```

**The reviewer step is the point of the whole system.** You have said you are not
hands-on with code, so there is no human who can tell when a builder is
confidently wrong. The reviewer is the substitute. It only works if the reviewer
never authors — an agent that fixes its own findings has stopped being
independent and has become a second author.

---

## Escalation — stop and ask the owner

Any agent, any role, stops immediately for:

- A change that would touch a **shared surface** already in flight
- A **golden rule** conflict (byte-faithful ports, fail-closed, platform honesty)
- Anything that would weaken, skip, or delete a proof
- Anything requiring a **secret, tenant, live vendor call, or real customer data**
- A **claim about compliance, partnership, production-readiness, or certification**
- Work that would add a new vertical, connector, or platform — the scope freeze
- Destructive git, or a push you were not explicitly asked to make

The correct behaviour when uncertain is to stop, not to guess well.

---

## Task template

Give every agent this shape. Vagueness is where drift starts.

```
ROLE:        core | native | reviewer | scribe
BRANCH:      task/<short-name>
GOAL:        one sentence, outcome not activity
FILES:       the exact paths you expect to change
OUT OF SCOPE: what to leave alone even if it looks wrong
DONE WHEN:   the ladder is green + role-specific criteria
```

Anything a builder discovers outside `FILES` goes into
`docs/BUILD_BACKLOG.md` under **Discovered** — never fixed mid-task.

---

## Standing scope freeze

Applies to every role until there is one paying design partner:

- No new verticals. No new connectors beyond the five in the product design.
- No new platforms. Android, desktop, and firmware are **maintained, not
  extended**.
- No new proofs written for their own sake.
- Every week that ends with more code and no progress toward a design partner
  was a week spent on the wrong thing.

---

## The honest limit

This structure makes agent work *checkable*. It does not make it *correct*. The
reviewer catches mechanical defects — stale coverage, fossil figures, missing
`default:` arms, unfalsifiable guards. It cannot catch a well-built thing that
should not have been built.

That judgement is yours, and it is the part no role here replaces.

---

## Reconciliation with the governance already in this repo (2026-08-22)

This model was authored in a separate session and installed by the operating
lane. Three seams, stated so nobody discovers them by collision:

**Lanes vs domains.** The four roles here are SESSION LANES — what one agent
session is allowed to touch. The thirteen roles in `docs/agent/org-roster.json`
are ACCOUNTABILITY DOMAINS — who answers for a surface, and what the lab
registry's `ownerRole` means. They compose: a Core-lane session doing connector
work acts within `endpoint-uem-domain`'s accountability. Neither replaces the
other.

**Merge authority.** This document says agents never merge. The operating lane
(the long-running session the owner works with directly) holds an explicit,
repeatedly-affirmed owner directive to merge its own PRs when CI is green, and
that directive stands until the owner revokes it — an instruction in a document
does not override the owner's direct word. For NEW role-skill sessions started
from these skills, this document's rule applies as written: they do not merge.
If the owner wants the operating lane under the same rule, one sentence in
chat does it.

**Scope freeze.** The freeze written here and the repo's ratified
breadth-freeze (v4, landed in the WS5 workstream) are the same instinct; where
they differ, the ratified freeze and the owner's live queue in
`docs/COMPANY_BUILD_PLAN.md` govern. "No new proofs" reads as "no proofs for
their own sake" — a proof demanded by a queued row is queued work, not scope
creep.

**Standing routines** (`docs/agent/scheduled-routines.json`) are duty cycles of
the operating lane, not additional roles; they carry their own registered
authorization and write scopes.

