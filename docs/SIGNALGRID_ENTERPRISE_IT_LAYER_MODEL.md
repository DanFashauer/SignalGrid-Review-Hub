# SignalGrid Enterprise IT Layer Model

> **The IT stack creates signals. SignalGrid turns them into decisions.**

This is the container model. It does not replace the Zero Trust doctrine, the
federation model, the Graph/Intune evidence rules, local authority, GitOps, or the
observability plane — it says where each of them sits, and it answers the question that
actually costs people time:

> **When a workflow is refused, who fixes it?**

That question has a machine-checked answer for every reason code the decision core can
emit and every connector family in the repository. The answer lives in
`scripts/it-layer-model.mjs` and is enforced by `scripts/check-it-layer-model.mjs`.

---

## 1. Purpose

Most of the operational pain in a frontline estate is not "the system said no." It is
**not knowing whose problem the no is.** A worker is stopped, a supervisor calls the
help desk, the help desk calls endpoint engineering, endpoint engineering says the
device is compliant and points at identity, identity says the account is fine and points
back at the device. Nobody is wrong. Nobody has the whole picture. The person at the
bedside or the pick face is still stopped.

SignalGrid's decision already contains the answer — the reason code names the exact
input that failed. What was missing was the mapping from that code to a **layer of IT**
and an **owner**. This model supplies it, in data, gated for completeness.

The intended effect is that using SignalGrid requires no new expertise. An admin does
not need to learn a taxonomy, and a worker never sees one. The routing is second nature
because it is computed, not remembered.

---

## 2. Source IT layer taxonomy

Seven layers, twenty-eight domains, recorded verbatim so a later edit is visibly an
edit. This is the industry-standard IT operating stack, not a SignalGrid invention.

| Layer | Domains |
| --- | --- |
| Strategic IT Management | Governance & Oversight · IT Strategy & Planning · IT Policies & Standards · IT Governance |
| IT Infrastructure | Network Management · Server & Storage Management · Cloud Computing · Data Center Operations |
| IT Security & Risk Management | Cybersecurity · Threat Detection & Response · Identity & Access Management · IT Risk Assessment |
| Software Development & Applications | Application Development · Software Testing & QA · Enterprise Applications · DevOps & Automation |
| IT Service Development & Applications | Service Design · Service Transition · Service Catalog Management · Service Lifecycle Management |
| IT Service Management | IT Helpdesk & Support · Incident & Problem Management · IT Service Desk · Service Quality & Metrics |
| IT Operations | IT Monitoring & Maintenance · Backup & Disaster Recovery · IT Asset Management · IT Automation & Scripting |

The domain list is **closed** in the data: every classified entry must name a domain
belonging to its own layer, so "IT Operations / whatever sounded right" cannot happen.

---

## 3. SignalGrid's cross-layer role

SignalGrid is not a layer. It is the thing that reads across them.

> **Every IT layer holds partial truth. SignalGrid decides what the combined truth
> means for the workflow happening right now.**

Concretely, at decision time:

```text
IAM says              the user is valid.
Intune says           the device is compliant.
Local authority says  the device cannot safely act offline.
ITSM says             there is an open Sev1 on this service.
Observability says    the service is degraded.
Asset management says the device owner is unresolved.
GitOps says           desired state is stale.

SignalGrid decides    whether this workflow should continue —
                      and who owns the reason it should not.
```

None of those systems is wrong. None of them can answer the question on its own. That
gap is the product.

---

## 4. Layer-by-layer signal mapping

| Layer | What SignalGrid consumes | Typical decision impact |
| --- | --- | --- |
| Strategic IT Management | policy version, approved standards, change windows, governance exceptions | raise assurance, require approval, route governance review |
| IT Infrastructure | reachability, link usability, egress path, local/offline authority, geofence | allow, step-up, restrict, route infrastructure owner |
| IT Security & Risk Management | identity state, session binding, credential class, threat state, compliance, encryption, benchmarks | step-up, restrict, deny, route security or identity owner |
| Software Development & Applications | app version currency, app health, session readiness, business-system state | restrict a risky workflow, verify app readiness |
| IT Service Development & Applications | service lifecycle state, account plane vs service plane | route the correct service owner, block an unsupported path |
| IT Service Management | incident/problem state, alert response accountability | route, escalate, require incident linkage |
| IT Operations | management-plane health, posture freshness, asset custody, dock and badge state, outbound emission | verify recovery, restrict on unproven state, route operations owner |

**Layer and owner are different axes, and conflating them is the mistake this model
exists to prevent.** `DEVICE_NONCOMPLIANT` is a *security* question — it belongs to IT
Security & Risk Management — but the people who fix it are the *endpoint* team. Force
one answer and you either route security questions to the wrong desk or file endpoint
work under the wrong layer. Both are how tickets die.

The sharpest illustration in the data is a neighbouring pair:

| Reason code | Layer | Owner |
| --- | --- | --- |
| `BADGE_REMOVED` | Identity & Access Management | facilities operations |
| `BADGE_FORCED_REMOVAL` | Threat Detection & Response | security operations |

A badge withdrawn is a custody event. A badge torn out is a duress event. Same hardware,
same sensor, different desk, different urgency — and the model routes them apart.

---

## 5. System-of-record boundaries

Every classified entry carries a **system of record** and an **evidence type**, because
"who owns it" is not actionable without "where the answer lives." SignalGrid originates
none of these facts. It is a Policy Engine (NIST SP 800-207), not a source of truth —
see `SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md` §2.

The nine owner roles are closed. There is no catch-all, because a catch-all owner is the
same thing as no owner:

```text
it_governance_owner            policy, standards, risk acceptance, exceptions
network_infrastructure_owner   network, connectivity, egress, local-network reachability
identity_platform_owner        IdP, directory, federation, credential lifecycle
security_operations_owner      threat detection, response, security incidents, benchmarks
endpoint_operations_owner      MDM/UEM, compliance, posture reporting, baselines
application_owner              the host or enterprise application and its authorization
service_owner                  service design, transition and lifecycle
service_desk_owner             incident, problem, request routing, response accountability
facilities_operations_owner    physical custody: docks, cases, badges, asset location
```

`facilities_operations_owner` exists because docks, cases and badge readers are usually
not the endpoint team's estate. Routing a tampered dock to endpoint operations is how it
sits untouched for a week.

---

## 6. Decision impact model

**Decision impact is read from the rule set, never declared here.**

This is the single most important design choice in the model, and it is a deliberate
departure from the schema that prompted it. The obvious design gives every entry a
`decisionImpact` field. That creates a second source of truth for a fact
`lib/signalgrid-core/src/policy.ts` already states — and the copy is wrong the first time
somebody changes a rule's outcome without editing this model. A pinned value nothing
computes goes stale silently.

So the gate derives it. Run it for the current distribution across `allow` / `step_up` /
`restrict` / `deny`:

```bash
node scripts/check-it-layer-model.mjs
```

The derivation understands both rule forms, and getting that right mattered: the V2
draft policy overrides some reason codes by spreading the V1 rule, and **two of those
overrides inherit their outcome rather than restating it.** The first parser missed
exactly those two and reported them as classified-but-never-emitted — a confident,
precise, wrong answer whose "fix" would have been deleting two correct rows. It was
caught only because the completeness check runs in **both** directions; a one-way check
would have passed. Both cases now carry named regression controls in the gate's
`--self-test`.

---

## 7. Launch scope

**This model does not expand Limited GA.** The launch families are unchanged:

```text
graph
device-management-health
local-authority
```

What the model adds is where they sit and who owns them:

| Launch family | Layer | Owner | Question it answers |
| --- | --- | --- | --- |
| `graph` | IT Security & Risk Management / Identity & Access Management | identity platform | Who is this, and what does Microsoft say about their device? |
| `device-management-health` | IT Operations / IT Monitoring & Maintenance | endpoint operations | Is that management answer *current*, or merely present? |
| `local-authority` | IT Infrastructure / Network Management | network infrastructure | Can this device safely act in its local and offline context right now? |

Three families, three different layers, three different owners. That is the cross-layer
claim in its smallest honest form — and it is why the Limited GA scope is defensible
rather than arbitrary: it is not one system's data, it is the minimum set that requires
reading across layers at all.

The launch/deferred/demo_only/internal status of every surface stays in
`docs/LAUNCH_PROFILE.md`. This model deliberately does **not** duplicate it — one fact,
one home.

---

## 8. Deferred expansion scope

Named so the boundary is explicit rather than discovered by a customer.

- **Owner routing is not on the wire.** The model classifies; no `/v1` response carries
  the owner or layer yet. An operator still reads the reason code and decides who to
  call. Closing this is real value and real API surface, and it is held outside the
  launch spine's freeze. Recorded as a gap in the data, not implied by silence.
- **Coverage is uneven, and the gate says so.** Every layer has at least one family,
  which is not the same as every layer being well served: Service Development has one,
  Strategic IT Management has two, Security has more than twenty. The model's real value
  here is showing where SignalGrid is thin.
- **Correctness is review, not gate.** A green run proves the classification is
  *complete* and *real*. Whether `BADGE_FORCED_REMOVAL` truly belongs to security
  operations rather than facilities is a judgement no script can check.
- **Per-tenant owner mapping.** The owner roles are archetypes. A real customer's org
  chart will not match them exactly, and mapping roles to actual teams and queues is
  tenant configuration that does not exist yet.

---

## 9. Relationship to the other doctrine documents

```text
Enterprise IT Layer Model                       ← this document (the container)
  ├─ Zero Trust Decision Principles             SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md
  ├─ SSO Evidence-First Troubleshooting         SIGNALGRID_SSO_EVIDENCE_FIRST_TROUBLESHOOTING.md
  ├─ Authentication & Credential Architecture   AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md
  ├─ Graph / Intune / device-management evidence
  ├─ Local authority and offline constraints
  ├─ Observability and response accountability
  ├─ GitOps / desired-state authority           IAC_GITOPS.md
  └─ Limited GA launch profile                  LAUNCH_PROFILE.md
```

| Thread | Where it sits |
| --- | --- |
| Zero Trust 12 principles | IT Security & Risk Management as a home; a control philosophy across all seven |
| RBAC vs ABAC | Identity & Access Management |
| SAML / OIDC federation | Identity & Access Management |
| SSO first-relevant-divergence | IAM plus IT Service Management (the troubleshooting loop) |
| OAuth / JWT / API keys | Identity & Access Management |
| Intune logs and portal state | IT Operations + IT Service Management |
| GitOps / desired state | DevOps & Automation + IT Operations |
| KRIs and risk trend | Strategic IT Management + Service Quality & Metrics |
| Observability plane | IT Monitoring & Maintenance |
| Local network / offline authority | IT Infrastructure |
| Asset and custody | IT Asset Management |

---

## Running the gate

```bash
node scripts/check-it-layer-model.mjs             # completeness, both directions
node scripts/check-it-layer-model.mjs --self-test # the controls that prove it can fail
```

A new connector family, or a new rule with a new reason code, **fails this gate until a
human classifies it**. That is the point: the model cannot quietly fall behind the
product, and the freeze on breadth gets one more mechanical guard rather than one more
promise.
