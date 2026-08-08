# SignalGrid Zero Trust Decision Principles

> **Zero Trust defines the principles. SignalGrid operationalizes them at workflow time.**

This is the doctrine layer. It states how SignalGrid interprets Zero Trust, and — more
importantly — which of those interpretations are **enforced by code and re-checked on
every commit** rather than asserted here and left to rot.

The enforcement lives in `scripts/src/zero-trust-principles-proof.ts`
(`pnpm run proof:zero-trust-principles`). Every claim below is marked:

| Mark | Meaning |
| --- | --- |
| **PROVEN** | A named assertion in the proof fails if the engine stops behaving this way. |
| **STRUCTURAL** | True because of a contract shape (a field that does not exist, a status that has no value), also asserted. |
| **DOCTRINE** | A design commitment governing future work. Not machine-checked, and labelled so nobody mistakes it for a guarantee. |

Nothing in this document adds product scope. It adds no signal, no connector family, no
new reason code. It names a mapping that already existed and makes it re-checkable.

---

## 1. Why Zero Trust is not a product

Zero Trust is an architectural principle: no implicit trust from network position,
device ownership, or a prior successful login. It is satisfied by an *architecture*, not
purchased as a *component*. Every vendor claiming to "be" Zero Trust is selling one
organ and calling it the body.

SignalGrid does not claim to be Zero Trust. It claims one specific job inside a Zero
Trust architecture:

> **SignalGrid turns Zero Trust from static access policy into a live decision: who is
> acting, on what device, in what workflow, with what evidence, right now.**

The launch-safe form, which is the one that should appear on any customer-facing
surface:

> **For Limited GA, SignalGrid applies Zero Trust to one shared-device workflow using
> Graph posture, device-management health, and local authority — advisory first,
> evidence-backed, and fail-closed.**

---

## 2. SignalGrid as a policy / evidence decision plane

NIST SP 800-207 decomposes a Zero Trust architecture into four roles. SignalGrid is
deliberately not all four, and saying which ones it is *not* is the honest part.

| NIST SP 800-207 role | Who plays it | SignalGrid's part |
| --- | --- | --- |
| **Policy Information Point (PIP)** | Graph / Intune / UEM / EDR / IdP / dock / PACS | SignalGrid's **connectors** consume these. It does not originate the facts. |
| **Policy Engine (PE)** | **SignalGrid** | The deterministic decision core: evidence in, `allow` / `step_up` / `restrict` / `deny` out, with reason codes and a policy version. |
| **Policy Administrator (PA)** | **SignalGrid** | The action plan, approval gating, and post-action verification path. Advisory at Limited GA — see §10. |
| **Policy Enforcement Point (PEP)** | Host app, IdP, UEM, EDR, gateway, **or a human operator** | **NOT SignalGrid.** The decision is returned; something else acts on it. |

At launch SignalGrid is the **Policy Engine + evidence fabric + routing/verification
plane**. It is not the enforcement point, and a green proof run does not establish that
any enforcement point honoured a decision. The proof says so in its own output.

SP 800-207A extends this: trust moves from network location toward identity-tier and
network-tier policy across applications and services. SignalGrid sits at the identity ×
device × workflow intersection, which is the tier a network gateway cannot see.

---

## 3. The 12 principles, mapped

### 3.1 The canonical twelve

| Zero Trust principle | SignalGrid meaning |
| --- | --- |
| 1. Verify Explicitly | Every decision verifies identity, device, workflow, policy, source, and freshness. |
| 2. Assume Breach | Treat every signal as potentially stale, contradictory, or compromised until proven otherwise. |
| 3. Continuous Verification | Do not trust only login time; re-check during the session and before sensitive actions. |
| 4. Signal-Driven | Decisions come from live, validated evidence — not static labels. |
| 5. Just-In-Time Access | Grant temporary authority for the current task only. |
| 6. Just-Enough Access | Allow only the exact workflow / action required. |
| 7. Adaptive Access | Increase friction only when context, risk, or evidence requires it. |
| 8. Session-Level Enforcement | A valid SSO session is not enough; evaluate the active session and action. |
| 9. Microsegmentation | Keep trust zones small: tenant, device, app, workflow, local authority, action. |
| 10. Identity as Perimeter | Identity, device, and workload identity matter more than network location alone. |
| 11. Full Telemetry | Preserve logs, evidence, source references, decision inputs, and audit chains. |
| 12. Automated Response | Automate evaluation and routing; keep high-risk execution governed and approval-gated. |

### 3.2 SignalGrid's operational form

Twelve rules in the vocabulary of a decision, each with its enforcement status.

| # | Rule | Status | Where |
| --- | --- | --- | --- |
| 1 | Every affirmative must be earned. | **PROVEN** | Positive control + 6 single-axis degradations + a 32-combination sweep. |
| 2 | Missing evidence cannot become allow. | **PROVEN** | `deriveCriticalSignalsPresent`; brute-forced — *no* combination with a gap reaches allow. |
| 3 | Stale evidence cannot become fresh. | **PROVEN** | Stale posture cannot allow a critical workflow. |
| 4 | A valid login is not a valid workflow. | **PROVEN** | An enabled identity with the device channel unknown does not allow. |
| 5 | A valid role is not valid context. | **STRUCTURAL** | The decision contract has *no* role/group/entitlement field. Asserted over the field set. |
| 6 | A valid device posture is not root cause. | **DOCTRINE** | See §6 — status vs diagnosis. |
| 7 | A managed device is not necessarily locally authoritative. | **PROVEN (bounded)** | A *blinded* custody channel cannot be outvoted by compliance. The bound is stated in §7. |
| 8 | A source-system result is not a verified outcome. | **DOCTRINE** | See §10 — advisory, then verified. |
| 9 | Contradictory sources must stay contradictory. | **PROVEN** | A confirmed tamper is not washed out by otherwise-healthy evidence. |
| 10 | Every decision must cite policy version and signal evidence. | **PROVEN** | Every evaluation carries a version, reasons, and per-rule attribution. |
| 11 | Every routed action must be verified after execution. | **DOCTRINE** | Deferred — see §12. |
| 12 | AI may recommend; deterministic policy decides. | **PROVEN** | Every proposal is approval-required and simulated-only; there is no executed status. |

### 3.3 The correction to the poster

The usual phrasing is *"Verify explicitly — every request, every time, no exceptions."*
The "no exceptions" clause is where real deployments quietly break, because emergencies
happen and something has to give. The production wording SignalGrid uses:

> Every request must be evaluated. Emergency and break-glass paths are **not exceptions**
> to Zero Trust; they are **special policies with stronger evidence, expiration,
> ownership, and audit**.

Break-glass must never mean *skip Zero Trust*. It means:

- a **verified** emergency,
- an **approved owner**,
- a **bounded duration**,
- a **strong audit** record,
- and **post-event reconciliation**.

A break-glass path modelled as an exception is an unauthenticated back door with a
polite name. Modelled as a policy, it is the only kind of emergency access that survives
an assessor.

**What exists today**, so the gap is exact rather than implied: the `break-glass`
connector family (`pnpm run proof:break-glass`) grades whether an override was
*accountable* — justification recorded / absent / unreadable, scope single-encounter vs
broad, expiry, review. Its ceiling is `alert`, deliberately lower than every other
family: it can never restrict, deny, or step up, because adding friction to emergency
care is a clinical-safety harm and the host application owns domain safety under the
embedded-UX law. So break-glass is **graded after the fact today**, and **not yet a
policy type that gates the override at invocation time**. §12 carries the difference.

---

## 4. RBAC + ABAC + the runtime decision

Three different questions, routinely collapsed into one:

```text
RBAC decides whether the caller has authority.
ABAC decides whether the current context is acceptable.
SignalGrid combines both into allow / step-up / restrict / deny.
```

**A role cannot loosen a SignalGrid decision, and this is structural rather than
disciplined.** `DecisionEvidence` — the *entire* input to the decision core — carries
observed state and nothing else: identity enablement, device management/compliance/
encryption, posture freshness, workflow risk tier, custody, dock, tamper, badge,
baseline. There is no role, no group, no entitlement, no permission field. A privileged
role therefore cannot raise an outcome, because there is nothing for it to raise.

The proof asserts this over the field set rather than by example, so adding an authority
field later turns it red.

Roles still matter — they authorise the **API call** that asks for a decision. They do
not authorise the **workflow**.

---

## 5. SSO / MFA / token / credential implications

Three layers people conflate constantly:

```text
SSO  = access continuity / session sharing and federation.
MFA  = identity assurance at the moment of verification.
SignalGrid = runtime trust decision for this workflow, right now.
```

SSO answers *"how can one verified login be reused across many applications?"* MFA
answers *"how strongly did we verify the person during login or step-up?"* Neither
answers *"should this action proceed on this device at this moment?"*

Zero Trust requires the SSO session to be **continuously evaluated, not trusted
forever** — which is precisely why an authenticated identity alone reaching `allow` is a
proof failure and not a feature.

Credential classes carry different weight, and the doctrine is that the *class* is
evidence, not authority:

```text
OAuth / OIDC proves delegated identity and authorization.
JWT carries claims.
API keys identify simple clients.
SignalGrid verifies whether that credential class is strong enough for this action.
```

---

## 6. Device posture vs diagnostic evidence

> **Portal state is not root cause.**

Intune can report `failed`, `nonCompliant`, or `pending`. Every one of those is a
*status*. None of them is a *diagnosis*. A management portal reporting "failed" tells you
that a thing did not succeed; it does not tell you whether device logs or diagnostics
were ever collected to establish **why**.

SignalGrid must preserve that distinction and never present a status as an explanation.
This is the same law the repo enforces elsewhere as the absent-collection rule —
*nothing observed ≠ nothing wrong* (`pnpm run proof:absent-collection`).

Forbidden inferences, stated as prohibitions because each one has a natural pull toward
it:

```text
Graph configured        ≠  healthy
token acquired          ≠  device trustworthy
Intune compliance       ≠  full local authority
nothing reported        ≠  nothing wrong
a status                ≠  a diagnosis
```

---

## 7. Local authority and offline constraints

> **A compliant device is not locally authoritative unless the required local path
> works.**

Local authority is a separate question from device trust, and it has its own inputs:

```text
first unlock
Wi-Fi / cellular availability
Apple Local Network permission
local discovery probe
offline lease
lost/stolen state
device reboot state
```

### The bound, stated plainly

The proof distinguishes two facts that a single "unknown" would collapse:

- **No custody channel exists** → `unknown`. This is what every tenant without a
  DockBridge reports. The decision never claimed local authority, so there is nothing to
  fail closed on. Device trust alone allows, and **that decision does not assert local
  authority**. This boundary is pinned by an affirmative assertion, so it cannot drift
  silently: if absent custody is ever made to fail closed, the proof goes red and this
  section has to be changed on purpose.
- **A custody channel exists and cannot vouch** → `offline`, `faulted`,
  `sensor_unavailable`, `removed`. Here the grid was supposed to know and does not.
  `allow` is unreachable however good compliance is — **PROVEN** across all four
  channels.

The first bullet is an honest scope limit, not a safe default. Under this repo's own
standard — a grant requires positive confirmation of every input — an absent custody
channel is a gap we have chosen to accept because a rule on it would step up every
device in every dockless fleet forever. Calling it "fail-safe" would be false. The same
reasoning, and the same admission, is already recorded on `BatteryHealthState` in
`lib/signalgrid-core/src/types.ts`.

---

## 8. Session-level re-evaluation

A decision is a statement about a moment, not a lease. The design commitments:

- Evidence freshness is an **input**, not metadata: `stale` and `expired` posture route
  to step-up; `missing` and `unknown` route to restrict. **PROVEN.**
- Raising the workflow risk tier never **loosens** an outcome. Monotonicity is asserted
  across all three tiers rather than at a single point. **PROVEN.**
- A step-up must be **answerable**. A non-allow decision either carries a served path
  that genuinely reaches `allow` when satisfied, or it is honestly routed to a human.
  A step-up nobody can answer is a denial with extra steps, and presenting it as a
  self-service fix is worse than denying. **PROVEN**, with a negative control so the
  assertion cannot pass by the engine simply always claiming resolvability.

**Not established:** continuous verification over real elapsed time. The proof shows a
stale signal cannot allow. It does not run a session for an hour. That distinction is
printed by the proof itself.

---

## 9. Telemetry, evidence, and audit requirements

Every decision must be reconstructable by someone who was not there:

- a **policy version id and number**, on every evaluation — **PROVEN**;
- **reason codes**, always non-empty; a suppressed allow is *named*
  (`ALLOW_SUPPRESSED_DEGRADED_EVIDENCE`) rather than silently downgraded — **PROVEN**;
- **per-rule attribution** — every firing rule carries its rule id and reason code, so
  evidence is traceable rather than summarised — **PROVEN**;
- an **evidence snapshot** with source references and a content digest
  (`buildSnapshot` / `verifySnapshot`);
- an **append-only audit ledger** whose chain is verifiable end to end
  (`pnpm run proof:audit-ledger`).

### On the `ZERO_TRUST_*` vocabulary

Fifteen `ZERO_TRUST_*` reason codes were proposed alongside this doctrine
(`ZERO_TRUST_CONTEXT_INCOMPLETE`, `ZERO_TRUST_SIGNAL_STALE`, and so on). They are **not
minted as wire values**, for a reason that is itself a Zero Trust argument: a reason code
that no rule emits is a string that looks like evidence and is not. Fifteen of them would
be fifteen claims in the operator UI and the assessor package that nothing in the engine
can produce — and adding rules to emit them *is* new product scope, which the launch
spine explicitly excludes.

They are useful as a **principle-level rollup vocabulary** — a way to group the codes the
core already emits when explaining a decision to an assessor. Used that way they map onto
real values:

| Rollup concept | Emitted by the core today |
| --- | --- |
| Context incomplete | `POSTURE_MISSING`, `IDENTITY_STATE_UNKNOWN`, `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` |
| Signal stale | `POSTURE_STALE` |
| Source unverified | `DOCK_OFFLINE`, `DOCK_FAULTED`, `TAMPER_SENSOR_UNAVAILABLE` |
| Evidence contradictory | `TAMPER_CONFIRMED`, `TAMPER_SUSPECTED` |
| Step-up required | `NO_RULE_MATCHED_DEFAULT_STEP_UP`, `ENCRYPTION_REQUIRED_FOR_WORKFLOW` |
| Local authority unavailable | `CUSTODY_EXCEPTION`, `CUSTODY_OVERDUE`, `BADGE_REMOVED`, `BADGE_FORCED_REMOVAL` |
| Untrusted device for scope | `CRITICAL_WORKFLOW_UNTRUSTED_DEVICE`, `DEVICE_UNMANAGED`, `DEVICE_NONCOMPLIANT` |

If a future release needs `ZERO_TRUST_*` on the wire, the order is: **rule first, code
second, doc third.** Not the reverse.

---

## 10. Automated response boundaries

> Automate evaluation and routing. Keep execution governed.

**PROVEN**, at the contract level:

- Every remediation proposal is `approvalRequired: true` and `simulatedOnly: true`, with
  status `requires_approval`. **There is no executed status in the type, by design.**
- An `allow` decision produces no remediation at all — nothing is "responded to" that was
  not refused.
- A resolution simulation is a *preview*: it re-runs the policy against a transformed
  copy of immutable evidence and never mutates stored state.

Rule 12 — *AI may recommend; deterministic policy decides* — is not a slogan here. The
decision path contains no model, no clock read, and no randomness
(`pnpm run review:invariants` enforces this). A recommendation engine can propose; only
a versioned, deterministic policy decides.

Rule 8 — *a source-system result is not a verified outcome* — is **DOCTRINE**, not yet
proven: at Limited GA nothing is executed, so there is no executed outcome to verify.
That closes when §12's verification loop is built, and not before.

---

## 11. Limited GA implementation

Scope is unchanged by this document. The launch edge is declared as data in
`docs/LAUNCH_PROFILE.md` and enforced by `scripts/check-launch-profile.mjs`; the Limited
GA families remain:

```text
graph
device-management-health
local-authority
```

Each gets a Zero Trust rule governing how it must behave.

### Graph — *a Graph record is source evidence, not automatic truth*

Every Graph-sourced signal must carry:

```text
tenant
connector instance
permission set
last successful sync
source freshness
identity / device relationship
signal provenance
```

and must never fall back to a fixture in a customer profile. Related:
`docs/MICROSOFT_GRAPH_LIVE_SMOKE_TEST_RUNBOOK.md`, `pnpm run proof:graph-wire`.

### Device-management-health — *portal state is not root cause*

Preserve whether diagnostics were actually collected before claiming *why* something
failed. A `failed` status with no collected evidence is an unexplained failure, and must
be reported as one. See §6.

### Local-authority — *a compliant device is not locally authoritative unless the
required local path works*

The inputs listed in §7, with the bound in §7 stated wherever the claim appears. The
family is real and gated (`pnpm run proof:local-authority`); the bound is about what an
*absent* custody channel means, not about whether the family exists.

### Against the launch workstreams

| Workstream | Zero Trust requirement |
| --- | --- |
| Graph-backed transport | No fixture fallback in a customer profile; provenance on every signal; `Graph configured ≠ healthy`; `token acquired ≠ device trustworthy`. |
| Public / private boundary | Startup gates: a customer profile must not expose demo routes; the boundary is enforced by a gate (`check-publication-boundary.mjs`), not remembered. |
| Assessor package | Every decision in the package cites its policy version and evidence reference; the audit chain verifies end to end; advisory scope stated, not implied. |

---

## 12. Deferred future scope

Named here so the boundary is explicit rather than discovered by a customer.

- **Post-execution verification (rule 11).** Every routed action verified after
  execution. Requires an execution path; at Limited GA there is none. **DOCTRINE.**
- **Continuous session re-evaluation over elapsed time.** Freshness is enforced as an
  input today; a long-running session that degrades mid-flight and is re-decided is not.
- **Break-glass as a first-class policy.** §3.3 states the correct model, and names
  what the `break-glass` family already grades. What does not exist is break-glass as a
  *policy type* — bounded duration and owner approval enforced at invocation rather than
  graded afterwards. That is deliberate while the family's ceiling stays `alert`.
- **`ZERO_TRUST_*` wire codes.** §9: rule first, code second, doc third.
- **Enforcement.** SignalGrid is the Policy Engine. Whether a PEP honours a decision is
  outside every proof in this repository, and no green run should be read as evidence
  that it did.

---

## Running the gate

```bash
pnpm run proof:zero-trust-principles
```

It prints, on every run, what a green does **not** establish. If a principle above stops
holding, that run goes red on the commit that broke it — which is the entire reason this
document has a proof attached rather than a changelog.

Related: `docs/LAUNCH_PROFILE.md`, `docs/CI_AND_VALIDATION.md`,
`docs/PRODUCT_CORE_THREAT_MODEL.md`, `docs/SECURITY_CONTROLS_MATRIX.md`,
`docs/REALISTIC_LAUNCH_PLAN.md`.
