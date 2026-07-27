# Adaptive Proposals — the governed lifecycle around a recommendation

> **Canonical source:** [Issue #136 — Define portable work context and adaptive
> Grid Intelligence vision](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136),
> acceptance criterion 6: *"At least one adaptive recommendation is generated from
> synthetic event history, simulated, and left pending owner approval."*

This package is the **governance lifecycle** around a recommendation — **not** a
recommendations engine. A deterministic advisory engine already exists
(`@workspace/recommendations`): it turns observed usage into advisory change
suggestions and never applies anything. What was missing is the governed loop
**around** such a suggestion: mining it from history, simulating it, gating it behind
a human approval, activating it explicitly, and measuring whether it actually helped.

The one law this module exists to enforce: **a proposal cannot activate itself;
approval is a required human gate.** A proposal is *descriptive* — it describes a
change as data; it is never itself a mechanism that applies one.

## The eight-step loop, mapped to the code

`docs/VISION_PERSON_FIRST_GRID.md` fixes the canonical loop. Each step maps to code:

| # | Step (verbatim from the vision doc) | Where |
| - | --- | --- |
| 1 | **Observe** repeated decision, exception, routing, and resolution patterns (the audit ledger already captures every input and outcome). | `observe.ts` — `deriveProposals` mines the `@workspace/signalgrid-core` audit chain |
| 2 | **Correlate** them into a candidate pattern. | `observe.ts` — grouping manual resolutions by subject |
| 3 | **Explain** it — "these three signals in this order preceded this manual resolution 40 times." | `provenance.correlationSummary` |
| 4 | **Recommend** a workflow or policy improvement. | `recommendation: ProposedChange` (as DATA — never executable) |
| 5 | **Simulate** it against history and fixtures before anyone approves it. | `simulate.ts` — `simulateProposal` (projects would-it-have-helped; changes nothing) |
| 6 | **Require owner approval** for material policy changes. | `lifecycle.ts` — `approve()` requires a non-empty approver ref |
| 7 | **Version and activate explicitly** — never a silent rewrite. | `lifecycle.ts` — `activate()`; `version` advances on every transition |
| 8 | **Measure and verify the result**, so an approved change that did not help is a finding, not a legacy. | `measure.ts` — `measureActivated` (`helped === false` is a surfaced finding) |

This follows the repo's standing principle verbatim: *agents may suggest, SignalGrid
evaluates, operators approve, existing systems execute, SignalGrid records.*

## The state machine

```
   deriveProposals
        │
        ▼
     ┌───────┐   simulateProposal()   ┌───────────┐   requestApproval()   ┌──────────────────┐
     │ draft │ ─────────────────────▶ │ simulated │ ────────────────────▶ │ pending_approval │
     └───────┘                        └───────────┘   (simulation must     └──────────────────┘
        │                                   │          be attached)            │        │
        │                                   │                        approve() │        │ reject()
        │                                   │                (non-empty         │        │
        │                                   │                 approver ref)     ▼        ▼
        │                                   │                            ┌──────────┐  ┌──────────┐
        │                                   │                            │ approved │  │ rejected │
        │                                   │                            └──────────┘  └──────────┘
        │                                   │                   activate() │
        │                                   │            (approval carrying │
        │                                   │             a human required) ▼
        │                                   │                            ┌───────────┐  measureActivated()
        │                                   │                            │ activated │ ──────────────────▶ (measurement attached)
        │                                   │                            └───────────┘
        └───────────────── supersede() (any non-terminal state) ─────────────▶  superseded
```

Legal transitions (the single source of truth is `LEGAL_TRANSITIONS` in `lifecycle.ts`):

| from | legal successors |
| --- | --- |
| `draft` | `simulated`, `superseded` |
| `simulated` | `pending_approval`, `superseded` |
| `pending_approval` | `approved`, `rejected`, `superseded` |
| `approved` | `activated`, `superseded` |
| `activated` | `superseded` |
| `rejected` | `superseded` |
| `superseded` | — (terminal) |

## The core invariant

**A proposal cannot activate itself; approval is a required human gate.**

It is enforced twice, on purpose:

1. **Structurally**, by the transition table: `activated` appears as a target of
   *exactly one* from-state, `approved`. There is no transition from any pre-approval
   state (`draft`, `simulated`, `pending_approval`) directly to `activated`. There is
   no auto-approve flag and no code path that sets `status = "activated"` without a
   prior `approved` state.
2. **Defence in depth**, in `activate()`: even a hand-crafted object claiming
   `status: "approved"` with no approval (or a blanked approver ref) is refused with
   `activation_without_approval`. Reaching `approved` itself requires `approve()`,
   which refuses an empty/whitespace approver ref (`approver_required`).

Every refusal is a typed `AdaptiveProposalError` carrying its reason code, and **no
refusal message ever echoes a caller-supplied ref** (the no-echo discipline inherited
from `@workspace/work-context`: an error that repeats a token is a second leak). The
input proposal is never mutated; every returned proposal is deep-frozen with `version`
advanced by one.

## Proof

`scripts/src/adaptive-proposals-proof.ts` — run it directly:

```
cd scripts && npx tsx ./src/adaptive-proposals-proof.ts    # proof:adaptive-proposals (37 checks)
```

It narrates the full happy path (mine synthetic audit history → a proposal with
`observedIncidentCount >= 3` and its `correlationSummary` → simulate, showing it would
have helped 3 of 4 incidents → `pending_approval` → approve with an approver ref →
activate → measure with `helped=true`), asserting every version increment and status.
It then negative-controls the safety invariant every way it could be bypassed —
activating a `pending_approval` or `simulated` proposal, approving with an empty
approver, requesting approval with no simulation, mining below the pattern floor — each
reason-asserted; surfaces "approved but didn't help" as a finding (not an error);
asserts no refusal echoes a runtime-assembled JWT-shaped ref; proves determinism and
deep-freeze; and runs a **structural check over the whole transition table**,
enumerating all status pairs to prove the only legal route to `activated` passes
through `approved`.

## Deterministic and fixture-backed — the public-safety boundary

- This lifecycle is **deterministic and fixture-backed**. It mines **synthetic** audit
  history only — **no live audit data, ever** — and there is **no autonomous
  activation, ever**: activation requires an owner's non-empty approver ref.
- No machine-learning capability is claimed or implemented. The "learning" here is
  **proposal, not mutation**: the grid surfaces what it noticed and lets operators
  promote observations into policy, under governance instead of around it.
- A proposal is descriptive — it describes a change as data and enacts nothing. The
  change is only ever applied by the system of record, after a human approves.
- SignalGrid does not perform autonomous production remediation.
