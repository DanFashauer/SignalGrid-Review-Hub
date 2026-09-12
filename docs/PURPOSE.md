# PURPOSE

**Status: canonical, v2. Corrected 2026-08-27 (DR-020).**

Material changes require new evidence from customer discovery, design-partner
deployment, observed production-adjacent use, **or a correction of owner intent**.
Internal preference alone is not sufficient grounds to reopen the doctrine.

*v1 described a narrower company than the one being built. See DR-020.*

---

## 1. Purpose

**Make the right things happen when a person and their devices enter an
operational context.**

## 2. Product

**SignalGrid connects the systems a building already runs - access control,
identity, device management, location, applications, ticketing - into one grid
that decides and acts on the person's behalf.**

One credential the person already carries - badge, phone, token, biometric -
carries them through the building. Tap in at the door. Pick up a device. Enter
the room. Open the app. **The identity is continuous; the systems are what is
fragmented.** SignalGrid makes them behave as one, so the person never
negotiates with technology.

Each of those systems is owned, configured and defended by a different person or
team, and every one of them has already decided how its own piece behaves. What
the worker runs into is not only that the systems are separate — it is that
**their owners are separate**, so no single administrator is in a position to
make the chain work end to end. SignalGrid sits above that chain and ingests what
each owner's system already publishes. It asks no owner to give up their system
and it changes no owner's configuration.

**The factor is the customer's choice, and the grid is agnostic to it.** Badge,
prox/RFID, smart card, NFC, mobile credential, passkey or biometric — how a person
proves who they are is an organization's decision and an organization's existing
investment (`docs/CREDENTIAL_READER_SIGNAL_MODEL.md`). SignalGrid reads the result
of whichever one is in use. A grid that required a particular reader would be the
vendor lock it exists to remove.

**A grant is scoped to what the person was assigned** — a department, an area, a
room, a piece of equipment — not to the estate. The scope is the organization's own
assignment, read from the systems that already hold it, never invented here.

A decision is not the output. **A decision is the trigger for a cascade** -
environment, workflow, verification, and escalation when reality does not match
the expected outcome.

### The cascade, named

The cascade has stages, and naming them is what keeps "acts on the person's
behalf" from being decoration. **Status is marked per stage, and a stage marked
design intent is not a capability that ships today** — the launch profile and the
publication boundary govern what may be said, and each unbuilt stage points at its
`docs/BUILD_BACKLOG.md` item rather than at a promise.

| Stage | What it means | Status |
| --- | --- | --- |
| **Decide** | allow / step-up / restrict / deny, deterministic and policy-versioned | **built** — `lib/signalgrid-core` |
| **Plan the downstream actions** | the verdict plus room and workflow context become a plan of concrete actions, each classified auto / assist / step-up / blocked | **built** — `lib/orchestration` |
| **Self-resolve what is safely resolvable** | a block with a known, reversible fix becomes an ordered, approval-gated, simulated resolution path | **built as a planner** — `lib/signalgrid-core/src/resolution.ts`, `/v1/decisions/{id}/resolution`. Nothing executes on a source system; see *Architectural prerequisite* |
| **Route to the owner by the assigned protocol** | the failure is turned into a properly prioritized incident with an impact/urgency priority, an SLA, an assignment group and an escalation flag | **built as a deterministic playbook** — `lib/incident-playbook`; the dispatch half is the emitter families |
| **Open the ticket** | the incident reaches the organization's ITSM as a ticket | **design intent** — the vendor emitters exist and are gated (`lib/integrations/src/integrations/itsm`); no live transport ships here |
| **Open the change record** | a fix that is a change gets a change record, and the record governs the window | **design intent, one half built** — the fabric READS an approved change record (`change-window`) and does not open one |
| **Tell the people affected** | the people whose work is interrupted learn what happened, **through the channel they already use** | **design intent** — and bound by §3: a notification SignalGrid invents that the worker has to go and read is a step added, which the law above forbids |
| **Watch the fix, and step in** | the restriction lifts when the condition is observed to clear, not on a timer; if it does not clear, it escalates | **partial** — exception release and decision continuity exist; a general post-execution verifier does not (`docs/SIGNALGRID_CLOUD_PLATFORM_AND_CYBER_RESILIENCE_ARCHITECTURE.md` §9) |

Two rules bind every stage and are not negotiable by any of them. Nothing in the
cascade may **execute** a change on a source system without a recorded human
approval — the read-before-write prerequisite below is the whole posture. And an
unreachable or unknown downstream system **refuses**: a ticketing backend that
cannot be reached leaves the failure open and says so, and never reports a ticket
it did not open.

### The system underneath is replaceable

**Source-agnostic is the point, not a feature.** The building is the first scope; the
same grid spans every system the company runs — across all of its sites and buildings —
that exposes an API or SDK — the devices
staff use, the admins who run those systems, and the workflows between them. Any such
system is a candidate signal source. None is a dependency. **Vendor lock, in either
direction, is the condition SignalGrid exists to remove** (DR-035).

The decision shape is declared, not learned: *if X, this happens; if Y is not present,
route to X or Y; solve, or deny.* Declared, versioned, deterministic, auditable — that is
what lets an admin trust it and an auditor prove it.

Replacing a system underneath is contract re-validation, not a rewrite: validate the new
system's API against the same contract, and the same workflows carry over. The grid
learns in the build loop and in what it recommends; what it *decides* stays declared.

## 3. The law that outranks everything else

> **The worker never sees SignalGrid.**

This is not a UX preference. It is the thesis.

Every prior layer of technology added a workflow: another login, another app,
another training module. So the technology gets routed around - the phone is the
last thing a clinician picks up, because the fastest path to the patient is the
one that does not require negotiating with a device.

**SignalGrid succeeds only by removing steps, never by adding one.** If the
worker sees it, it has become the thing it replaces. Adoption is the product;
security and evidence are by-products.

Evidence for this is not internal opinion. Physicians spend nearly two hours on
EHR and desk work per hour of direct patient face time (Sinsky et al., Annals
of Internal Medicine, 2016). 73.6% of surveyed medical staff have used another
person's credentials - 100% of residents (Hassidim et al., 2017). Those are
adoption failures wearing a security-breach costume. Both figures are quoted
from the cited studies and remain unverified in this repository.

## 4. Verticals are configuration, not code

Healthcare is the first vertical, not the product. A nurse entering a patient
room and a picker entering a bay are the **same event** to the core: identity +
proximity + workflow context -> decision -> cascade.

**Nothing industry-specific may enter the core.** The core knows `device_posture`
and `local_authority`; it must never know `hospital_room_shade`. Verticals are
policy and configuration over one engine. The moment a vertical needs its own
code path, this is N products and no platform.

## 5. Why the grid compounds

**The more signals it absorbs, the better every decision becomes.** Each new
source improves decisions that already existed - a competitor entering at signal
one cannot catch a grid running at signal twenty.

**This compounds only after deployment.** Signals absorbed in fixtures compound
nothing. That is the argument for a live room, and it gets stronger as the vision
gets larger, not weaker.

---

## Architectural differentiator

**Cross-system correlation, decided deterministically, orchestrated outward, and
reconstructable after the fact.**

Not neutrality - every incumbent claims it. What is hard to reach from any single
plane is a decision that can be re-derived with its policy version and replayed
with one input changed.

### The determinism invariant

> Given the same normalized decision inputs and the same policy version,
> SignalGrid produces the same verdict and the same decision rationale.

Not byte-for-byte envelope equality: envelopes legitimately carry timestamps,
retrieval metadata and execution receipts that are not reproducible.

| Operation | What it does |
| --- | --- |
| **Reconstruction** | Returns the historical envelope exactly as recorded |
| **Counterfactual replay** | Substitutes normalized inputs and re-executes the same deterministic policy logic |

### The verdict enum

Ordering and spelling preserved from the published OpenAPI contract (`DecisionOutcome`,
0.2.0), as DR-019 ratified:

| Verdict | Meaning |
| --- | --- |
| `allow` | Proceed normally |
| `step-up` | Obtain additional assurance, then proceed |
| `restrict` | Proceed with constrained workflow or capability |
| `deny` | Do not proceed |

Two spellings of the second rung are live, each on its own surface, and neither is a
typo. The 0.2.0 contract (`lib/api-spec/openapi.yaml`) and its generated clients
(`lib/api-zod`, `lib/api-client-react`) say `step-up`. The engine (`VALID_OUTCOMES` in
`lib/signalgrid-core/src/policy.ts`) and every outcome enum in the `/v1` contract
(`lib/api-spec/v1-openapi.yaml`) say `step_up`. `scripts/check-decision-vocabulary.mjs`
GATES engine-vs-`/v1` agreement and REPORTS the 0.2.0 divergence, so it stays visible
instead of being tidied into a contract break.

## Architectural prerequisite

SignalGrid consumes authoritative evidence and delegates action. Source systems
remain authoritative for their own data and their own actions. It **reads before
it writes** - the first deployment of any source is read-only, because the badge
and door systems are the most politically guarded in any building and an unknown
vendor does not get write access first.

---

## The lanes where the thesis is testable

This determines what may be built, and it corrects v1's freeze.

| Lane | Status | Why |
| --- | --- | --- |
| **Mac / iOS** | **open** | Invisibility cannot be proven in a container. A real enrolled device in a real hand is the only place the embedded UX law is testable. |
| **API - Bruno - Postman** | **open, gated** | For a product that connects systems, the API surface *is* the product. 57 `/v1` spec paths (as of 2026-08-27; today 58 — `node scripts/build-postman.mjs --check`) are the integration contract. `check:postman` verifies that contract is complete - it is a product gate, not doc-sync. |
| Cloud logic, connectors, proofs | **frozen** — as recorded 2026-08-27; lifted by DR-021 (2026-08-31); see `docs/DECISION_RECORDS.md` | Sufficient. Adding here proves nothing new. *Claim discipline (DR-021 §2) did not lift.* |
| New verticals, platforms, hardware | **frozen** — as recorded 2026-08-27; lifted by DR-021 (2026-08-31), each still needing a decision record first (DR-020 rule); see `docs/DECISION_RECORDS.md` | Until a design partner names one. |

---

## Strategic hypothesis

> No published platform connects access control, identity, device management,
> location, applications and ticketing into one decision-and-orchestration layer
> that acts on the person's behalf without adding a workflow.

**Validation status: technically plausible; competitive overlap exists; buyer
demand unvalidated.**

Artisight sells AI smart-hospital rooms and reaches adoption through passivity -
the closest philosophical neighbour. Imprivata owns badge authentication.
Vocera/Stryker, PerfectServe and TigerConnect own clinical communication. Each
occupies part of the grid. **Do not assume the intersection stays empty.**

## Moat status

**None claimed.** A differentiated architecture, unusual founder domain
knowledge, and accumulated implementation work are assets, not a moat. A moat
comes only from deployment - and from signal compounding, which requires a live
room.

**Standing prohibition: no moat is claimed before deployment creates one.**

## Economic buyer

**Unresolved.** The champion is likely clinical informatics - the **CNIO** or
nursing informatics leadership, who own whether staff actually use the thing -
not the security team. Adoption is their language. Security is the CISO's. Test
this directly; do not assume it.

---

## The Decision Envelope

The atomic product object, and now explicitly including what was orchestrated.

```
Decision Envelope
|-- subject            who
|-- device             which device(s)
|-- context            custody - location - zone - shift/role - workflow
|-- evidence[]         value - source - provenance - freshness - contradictions
|-- policy             id - version - evaluated conditions
|-- decision           allow - step-up - restrict - deny
|-- reason             the rationale, in operator language
|-- requested actions  what SignalGrid asked each system of record to do
|-- execution results  what each system reported back
|-- verification       whether the expected outcome actually occurred
```

`DecisionEnvelope` is the sole canonical first-party term for the complete
transaction; `DecisionOutcome` is the verdict enum. Generated and published
names survive as documented compatibility aliases. No new transaction-level
decision noun may enter the tree.

---

## What this doctrine forbids

- Claiming production readiness, certification, compliance attestation,
  partnership or autonomous remediation.
- Claiming a moat.
- Asserting the competitive seam is unowned as settled fact.
- **Any industry-specific logic in the core.**
- **Any change that adds a step for the worker.**
- Probabilistic scoring as the authoritative decision. AI may summarize,
  recommend or triage; the authoritative decision stays deterministic,
  policy-versioned, testable and auditable.
- Write access to a source system on first deployment.
- **Vendor lock, in either direction** — a design that needs one vendor underneath,
  or that makes leaving SignalGrid cost the customer their workflows (DR-035).

## The test

**The constraint is not technical possibility. It is external proof that this
matters enough for an organization to change behaviour around it.**

An orchestration grid gets smarter by absorbing signals from a live deployment.
Nothing in this repository compounds. One real room does.

---

### Lineage

| Date | Source | Contribution |
| --- | --- | --- |
| May 2025 | `SignalGrid.pdf` v0.1 | Independent pre-launch review, 6/10. Gaps go-to-market; live integration unresolved. |
| Nov 2025 | `Enterprise_Mobility_Modernization_Documentation.docx` | Fragmentation observed inside a 200K+ device healthcare estate. Ownership boundaries: IAM, Network/SASE, Mobility. |
| May 2026 | `Enterprise Architecture for Badge Locked Shared Devices and Incident Alerting.pdf` | Two control planes. The deterministic state machine. The network-dependency constraint. |
| Jul 2026 | `SignalGrid_Technology_Ecosystem_Master_Catalog_2026-07-31.xlsx` | Freeze breadth. P0 Microsoft wedge. System-of-record and AI boundaries. |
| Aug 2026 | PURPOSE v1 | Decision Envelope, determinism invariant, moat disclaimed. **Described a gate, not the grid.** |
| Aug 2026 | **PURPOSE v2 (DR-020)** | Orchestration thesis. Credential as spine. Embedded UX law promoted to thesis. Verticals as configuration. Mac and API lanes reopened. |
