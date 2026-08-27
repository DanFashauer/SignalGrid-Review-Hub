# PURPOSE

**Status: canonical. Frozen pending external validation.**

Material changes require new evidence from customer discovery, design-partner
deployment, or observed production-adjacent use. Internal preference alone is
not sufficient grounds to reopen the doctrine. A customer provides the evidence;
SignalGrid decides what the evidence means.

*Last doctrine pass: 2026-08-26.*

---

## 1. Purpose

**Make the right decision at the moment of use.**

## 2. Product

**SignalGrid decides whether a shared-device session should proceed at the
moment of use.**

It deterministically correlates identity, device posture, custody, location and
operational context across authoritative systems, and produces a reconstructable
decision.

## 3. First wedge

**Microsoft Entra + Intune + one healthcare shared-device session workflow.**

Per `SignalGrid_Technology_Ecosystem_Master_Catalog_2026-07-31.xlsx`: *"Launch
with Microsoft Entra ID + Intune and one shared-device workflow. Do not build
every adapter."* The 423-entry catalog is *"strategy, not a build queue."*

## 4. Signature demonstration

Show a real session decision, the complete historical Decision Envelope, the
exact policy version and evidence that produced it, and deterministic
counterfactual replay when one input changes.

---

## Architectural differentiator

**Cross-domain correlation, decided deterministically and reconstructable after
the fact.**

Not neutrality. Neutrality is an architectural prerequisite and an ecosystem
posture — every incumbent claims it, and it is a dependency rather than an
advantage. What is harder to reach from any single plane is a decision that can
be re-derived, with its policy version, and re-evaluated with one input changed.

### The determinism invariant

> Given the same normalized decision inputs and the same policy version,
> SignalGrid produces the same verdict and the same decision rationale.

**Not** byte-for-byte envelope equality. Envelopes legitimately carry
timestamps, source-retrieval metadata, execution receipts and correlation IDs
that are not reproducible and must not be forced to be.

| Operation | What it does |
| --- | --- |
| **Reconstruction** | Returns the historical envelope exactly as recorded |
| **Counterfactual replay** | Substitutes one or more normalized inputs and re-executes the same deterministic policy logic |

### The verdict enum

Ordering preserved from the published OpenAPI contract (`DecisionOutcome`,
spec 0.2.0). Not a binary access gate — four distinct session dispositions:

| Verdict | Meaning |
| --- | --- |
| `allow` | Proceed normally |
| `step-up` | Obtain additional assurance, then proceed |
| `restrict` | Proceed with constrained workflow or capability |
| `deny` | Do not proceed |

*Corrected 2026-08-26.* An earlier draft of this document listed
`allow · deny · step-up · hold`. That was wrong: `restrict` is implemented,
published in OpenAPI 0.2.0, ported to the native surfaces and asserted by the
proof suite; `hold` has no implementation evidence. The doctrine follows the
contract. Adding `hold` would be speculative product development and is
reopened only if a design partner demonstrates a real deferred/human-review
state.

## Architectural prerequisite

SignalGrid consumes authoritative evidence without becoming the underlying
system of record. Source platforms remain authoritative for their own data and
their own actions. SignalGrid consumes, normalizes, evaluates, routes, records
and verifies.

## Strategic hypothesis

> The complete cross-domain moment-of-use decision boundary is insufficiently
> owned by existing platforms.

**Validation status: technically plausible; competitive overlap exists; buyer
demand unvalidated.**

A hypothesis under test, not a finding. The intersection is converging from five
directions at once — Imprivata inward from identity and session context, Intune
and Jamf inward from endpoint posture, LocknCharge and Traka inward from custody
and workflow automation, Smplify inward from endpoint governance and approval
gating, PACS inward from physical identity. **Do not assume the intersection
stays empty.** The window is a reason for urgency, not for another doctrine pass.

## Moat status

**None claimed.**

What exists today: a differentiated architecture, unusual founder domain
knowledge, accumulated implementation work, and a possible head start in one
workflow. Those are assets. They are not a moat.

A moat can only come from deployment — embedded integrations, institution-
specific policy models, operational dependence, accumulated implementation
knowledge, reference customers, switching cost.

**Standing prohibition: SignalGrid does not claim a moat before customer
deployments create one.**

## Economic buyer

**Unresolved. To be answered through customer discovery.**

The champion is likely someone who has run the operating problem — an enterprise
mobility lead or endpoint engineering manager. The economic buyer may be a VP or
Director of Infrastructure, a CIO, a CISO, digital workplace leadership,
clinical technology leadership, or a combination. Founder-market fit is not the
same as knowing who signs. The May 2025 second-opinion review flagged this as
its first open question; it remains open.

---

## The Decision Envelope

The atomic product object. One primitive shared by the engine, the API, the UI,
the audit trail, the demo and eventually the sales story.

```
Decision Envelope
├── subject            who
├── device             which device
├── context            custody · location · shift/role · workflow
├── evidence[]         value · source · provenance · freshness · contradictions
├── policy             id · version · evaluated conditions
├── decision           allow · step-up · restrict · deny
├── reason             the rationale, in operator language
├── requested action   what SignalGrid asked a system of record to do
├── execution result   what that system reported back
└── verification       whether the expected result actually occurred
```

Everything collapses into this:

- **Decision Detail UI** is the human-readable rendering of an envelope.
- **Counterfactual replay** is re-evaluation with one input changed.
- **Audit** is envelope retrieval.
- **The API** is evidence in, envelope out.
- **The demo** is watching an envelope get created.

### Consolidation rule — compatibility-aware

The repository already contains competing names for this object. Measured on
`SignalGrid_Alpha`, 2026-08-26: `DecisionOutcome` (30 files),
`SignalGridDecision` (4), `DecisionResult` (4), `DecisionRecord` (3),
`DecisionEnvelope` (2), plus a generated `Decision` in `lib/api-zod`.

> **`DecisionEnvelope` is the sole canonical first-party term for the complete
> decision transaction. `DecisionOutcome` remains the verdict enum (allow ·
> step-up · restrict · deny). Existing externally exposed or generated names may survive
> only as explicitly documented compatibility aliases, generated artifacts, or
> deprecation shims. No new first-party model may introduce another
> transaction-level decision noun.**

Enforce with a vocabulary gate in `review:invariants` carrying an **explicit
allowlist** of permitted legacy and generated names, registered in preflight
**and** CI, with a `--self-test`. Conceptual purity without gratuitous contract
breakage: the gate blocks new nouns; it does not force a breaking rename of
published schema.

---

## What this doctrine forbids

- Claiming production readiness, certification, compliance attestation,
  partnership or autonomous remediation.
- Claiming a moat.
- Asserting the competitive seam is unowned as settled fact.
- Equating practitioner experience with knowing the economic buyer.
- Making offline/network-dependency the definition of the product. It is a
  structural constraint and the sharpest demonstration — not the thesis.
- Probabilistic scoring as the authoritative decision. Per the ecosystem
  catalog: *"AI may summarize, recommend or triage; the authoritative
  access/trust decision remains deterministic, policy-versioned, testable and
  auditable."*
- New verticals, connectors beyond P0/P1, platforms, hardware, or proofs written
  for their own sake — until a paying design partner exists.

## Outbound question

Not a feature debate. The operational question:

> *"What happens when a shared device leaves your controlled environment before
> your management platform can act?"*
>
> *"Which system knows the employee, the device posture, the checkout state, the
> location and the current policy at that exact moment?"*

The expected answer is not *"our MDM is bad."* It is **"no single system does."**
That is where the conversation starts.

---

## The test

**The constraint is no longer technical possibility. It is external proof that
this decision matters enough for an organization to change behavior around it.**

One fact should govern how this document is used. In **May 2025**, an
independent review named as its Priority 1 action: *"Identify one target
integration — Okta, Jamf, or Microsoft Intune — and build a working
proof-of-concept against a sandbox environment... Aim for a demo-able artifact
within 30 days."* Its Priority 3 action was five customer discovery
conversations.

**Fifteen months later both remain open, and this doctrine pass reached the same
conclusion.** The thesis has never been the bottleneck. Further internal
refinement will produce synonyms, not insight.

The doctrine is now precise enough to be wrong in public. That is the only state
worth having, and it is where product discovery begins.

---

### Lineage

| Date | Source | Contribution |
| --- | --- | --- |
| May 2025 | `SignalGrid.pdf` (v0.1, Pre-Launch Second Opinion) | Independent pre-launch review, composite 6/10. Dominant gaps had shifted toward go-to-market, while live integration validation remained unresolved (Product Readiness 5/10). Economic buyer vs. technical champion flagged as open. |
| Nov 2025 | `Enterprise_Mobility_Modernization_Documentation.docx` | The fragmentation problem, observed from inside a 200K+ device healthcare estate. The ownership-boundary model: IAM owns identity, Network/SASE owns routing, Mobility owns devices. |
| May 2026 | `Enterprise Architecture for Badge Locked Shared Devices and Incident Alerting.pdf` | Two control planes — physical custody and cyber/operations. The deterministic state machine. The canonical event schema. The network-dependency constraint. |
| Jul 2026 | `SignalGrid_Technology_Ecosystem_Master_Catalog_2026-07-31.xlsx` | Freeze breadth. P0 Microsoft wedge. The system-of-record boundary. The AI boundary. |
| Aug 2026 | This document | Purpose · Product · Wedge · Demonstration. Decision Envelope as the atomic object. Moat disclaimed. Thesis frozen pending external evidence. |

*Note: `SignalGrid.pdf` self-identifies as May 2025 in its header, scope section
and footer. Its Drive file metadata shows a later modification date; the document
content governs.*
