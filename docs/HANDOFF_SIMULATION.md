# Cross-Device Handoff Simulation & Exception-Release Loop

> **Canonical source:** [Issue #136 — Define portable work context and adaptive
> Grid Intelligence vision](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136),
> the owner-authored governing artifact. This document covers two of its
> acceptance criteria: *a deterministic cross-device handoff simulation preserves
> role/workflow context while re-evaluating device and location trust*, and the
> warehouse criterion's second half: *verify that the inventory/bin state was
> corrected before releasing the workflow.* Where the two disagree, #136 states
> the destination and this file states the present.

**This is a deterministic fixture simulation — no live systems, no production
workflow.** A handoff script is data: a typed sequence of steps (`assemble`,
`handoff`, `exception`, `resolve`, `verify`, `release`) that
`@workspace/handoff-sim` (`lib/handoff-sim/src/`) replays through the *real*
mechanisms — `assembleWorkContext` and `reevaluateForDevice` from
`@workspace/work-context`, the real task-exception chain (`normalizeReport` →
`evaluateTaskException` → `fromTaskException`), and the real `resolveException`
door. The simulator invents no verdict, holds no real task, moves no inventory,
and grants nothing. Every run of the same script is byte-identical; the input
script is never mutated; the trace is deep-frozen. The trace — every step's
context version, decision, active/held sets, carried refs, and typed refusal
codes — **is** the audit story.

## The release-loop law

> **A resolution posting is not verification; release requires independent
> evidence AND a trusted device.**

The law is grounded in the verified Oracle WMS short-pick chain the
task-exception dimension already models: a short pick opens a discrepancy, the
discrepancy spawns a cycle-count task, and it is the *count* — a different
record, produced by a different act — that confirms the fix. The adjustment
posting says "we changed the number"; the count says "the number now matches the
bin." The task-exception evaluator carries this at verdict level
(`resolution_task_created` never softens severity — a ticket is not a fix);
`releaseHeldTask` carries it at release level. A held task is released **only**
when all of these hold:

1. **Resolved** — a recorded, non-empty resolution ref exists for the exception.
   Otherwise: typed refusal `exception_unresolved`.
2. **Independently verified** — a recorded, non-empty verification evidence ref
   exists (`verification_missing` otherwise) **and it is not the resolution
   ref** — the fix citing itself as its own proof is refused
   (`verification_not_independent`).
3. **Actually held** — releasing a task the context does not hold is
   `task_not_held`, never a silent success.
4. **Trusted device** — the current device's own most recent composition must be
   below restrict-grade (`device_not_trusted_for_release` otherwise). Judged on
   the device's *own* composed action, deliberately: the carried person-scoped
   ceiling is lowered only through its own resolution door
   (`lowerTrustCeiling`), never by a release — and never blocks release from a
   healthy device.

Every refusal is a typed error, and no refusal message echoes a caller-supplied
ref — the no-echo discipline `@workspace/work-context` enforces (an error that
repeats an attacker-chosen string is a second leak; adversarial review has
already burned one refusal path with exactly that defect). On success the task
moves held→active, the exception entry is removed via the real
`resolveException` door (which re-validates the resolution ref and advances
`contextVersion` exactly once), and everything else is carried.

### Two rules the seventh adversarial review added to the law

- **The named exception must be the one holding the named task.** Before the
  hold linkage existed, a resolved-and-verified exception could release ANY held
  task — review demonstrated task-2 going live against exc-A's evidence while
  task-2's own blocker exc-B was still open. The ledger now records which
  exception holds which task at hold time, and release checks the pair
  (`exception_does_not_hold_task`).
- **One evidence record proves one fix.** The same cycle-count ref verified two
  independent exceptions — evidence replay. An evidence ref already recorded as
  another exception's verification refuses (`verification_evidence_reused`), and
  the independence comparison is whitespace-trimmed so a trailing space cannot
  turn the fix into its own proof.

## Walkthrough 1 — warehouse: wrong-aisle exception, full release loop

The picker (`person-0001`, wave `wave-0092`) carries two active tasks. A
wrong-aisle inventory discrepancy (vendor code `DIFF`, carried verbatim) is
raised by the execution-system fixture on `task-0107`; the release of the held
task is then attempted at every wrong moment before the right one.

| # | Step | Decision (device → final) | Active / held | Carried refs & refusals |
|---|------|---------------------------|---------------|-------------------------|
| 0 | assemble (v1) | — | 0107, 0108 / — | ceiling `none` |
| 1 | handoff → handheld-A (v2) | none → none | 0107, 0108 / — | clean start owes nothing |
| 2 | exception on task-0107 (v3) | alert → alert | **0108** / **0107** | real chain: `INVENTORY_EXCEPTION_ACTIVE:exc-0107-wrongaisle` travels; ceiling → `step_up`. **The worker keeps working: task-0108 stays active** — one bad pick holds one task, not the shift |
| 3 | handoff → workstation-B (v4) | restrict → restrict | 0108 / 0107 | held task + exception carried; `LEFTOVER_SESSION` joins restrictions; ceiling → `restrict` |
| 4 | release | — | 0108 / 0107 | **refused `exception_unresolved`** — no fix posted yet |
| 5 | resolve (`wms-inventory-adjustment-0107`) | — | 0108 / 0107 | recorded; context untouched — a posting releases nothing |
| 6 | release | — | 0108 / 0107 | **refused `verification_missing`** — the fix is not the proof of the fix |
| 7 | verify with the *resolution* ref | — | 0108 / 0107 | recorded |
| 8 | release | — | 0108 / 0107 | **refused `verification_not_independent`** — one record cannot be both fix and proof |
| 9 | verify (`cyclecount-recount-0107`) | — | 0108 / 0107 | distinct evidence — the count that confirms the bin |
| 10 | release (on workstation-B) | — | 0108 / 0107 | **refused `device_not_trusted_for_release`** — its own composition is restrict-grade |
| 11 | handoff → handheld-A (v5) | none → restrict | 0108 / 0107 | device is clean, but the carried `restrict` ceiling is still owed |
| 12 | release (v6) | — | **0108, 0107** / — | **succeeds**: task active again, exception entry removed via the real `resolveException` door |

`contextVersion` strictly increases at every context-changing step
(1→2→3→4→5→6); refused steps change nothing. Workflow key, app catalog, and
custody refs are identical first to last — the role/workflow context is
preserved while trust is re-evaluated per device.

## Walkthrough 2 — healthcare: three shared iPads

The nurse (`person-0210`, unit `unit-4east`, `healthcare-med-admin`) moves
between shared iPads. Nothing is wrong with the work; one device is stale.

| # | Step | Decision (device → final) | Carried state |
|---|------|---------------------------|---------------|
| 0 | assemble (v1) | — | `medpass-0651` active; ceiling `none` |
| 1 | handoff → iPad A (clean, v2) | none → none | clean start owes nothing |
| 2 | handoff → iPad B (stale posture, v3) | step_up → step_up | decision tightens; ceiling ratchets to `step_up`; **work byte-identical to iPad A's** |
| 3 | handoff → iPad C (clean, v4) | none → **step_up** | the clean device still owes the carried ceiling until an explicit, referenced resolution — movement never lowers it |

## What the proof checks

Proved by `pnpm run proof:handoff-sim` (59 checks) —
`scripts/src/handoff-sim-proof.ts`, fully offline and deterministic. It replays
both scenarios above and asserts, among others:

- the real task-exception chain concluded the wrong-aisle verdict
  (reason-asserted: `INVENTORY_EXCEPTION_ACTIVE`, posture
  `inventory_exception`, action `alert`) and the carried entry derives its
  prefix from that real reason code;
- every refusal in the release vocabulary fires **for its stated reason**
  (`task_not_held`, `exception_unresolved`, `verification_missing`,
  `verification_not_independent`, `device_not_trusted_for_release`, plus the
  underlying door's `unknown_exception_ref` and the script-shape
  `step_before_assemble`) — and **no refusal message echoes any
  caller-supplied ref**, asserted on the thrown messages themselves;
- trace invariants over both scenarios: `contextVersion` monotone (strict
  exactly at applied context-changing steps), the active+held task union
  conserved at every transition (no task ever lost), active/held membership
  changing only at explicit hold/release steps, exception refs supersets except
  at an applied release (which removes exactly one), and byte-identical traces
  across repeated runs. The proof's `figures=` line reports the counters
  (`scenarios=2`, `steps=17`, `refusals=10`, all violation counters `=0`).

## Public-safety boundaries

- This package and its proof are deterministic fixture simulations. No live
  hardware, no vendor API calls, no customer locations, no PHI, no PII, no live
  tenant identifiers, no credentials anywhere.
- A handoff script, its trace, and every context in it are descriptive, never
  permissive: presenting any of them to any endpoint grants nothing. Trust is
  re-evaluated per device from that device's own signals through the fabric's
  real composition.
- Every ref is an opaque, sanitized handle; credential-smelling values are
  refused by the underlying work-context sweep with a typed error, never
  carried. Refusal messages never repeat caller-supplied values.
- The execution system (WMS/EMR) stays the system of record: the simulator
  holds and releases the *description* of a task in the carried context. It
  assigns no task, confirms no pick, closes no exception, and adjusts no
  inventory.
- Releases require a referenced resolution, distinct verification evidence, and
  a currently-trusted device — approval-shaped gates stay explicit, and none of
  them is a production workflow.
