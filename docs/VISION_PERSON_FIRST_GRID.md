# Vision: The Person-First Grid

> **Canonical source:** [Issue #136 — Define portable work context and adaptive
> Grid Intelligence vision](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136),
> the owner-authored governing artifact. This document is the repo-side receipt
> ledger for it: every claim below is marked Built / Modeled / ROADMAP against
> the actual code. Where the two disagree, #136 states the destination and this
> file states the present.
>
> The one-line thesis, from #136: **portable work context plus adaptive
> operational trust** — verify the physical person, carry their role-appropriate
> work context across authorized devices, re-evaluate trust for each device and
> situation, and decide what should happen next, without the worker ever
> operating a SignalGrid screen.

This captures the founder's product thesis in the repo's own vocabulary, with a
receipt for every claim that is already built and an explicit ROADMAP marker on
every claim that is not. The discipline matters more here than anywhere else:
a vision doc that blurs built and imagined is how a demo becomes a liability.

## The thesis

The physical person is the root of trust — identified by badge, face, or
fingerprint at a reader — and everything else follows them. Whatever shared
device they pick up delivers the same experience and the access their moment
actually requires, because the grid already knows who they are, what they are
holding, where they are standing, and what state every relevant system is in.

The product is the **glue layer**: it does not replace the WMS, the EMR, the
MDM, the PACS, or the dock — it fuses their signals into one runtime decision
and routes the outcome to whoever or whatever resolves it.

## What each part of the thesis maps to

| Thesis | Status | Where |
| --- | --- | --- |
| Badge identifies the person; the binding is a live signal | **Built** | badge-binding dimension; RFID reader-case model; `badge_binding` signal category |
| Face/finger at a reader identifies the person | **Built as an event, deliberately not as biometrics** | pacs-access dimension. The reader/PACS performs the biometric match; SignalGrid consumes only the resulting identification event. Biometric templates never enter this system — a hard boundary, kept on purpose. |
| The session follows the person across shared devices | **Built** | sso-session dimension (leftover-session risk), app-workflow catalogs per vertical |
| Access scales with the moment's risk | **Built** | allow / step-up / restrict / deny across 20+ fused dimensions; worst-concern-wins |
| More signals make the grid more effective | **Built** | Signal Radar classifies every incoming category as evaluated / candidate / novel and alerts on signals the grid is not yet consuming |
| Exceptions trigger routed, automated resolution | **Built, approval-gated** | Resolution Assistant, flows engine, remediation requests — proposed, simulated, operator-approved; never autonomous production remediation |
| Vendors embed SignalGrid in their hardware | **Modeled** | DockBridge ingestion modes: `app_in_dock` (SignalGrid agent in third-party dock firmware), `vendor_api`, `edge_gateway` |
| Customers may choose SignalGrid hardware — or not | **Modeled** | SmartDock is documented as an optional layer; every custody capability also has a hardware-neutral ingestion path |
| Task-plane exceptions (wrong-aisle bin, item not in inventory) as grid signals | **Built** | task-exception dimension: `pnpm run proof:task-exception` (195 checks); the WMS stays system of record; integrity-class exceptions restrict and route to security operations, inventory-class alert and route to operations. An earlier draft of THIS ROW still said "not built" in the change that built it — caught by adversarial review, which is the discipline this table exists to enforce. |
| The grid learns new flows from observed actions | **ROADMAP — and reframed, see below** | Recommendations engine exists (deterministic); no pattern-mining exists. |

## "Learning", stated the way a buyer can accept

The grid today is deterministic and explainable: the same signals produce the
same verdict, and every verdict carries its reasons. In the target verticals —
hospitals, warehouses, factories — that is not a limitation to apologize for;
it is the property that makes deployment approvable.

The honest form of the learning thesis is therefore **proposal, not mutation**,
and Issue #136 fixes its canonical shape as an eight-step loop — the two steps
beyond an earlier draft of this document (simulate, and measure afterwards) are
the ones that make the loop falsifiable:

1. **Observe** repeated decision, exception, routing, and resolution patterns
   (the audit ledger already captures every input and outcome).
2. **Correlate** them into a candidate pattern.
3. **Explain** it — "these three signals in this order preceded this manual
   resolution 40 times."
4. **Recommend** a workflow or policy improvement.
5. **Simulate** it against history and fixtures before anyone approves it.
6. **Require owner approval** for material policy changes.
7. **Version and activate explicitly** — never a silent rewrite.
8. **Measure and verify the result**, so an approved change that did not help
   is a finding, not a legacy.

This follows the repo's standing principle verbatim: *agents may suggest,
SignalGrid evaluates, operators approve, existing systems execute, SignalGrid
records.* A grid that silently rewrites its own rules is not smarter — it is
unauditable. A grid that shows its operators what it noticed, and lets them
promote observations into policy, compounds exactly the way the thesis wants
— under governance instead of around it.

## Non-claims

- No machine-learning capability is claimed or implemented in this repository.
- SignalGrid does not process, store, or match biometric data; it consumes
  identification events from systems that do.
- SignalGrid does not replace any system of record, and no vendor named in any
  linked document is a partner unless a partnership is separately announced.
- Nothing here is production-readiness, compliance, or certification language.
