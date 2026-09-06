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

A decision is not the output. **A decision is the trigger for a cascade** -
environment, workflow, verification, and escalation when reality does not match
the expected outcome.

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
