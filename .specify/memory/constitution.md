# SignalGrid Constitution

This is the document `/speckit-plan` and `/speckit-analyze` check a plan against. It is
not new doctrine: every article below is CLAUDE.md, `docs/PURPOSE.md` (DR-020) or a
numbered decision record restated in the shape spec-kit's Constitution Check reads.
Where the two disagree, CLAUDE.md wins and this file is wrong.

## Core Principles

### I. Fail-closed, deterministic, truthful (NON-NEGOTIABLE)
No `Date.now()` and no `Math.random()` on a decision path. An unknown, unreachable,
unparseable, missing or stale signal RAISES assurance and never lowers it — the phone
whose management state cannot be read is the phone that gets the stricter answer. A
gate reports what it measured: a failing gate is failing, a skip is not a pass, and a
walk that could not look says so instead of reporting a tree it never read.
`pnpm run review:invariants` enforces this and stays green. (CLAUDE.md golden rule 2.)

### II. The frozen ports are byte-faithful
`native/ios/EnterpriseShell/Services/DecisionEngine.swift` and `AppWorkflows.swift`
are ports of the TypeScript simulator and are never modified for behaviour; parity is
the point and a gate holds it. New logic goes around them, never through them.
(CLAUDE.md golden rule 1.)

### III. SignalGrid is invisible to the person it serves
The worker uses their own host app. SignalGrid decides — allow / step_up / restrict /
deny — and the host and the systems of record carry it out. Domain safety belongs in
the host application, not here. (CLAUDE.md golden rule 3.)

### IV. Platform honesty
An app cannot grant device access, restrict other apps, make itself non-removable or
self-kiosk; those are MDM and OS capabilities that need a supervised device. Nothing
running in a simulator is claimed as on-device enforcement. (CLAUDE.md golden rule 4.)

### V. Provenance is the product
A simulation result records the tree that produced it, sampled BEFORE the run, and
`provenance.workingTreeClean` counts untracked files. Build output is gitignored;
derived files are regenerated from their source of truth, never hand-edited, and
regenerated LAST, after every other file in a change exists.
(CLAUDE.md "Simulation results"; DR-036 "derived, never typed".)

### VI. Building is not claiming
Engineering is unfrozen (DR-021); what may be SAID to ship is governed separately by
the launch-claims gate, the launch profile and the publication boundary. A deferred
capability is hedged where the claim is; a disclaimer elsewhere in the file does not
reach it. Readiness is the lowest of three measured dimensions, derived by
`scripts/check-readiness-figure.mjs`, never a typed number. (DR-021, DR-033, DR-036.)

### VII. Done means proven and on the remote
Done = the gates pass with their output quoted AND the commit is confirmed on origin
by `git ls-remote`. Numbers come from output, never memory. No check is bypassed —
no `--no-verify`, no stash-to-dodge, no quiet flags, no force-push; a failure is
reported and its cause fixed. A new gate or proof ships with the planted defect that
proves it can fail. (CLAUDE.md "Truth and completion".)

## Constraints

- **Owner-gated tiers.** DECISION_PATH (`lib/*`, `/v1`, connectors, `native/`) and
  SAFETY_MACHINERY (`scripts/**`) merge only by the owner. A spec that touches them is
  a proposal; merging it is the decision. New verticals, platforms or hardware get a
  decision record first (DR-020 rule), and every record states how it gets undone.
- **Ask before** destructive git, sending data to any external service, and
  committing or pushing unless asked. No model identifier in any committed artifact.
- **Both gate suites before any push** — `node scripts/preflight.mjs` and
  `pnpm run verify:breadth`. The macOS harness is narrower than either.
- **Third-party code is pinned** to a full commit sha and never auto-executed from a
  hook (`docs/agent/RESOURCE_INTAKE.md` rules; `.claude/skills/VENDORED.md`).

## Development Workflow

`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, each
gated by a human, maps onto what this repository already does: a spec is a decision
record proposal or a `docs/BUILD_BACKLOG.md` row; a plan names the proof that will
hold it; a task is done when its gate is green with quoted output. `/speckit-analyze`
runs before implement, and its Constitution Check reads this file. The
`spec-driven-development` skill (vendored 2026-09-12) describes the same four phases
and remains the narrative guide; this file is the checklist.

## Governance

CLAUDE.md governs implementation and overrides this file; `docs/PURPOSE.md` is
canonical for what SignalGrid is (DR-020). Amendments arrive as decision records in
`docs/DECISION_RECORDS.md`, each with a reversal clause, and are mirrored here in the
same change. A principle stated here that no gate holds is a principle to gate, not a
principle to delete.

**Version**: 0.1.0 | **Ratified**: pending — proposed 2026-09-18, ratified when the owner merges the PR that carries it | **Last Amended**: 2026-09-18
