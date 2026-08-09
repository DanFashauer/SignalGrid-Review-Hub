# SignalGrid Enterprise ITSM Layer Model

> **ITSM owns the service workflow. SignalGrid supplies the trust decision, evidence,
> owner, and verification requirements that make the workflow accountable.**

Nested inside `SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`. That document says which layer
of IT owns a thing; this one says what happens to a refusal *after* it is made — which
object carries it, who works it, and what has to be true before the restriction lifts.

Enforced by `scripts/check-it-layer-model.mjs`. The ITSM routing here is **derived**,
not written down: see §6.

---

## 1. Purpose

A verdict is not an outcome. `restrict` tells a worker they are stopped; it does not
tell anyone what to do about it. The gap between those two is where operational time
actually goes, and it is the gap this model closes.

For every refusal the decision core can produce, this answers:

```text
Who owns the exception?
Which ITSM object should carry it — incident, problem, change, or service request?
What evidence proves the state?
Can the fix be verified, or does a human have to attest it?
May the restriction be released yet?
```

---

## 2. Source ITSM layer taxonomy

Four layers, six domains each, recorded verbatim.

| Layer | Domains |
| --- | --- |
| **1 — User / Interface** | Service Portal · Service Catalog · Self-Service Knowledge · Service Desk · Experience Feedback · Digital Accessibility |
| **2 — Service Delivery** | Incident Management · Service Requests · Problem Management · Change Enablement · Service Levels · Continual Improvement |
| **3 — Infrastructure / Technology** | Monitoring & Events · Service Configuration · IT Asset Management · Cloud Operations · Release & Deployment · Observability & Automation |
| **4 — Governance / Security** | I&T Governance · Risk & Compliance · Information Security · Service Performance · Supplier Management · AI Governance |

### The framework-naming correction, preserved

The source diagram cites "ITIL (Version 5)." A staged New ITIL rollout is underway while
most organisations still run ITIL 4 practices and hold ITIL 4 certifications. **This
repository must not claim "SignalGrid is ITIL 5 aligned"** — or ITIL-aligned at any
version. That is a framework-conformance claim, and SignalGrid has not been assessed
against any of them.

Safe language, and the only language to use on a customer-facing surface:

```text
ITSM practice references     (incident, problem, change, request — the vocabulary)
COBIT governance reference   (governance vs management, decision rights)
customer-owned ITSM process mapping
```

Same rule as the certification posture in `PUBLIC_MESSAGING_GUARDRAILS.md`: name the
vocabulary you use, never the conformance you have not earned.

---

## 3. SignalGrid's ITSM role

SignalGrid is not an ITSM tool and does not become one here. It sits *upstream* of the
service workflow and supplies four things the workflow needs and cannot compute:

```text
Decision
  → service impact
  → owner
  → ITSM object (incident / problem / change / service request)
  → verification requirement
  → restoration evidence
  → control-effectiveness feedback
```

The launch-safe form:

> For Limited GA, SignalGrid **exposes the route and evidence contract**. The operator
> creates or links the ticket. There is no write integration to any ITSM system.

That boundary is deliberate and is restated in §10.

---

## 4. Layer 1 — User / Interface

**SignalGrid's role here is NONE, and that is asserted rather than assumed.**

The gate fails if any reason code maps into Layer 1. A code landing here would mean
SignalGrid had grown a worker-facing surface, which the embedded-UX law forbids: the
host application owns the portal, the catalog, the knowledge article, the service-desk
intake, and the accessibility of everything the worker sees. SignalGrid returns a
decision; it never renders one.

This is the only layer in either model that is **empty by design**, and the gate treats
a non-empty Layer 1 as a failure rather than as progress.

---

## 5. Layer 2 — Service Delivery

Where a refusal becomes a routed object. The four carriers, and what earns each:

| Object | Earned by | Meaning |
| --- | --- | --- |
| **Service request** | a self-service fix with a re-evaluatable transform | the worker or device can resolve it; verification is a re-run |
| **Change** | an approval-gated fix with a transform | someone must authorise it; verification is a re-run |
| **Incident** | a manual-only fix, or **no served fix at all** | a human owns it and must attest the outcome |
| **Problem** | a policy-plane code | the policy is the gap, and it recurs until policy changes |

`NO_RULE_MATCHED_DEFAULT_STEP_UP` deriving a **problem** rather than an incident is the
mapping worth pausing on. A decision that fell through every rule is not a fault in any
source system — it is a coverage gap in the policy, it will happen again to the next
worker, and filing it as an incident would close it repeatedly without ever fixing it.
Problem management exists for exactly that shape.

---

## 6. Layer 3 — Infrastructure / Technology

Supplies the operational evidence a decision rests on, and the evidence that a
remediation actually took. This is where most refusals live — posture freshness,
management-plane health, asset custody, dock and badge state.

### The derivation, which is the point of this document

**Nothing in §5's table is declared per reason code.** `resolution.ts` already states,
once, whether a refusal has a served fix and who may apply it. The gate reads it:

```text
auto_proposed    + transform  → service_request   verified by simulated re-evaluation
requires_approval + transform → change            verified by simulated re-evaluation
manual_only                   → incident          verified by human evidence
no descriptor at all          → incident          verified by human evidence
a policy-plane code           → problem           verified by human evidence
an allow                      → none              not applicable
```

Writing an `itsmObject` field onto each code would have created a second source of truth
for a fact already stated — the same mistake `decisionImpact` avoided in the parent
model. Run the gate for current figures:

```bash
node scripts/check-it-layer-model.mjs
```

### What the derivation found

**Four refusals have no served resolution path at all** —
`BENCHMARK_SELECTION_MISFIT`, `BENCHMARK_SELECTION_UNESTABLISHED_STRICT`,
`SHIFT_CONTEXT_MISFIT`, `SHIFT_CONTEXT_UNESTABLISHED_STRICT`. A worker hitting one of
these is stopped with no self-service step attached, so a human owns it.

That is **reported, not failed**. A refusal a human owns is legitimate. It is printed on
every run because it is the honest measure of how much of the estate SignalGrid can
route to a served path, and a silent count would let that shrink unnoticed. It is also a
concrete backlog: four codes that would benefit from resolution descriptors.

---

## 7. Layer 4 — Governance / Security

Governs who may change policy, approve an exception, and judge whether a control is
effective. Three things land here:

- **Policy-plane codes** — `TRUST_ESTABLISHED`, `NO_RULE_MATCHED_DEFAULT_STEP_UP`,
  `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` — route to the governance owner, not to a
  source-system team.
- **Identity, credential and threat codes** — the security half of the parent model's
  IT Security & Risk Management layer.
- **AI governance** — the source diagram's "responsible AI" row, which SignalGrid
  already enforces mechanically rather than by policy: every remediation proposal is
  `approvalRequired` and `simulatedOnly`, there is no executed status in the type, and
  the decision path contains no model, no clock read and no randomness. See
  `SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md` §10. *AI may recommend; deterministic
  policy decides* is a gate here, not an aspiration.

COBIT's governance/management split is the useful reference: governance sets direction
and decision rights; management executes within them. SignalGrid is a management-plane
component that **reports upward into governance** — it never sets its own policy.

---

## 8. Decision → object lifecycle

```text
decision (allow / step_up / restrict / deny)
   └─ reason codes                       ← what failed, named
        └─ IT layer + owner              ← who fixes it            (parent model)
             └─ ITSM layer + object      ← what carries the work   (derived, §6)
                  └─ verification class  ← how the fix is proven   (derived, §6)
                       └─ release        ← re-evaluate, then lift
```

The last step is the one that matters and the one most systems skip: **a restriction is
released by re-evaluating the decision, not by closing the ticket.** A closed ticket is
a claim that work happened. A re-evaluation that now reaches `allow` is evidence that
the state changed. Those are different, and conflating them is the unearned affirmative
in its ITSM clothing.

---

## 9. Verification and service-restoration evidence

Two classes, derived:

- **`simulated_reevaluation`** — the descriptor carries an evidence transform, so
  `simulateResolution()` can re-run the shipped policy against transformed evidence and
  show whether the fix reaches `allow`. This is a *preview*, not a state change: it
  never mutates stored evidence.
- **`human_evidence_required`** — no transform. Nothing can be simulated, so a person
  attests. Every one of these is a place where "verified" rests on a human claim, and
  the model marks them so nobody mistakes attestation for measurement.

Neither class is a write. Approving a remediation records and simulates it; it never
executes a change on a source system (`proposeRemediation`, and the absence of an
executed status by design).

---

## 10. Limited GA scope

**No ITSM write integration ships.** No ServiceNow, Jira, or Freshservice connector, and
the `itsm` family stays read-only and gated as it is today.

What ships is the **contract**: for any refusal, the layer, the owner, the ITSM object
type, and the verification class are all determined and checkable. The operator creates
or links the ticket themselves.

Against the launch families:

| Launch family | Owner | Typical carrier |
| --- | --- | --- |
| `graph` | identity platform | change or incident, depending on whether the fix is approval-gated |
| `device-management-health` | endpoint operations | service request when posture can be refreshed; problem when it recurs |
| `local-authority` | network infrastructure | incident — local-path failures rarely have a served self-service fix |

**Deliberately not claimed:** that any of this reaches a ticketing system, that an
assignment group is resolved, or that an SLA is tracked. See §11.

---

## 11. Deferred ITSM expansion

- **Owner and routing on the wire.** No `/v1` response carries layer, owner, ITSM object
  or verification class yet. This is the same gap the parent model records, and closing
  it is API surface held outside the freeze.
- **Tenant service mapping.** The nine owner roles are archetypes. Mapping them to a real
  organisation's assignment groups, service catalog items and SLA targets is tenant
  configuration that does not exist.
- **The proposed `ITSM_*` reason codes are not minted.** Twelve were suggested. They are
  not on the wire, for the standing reason: a code no rule emits is a string that looks
  like evidence and is not. Two are worth calling out specifically:
  - `ITSM_SERVICE_OWNER_UNRESOLVED` — **structurally unreachable today.** The layer-model
    gate fails the build if any reason code lacks an owner, so an unresolved owner cannot
    occur. It becomes meaningful only once tenant-level mapping exists and can be
    incomplete.
  - `ITSM_REMEDIATION_NOT_VERIFIED` — the closest to real, because the verification class
    is already derived. It needs a remediation *lifecycle* to attach to, which is the
    write path being deferred.
- **SLA and service-performance feedback.** Restoration timing, control effectiveness and
  KRI feedback are Layer 4 concerns the model names but does not compute.
- **Supplier management.** No supplier or contract plane is modelled at all.

---

## Running the gate

```bash
node scripts/check-it-layer-model.mjs             # includes the ITSM derivation
node scripts/check-it-layer-model.mjs --self-test # controls, including the ITSM rules
```

Related: `SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md` (the container),
`SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`,
`SIGNALGRID_SSO_EVIDENCE_FIRST_TROUBLESHOOTING.md`, `LAUNCH_PROFILE.md`.
