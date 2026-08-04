# SignalGrid Cloud Platform, Cyber Resilience and Operational Trust Architecture

Three models answer three different questions. They are not competitors and none
replaces the others.

| Model | Primary question |
| --- | --- |
| Cloud platform engineering (AWS landing zone, golden paths) | How do we provide a secure, repeatable, governed foundation for teams and workloads? |
| Cybersecurity control and resilience (NIST CSF 2.0) | How do we govern, identify, protect, detect, respond, recover and improve? |
| **SignalGrid operational trust** | **Should this actor perform this action on this resource in this workflow and context *right now*?** |

> Platform engineering makes the safe path easy.
> Observability explains the state of that path.
> Cybersecurity makes unsafe conditions visible and containable.
> SignalGrid decides whether the current actor and action may use the path now —
> and verifies the outcome.

---

## Read this first: what this repository actually implements

This document describes a **ten-layer architecture**. This repository implements
the bottom half of it. The top is the environment SignalGrid *consumes and refers
to* — not something SignalGrid provides, and not something built here.

Stating that plainly at the top is deliberate. An architecture diagram is the
easiest place in a company to imply capability you do not have, because every box
looks equally real. The canonical inventory of shipped behaviour is
[`WHAT_SIGNALGRID_DOES_TODAY.md`](WHAT_SIGNALGRID_DOES_TODAY.md), whose rule this
page is bound by: *never present a design intention as a shipped capability*.

| # | Layer | Status in this repo |
| --- | --- | --- |
| 1 | Business and workflow context | **BUILT** — workflow keys, risk tiers, criticality, actor/device/agent context feed every evaluation |
| 2 | Cloud landing-zone foundation | **NOT BUILT** — assumed. No Organizations/OU/account model, no network topology, no AWS provisioning exists here |
| 3 | Platform-engineering control plane | **PARTIAL** — declarative config + GitOps + governed plan/approve/apply exist ([`IAC_GITOPS.md`](IAC_GITOPS.md), `@workspace/iac`, `/cp/v1/iac`). No developer portal, no service catalog, no AWS pipelines |
| 4 | Cybersecurity control and resilience loop | **PARTIAL** — the repo *consumes* control-plane evidence through the read-only connector families enumerated by `scripts/check-connector-discipline.mjs` (it derives the count from the filesystem and prints it; an earlier hand count here said 49 by counting directories, one of which is `adapters` and not a family). It does not detect, scan, or run an IR process |
| 5 | Observability and evidence collection | **PARTIAL** — the repo grades a stream's own collection state, fidelity and staleness (`observability-integrity`) and consumes DEX readiness (`session-readiness`), and it computes SLOs and error budgets for the DECISION plane (`@workspace/reliability`). It runs no collector, stores no telemetry, and has no SLO plane for cloud workloads |
| 6 | Signal and evidence fabric | **BUILT** — normalization, provenance, freshness, contradiction detection, source and policy versioning |
| 7 | SignalGrid operational trust decision | **BUILT** — allow / step-up / restrict / deny, deterministic and fixture-backed |
| 8 | Governed execution | **PARTIAL BY DESIGN** — see [Governed execution](#8-governed-execution-adapters). Write actuators were deliberately deleted, not deferred |
| 9 | Verification, recovery and release | **PARTIAL** — teardown-proof, decision continuity across partitions, exception release. Not a general post-execution verifier |
| 10 | Governance and feedback | **PARTIAL** — audit ledger, policy versioning, simulation, recommendations, self-audit. No cost or SLO plane for cloud workloads |

Everything below is written against that table. Where a section describes
something unbuilt, it says so in the section.

---

## The stack

```
┌──────────────────────────────────────────────────────────────┐
│ 1. BUSINESS AND WORKFLOW CONTEXT                    BUILT    │
│ Service • application • owner • criticality • workflow       │
│ person • device • agent • location • requested action        │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. CLOUD LANDING-ZONE FOUNDATION                 NOT BUILT   │
│ Organizations • accounts • OUs • regions • network           │
│ identity • logging • audit • shared services • guardrails    │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. PLATFORM-ENGINEERING CONTROL PLANE              PARTIAL   │
│ Developer portal • service catalog • golden paths            │
│ IaC • CI/CD • GitOps • secrets • observability • tenancy     │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. CYBERSECURITY CONTROL AND RESILIENCE LOOP       PARTIAL   │
│ Exposure • identity • data • exploit risk • cloud            │
│ endpoint • AI • detection • response • recovery              │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. OBSERVABILITY AND EVIDENCE COLLECTION           PARTIAL   │
│ Traces • logs • metrics • events • incidents • pipelines     │
│ collection state • fidelity • sampling • staleness           │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. SIGNAL AND EVIDENCE FABRIC                        BUILT   │
│ Normalize • provenance • freshness • confidence              │
│ contradictions • ownership • policy and source versions      │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 7. SIGNALGRID OPERATIONAL TRUST DECISION             BUILT   │
│ ALLOW • STEP-UP • RESTRICT • DENY                            │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 8. GOVERNED EXECUTION                     PARTIAL BY DESIGN  │
│ AWS • CI/CD • IAM • UEM • EDR • ITSM • host app              │
│ communication • network • cloud • workflow systems           │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 9. VERIFICATION, RECOVERY AND RELEASE              PARTIAL   │
│ Confirm action • observe resulting state • rollback          │
│ restore workflow • re-evaluate trust • release restriction   │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 10. GOVERNANCE AND FEEDBACK                        PARTIAL   │
│ Audit • SLOs • cost • control effectiveness • lessons        │
│ recommendation • simulation • approval • policy versioning   │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. Cloud landing-zone foundation

**NOT BUILT HERE. Assumed.**

A multi-account landing zone — Organizations, organizational units, separated
production and staging, dedicated audit and log-archive accounts, network
topology, service control policies — is the boundary SignalGrid *reasons about*.
It is not a boundary SignalGrid *creates*.

The distinction matters commercially. SignalGrid does not compete with Control
Tower or a landing-zone accelerator, and any deck implying otherwise is selling
something this repository does not contain. What SignalGrid adds is the runtime
question the landing zone cannot answer on its own: *this account and this OU are
correct — but should this actor be changing this resource in it right now?*

**To be real, this layer needs:** an account/OU/environment model in the evidence
schema so a decision can test "is this resource in the authorized tenant,
account, environment and region?" Today the tenancy model is SignalGrid's own
(`tenantId`), not a cloud account graph.

## 2. Multi-account and tenant model

**PARTIAL.** SignalGrid enforces hard tenant isolation in its own plane —
cross-tenant evaluation is refused by design and proven, not asserted. That is
not the same as a cloud account model. Mapping `tenantId` onto AWS accounts and
OUs is unbuilt, and is the specific gap that would let layer 1 participate in a
decision rather than merely surround it.

## 3. Platform-engineering golden paths

**PARTIAL.** [`IAC_GITOPS.md`](IAC_GITOPS.md) describes what exists: declarative
desired state, a plan, a governed approval, and a simulated apply — a rollout
cannot apply itself. `@workspace/iac` and `/cp/v1/iac` are the surfaces.

What does not exist: a developer portal, a service catalog, reusable AWS
building blocks, or CI/CD pipelines that provision cloud infrastructure. The
"golden path" here is a *config* golden path, not a *cloud provisioning* one.

## 4. Developer and agent self-service

**PARTIAL.** The agent side is the built side. Agent and non-human-identity
action governance is a real decision dimension: agent behaviour judgment,
OAuth-consent and workload identity, and token binding all participate in
evaluation. What is absent is the human developer-portal surface that would let
someone *request* a governed path and see the answer in their own workflow — the
worker-facing analogue exists (self-service resolution), the developer-facing one
does not.

## 5. Cybersecurity control domains

**PARTIAL, and the shape of the partiality is the point.** SignalGrid is a
*consumer* of control-plane evidence, not a producer of it. It does not scan for
vulnerabilities, detect threats, or run incident response. It reads the verdicts
of the systems that do — EDR/EPP threat state, identity risk, DLP posture,
credential exposure, CIS baseline alignment, device management health — and
converts them into an authorization outcome.

See [`SECURITY_CONTROLS_MATRIX.md`](SECURITY_CONTROLS_MATRIX.md) for which
controls are implemented versus private-core planned. Note in particular that
keyed cryptographic audit integrity is listed there as **private-core planned**,
not shipped.

## 6. Evidence normalization and provenance

**BUILT.** This is the layer that makes the rest defensible:

- every signal carries how it arrived (API / native / grid-collected / gap) and
  at what fidelity;
- freshness is graded, and a stale reading is not a current one;
- contradictions between sources are detected rather than averaged;
- the policy version and the core normalization version are stamped on the
  decision that used them;
- **an unknown or unreachable signal raises assurance, never lowers it.**

That last line is the invariant the whole product rests on, and it is enforced by
`pnpm run review:invariants` rather than by convention.

Related: [`SIGNAL_SOURCING.md`](SIGNAL_SOURCING.md), and
[`EVIDENCE_COVERAGE.md`](EVIDENCE_COVERAGE.md) — which reports, for a given
estate, which evidence axes it can answer, which are dark, and which are dark
*and* ungraded.

### The observability plane, and what its silence is worth

**PARTIAL.** Observability is the layer that explains *why* a system is in a
state; monitoring only reports *that* it is. SignalGrid consumes that explanation
and answers a different question with it — should this actor continue this
workflow while the system is in this state?

The distinction that earns this a decision dimension rather than a dashboard tile
is narrower than "we read telemetry", and it is worth stating exactly. Two failure
modes look identical from the outside:

| The system is healthy | Nobody was watching |
| --- | --- |
| No error was reported because none occurred | No error was reported because the exporter died, the span was sampled away, or the metric was dropped against a cost cap |

A fabric that cannot tell those apart will accept the second as the first for as
long as anyone keeps not reporting. `session-readiness` already covers the LOUD
version — a plane that is unreachable or was never instrumented. The quiet version
is `observability-integrity`: a stream that is up, current and healthy while
carrying one record in a hundred. It grades collection state, stream fidelity and
staleness against a caller-supplied reference instant, and exposes a single field
— `silenceIsEvidence` — that is true only when the stream is reporting at full
fidelity inside its own declared interval. Sampling is not treated as a defect; it
is treated as a limit on what silence can support. A 1%-sampled trace stream is
excellent evidence about aggregate latency and nearly none that a specific event
did not happen.

What is NOT built here: no collector, no agent, no storage, no query engine, no
SLO plane for cloud workloads, and no incident tooling. `@workspace/reliability`
computes SLOs and error budgets for **the decision plane itself** — not for the
services being observed. Collecting is the platform's job. Deciding what its
silence is worth is this one's.

The reference shapes are deliberately the open standards — OpenTelemetry for
generating and exporting traces, metrics and logs; Prometheus/OpenMetrics scrape
state for up-ness and interval — because those are specified in public and can be
implemented against without depending on any vendor's proprietary schema.

## 7. Operational trust decisions

**BUILT.** Deterministic, fixture-backed, no wall-clock or randomness in the
decision path. The outcome vocabulary is `allow` / `step_up` / `restrict` /
`deny`.

### The shipped decision contract

This is what `/v1/decisions/evaluate` actually returns
(`lib/signalgrid-core/src/types.ts`):

```ts
interface Decision {
  id, tenantId, identityId, deviceId, workflowId
  outcome: "allow" | "step_up" | "restrict" | "deny"
  policyId, policyVersionId, policyVersion
  matchedRules: MatchedRule[]
  reasonCodes: string[]
  signalIds: string[]
  evidenceSnapshotId: string
  requestContext, latencyMs, createdAt
  reviewStatus, reviewable, explanation
  coreNormalizationVersion?: number
}
```

### The target contract — NOT SHIPPED

A richer response shape has been proposed for the cloud/platform case:

```jsonc
{
  "outcome": "restrict",
  "reasonCodes": ["PUBLIC_DATABASE_EXPOSURE", "PRODUCTION_CHANGE_APPROVAL_MISSING",
                  "AI_AGENT_CRITICAL_ACTION_REQUIRES_HUMAN_APPROVAL"],
  "permittedActions":     ["generate-plan", "run-security-analysis", "request-approval"],
  "blockedActions":       ["apply-production-change"],
  "routeOwner":           "platform-engineering",
  "approvalOwners":       ["service-owner", "cloud-security"],
  "verificationRequired": ["private-network-placement", "change-approval-recorded",
                           "post-deployment-control-validation"]
}
```

**Five of those fields do not exist anywhere in the codebase today** —
`permittedActions`, `blockedActions`, `routeOwner`, `approvalOwners`,
`verificationRequired`. `outcome` and `reasonCodes` are real; the rest are a
design target.

The *concepts*, however, are already built one layer over. `@workspace/flows`
plans actions with an explicit disposition:

```ts
type ActionDisposition =
  "automated" | "admin_approval" | "dual_approval" | "user_override" | "held" | "blocked";

interface ActionPlan { key, label, approval, disposition, requiresApprovals, reason }
```

So "which actions are permitted, which are blocked, and who must approve" is
modelled — it is just not a field on `Decision`. Unifying the two is a real and
tractable piece of work, and it is the honest next step for this layer rather
than something to describe as done.

## 8. Governed execution adapters

**PARTIAL, AND DELIBERATELY SO.** SignalGrid is overwhelmingly read-only at the
wire. Write actuators that had been built — UEM device actions, NAC quarantine —
were **deleted**, not deferred, because an ungated actuator that can act on a
device is a larger liability than the capability is worth at this stage. Every
connector family is gated: without explicit live credentials it serves fixtures
and cannot reach a vendor API.

What "governed execution" means here today is therefore: the decision is
delivered to the system that owns the action (host app, ITSM, webhook, CAEP
session-signal emitter), and *that* system acts. SignalGrid does not reach into
AWS, IAM, UEM or EDR and change anything.

An architecture doc that showed layer 8 as a solid box would be describing a
product with a much larger blast radius than this one.

## 9. Verification and rollback

**PARTIAL.** What exists is narrower than the layer name:

- **teardown-proof** — a provisioning recording is not deploy-ready until its
  reversal is proven, step by step, in dependency order;
- **decision continuity** — which decision wins after a network partition, with
  offline authority unable to relax a stricter connected decision;
- **exception release** — a restriction lifts when the condition that caused it
  is observed to clear, not on a timer.

What does not exist is a general post-execution verifier that observes cloud
resource state after an apply and confirms the intended controls landed. That is
the `verificationRequired` field above, and it is unbuilt on both ends.

## 10. Resilience and outcome measurement

**PARTIAL.** SLO and error-budget modelling exists, with the deliberate stance
that fail-closed integrity has no error budget. Decision latency is benchmarked
as a pilot gate. Absent: cost allocation, FinOps tagging, and control-effectiveness
measurement across a cloud estate — all of which belong to layers 2–4 and none of
which this repo touches.

The AWS Well-Architected pillars — operational excellence, security, reliability,
performance efficiency, cost optimization, sustainability — are the right outcome
dimensions for the foundation. SignalGrid should **preserve them as context and
measurement dimensions rather than reinvent them**.

## 11. AI and automation governance

**BUILT, and among the strongest arguments for the whole model.** An AI agent
requesting a production change is exactly the case where a landing zone says
"correct account", a scanner says "no finding", and both are answering a question
nobody asked. The runtime question is whether *this* agent, with *this* identity
assurance, under *this* approval state, may take *this* action now.

Built dimensions: agent behaviour judgment, non-human identity action governance,
OAuth consent and workload identity, token binding (proof-of-possession versus
replayable bearer), and dual-control two-person integrity.

## 12. System-of-record boundaries

Non-negotiable, and the reason the model composes instead of colliding:

- The **IdP** remains authoritative for identity. SignalGrid reads it.
- The **MDM/UEM** remains authoritative for device state. SignalGrid reads it.
- The **EDR** remains authoritative for threat state. SignalGrid reads it.
- The **cloud provider** remains authoritative for what exists and who may touch
  it. SignalGrid reads it.
- The **host application** remains authoritative for domain safety — patient
  lookup, clinical guidelines, order entry. SignalGrid is invisible to the worker
  and returns only the gate.

SignalGrid owns exactly one thing: the runtime authorization decision, its
evidence, and the audit record of both.

## 13. First launch profile

The smallest honest slice that demonstrates the whole model, using only what is
built:

1. an estate declares its source planes and sees its coverage — including which
   axes are dark *and* ungraded ([`EVIDENCE_COVERAGE.md`](EVIDENCE_COVERAGE.md));
2. identity and device-management evidence normalizes into the fabric with
   provenance and freshness;
3. a workflow fires and the core returns allow / step-up / restrict / deny with
   reason codes, matched rules and a versioned evidence snapshot;
4. the decision reaches the host app, which owns the action;
5. the audit ledger records the decision, its evidence and its policy version.

Layers 2, 3 and 7 stay explicitly out of the first profile. They are the
expansion path, not the launch claim.

---

## Combined control-domain matrix

The left two columns describe systems SignalGrid does not build. The right column
is the runtime question it adds — and is marked for what exists today.

| Platform foundation | Cybersecurity control | SignalGrid runtime use | Today |
| --- | --- | --- | --- |
| Account and OU structure | Exposure and blast-radius control | Confirm the resource is in the authorized tenant/account/environment | tenant only |
| IAM, Identity Center, roles | Phishing-resistant MFA, privilege governance | Resolve actor, role, session assurance and step-up requirement | **built** |
| VPC, Transit Gateway, firewalls | Segmentation and lateral-movement defense | Confirm approved access path and network trust | not built |
| Service catalog and golden paths | Secure baseline enforcement | Confirm the requested resource follows an approved pattern | baseline built; catalog not |
| IaC and CI/CD | Supply-chain and configuration security | Evaluate who requested the change, what changes, and its risk | **built** (config plane) |
| Secrets management | Key and secret protection | Block actions involving stale, exposed or unauthorized credentials | **built** (credential exposure) |
| Logging and observability | Detection and incident reconstruction | Preserve source evidence and correlate active alerts | **built** |
| Backup and DR | Recovery and resilience | Require restore evidence before releasing a restriction | teardown-proof only |
| FinOps and tagging | Governance and ownership | Resolve cost owner, business owner and resource purpose | not built |
| Developer portal | Human-facing workflow | Present approved action, denial, remediation and evidence | worker yes; developer no |
| AI/agent platform | AI inventory and action governance | Restrict agent tools by identity, context, policy and approval | **built** |
| Platform metrics | Control-effectiveness measurement | Verify the decision and downstream action produced the intended result | partial |

---

## The merged end-to-end workflow

A developer, pipeline, or AI agent requests a production deployment. Steps marked
▲ are unbuilt in this repository today.

1. **Request received** — actor, repository, workload, target account ▲, change
2. **Context resolved** — tenant, business service, owner, environment ▲, criticality
3. **Platform path evaluated** ▲ — approved template? correct account and OU?
   approved region? valid pipeline? current module?
4. **Cybersecurity evidence evaluated** — identity assurance, privilege state,
   artifact provenance ▲, vulnerability state, cloud posture ▲, endpoint posture,
   secret state, active detections
5. **Operational context evaluated** — change window, incident state, service
   health, workflow impact, rollback readiness, second approver, consequence
6. **SignalGrid decision** — allow / step-up / restrict / deny
7. **Platform executes** ▲ — SignalGrid does not apply the change; the pipeline does
8. **SignalGrid verifies** ▲ — correct account, controls applied, logs available,
   no unexpected exposure
9. **Recovery if necessary** — rollback, restore, re-evaluate
10. **Feedback** — improve the path, improve the rule, version the policy, retain
    the audit record

Six of ten steps run today. Four need layers 2, 3 and 8 to exist. That ratio is
the roadmap, stated as a ratio rather than as a diagram in which every box looks
finished.

---

## Final judgment

They are not equal, and none should be discarded:

```
AWS landing zone and platform engineering  = foundation and paved roads
Cybersecurity control and resilience       = continuous protective loop
SignalGrid                                 = runtime trust, decision, routing,
                                             evidence, verification, recovery
```

The landing zone establishes the boundary. The platform provides the deployment
path. Cybersecurity identifies the unsafe state. **SignalGrid decides whether this
exact action may proceed now** — and, when layer 9 is real, whether it did what it
was supposed to.

---

*Companion documents:*
[`WHAT_SIGNALGRID_DOES_TODAY.md`](WHAT_SIGNALGRID_DOES_TODAY.md) (canonical
capability inventory) ·
[`PRODUCT_CORE_FOUNDATION.md`](PRODUCT_CORE_FOUNDATION.md) ·
[`IAC_GITOPS.md`](IAC_GITOPS.md) ·
[`SECURITY_CONTROLS_MATRIX.md`](SECURITY_CONTROLS_MATRIX.md) ·
[`SIGNAL_SOURCING.md`](SIGNAL_SOURCING.md) ·
[`EVIDENCE_COVERAGE.md`](EVIDENCE_COVERAGE.md) ·
[`EMBEDDED_UX_PRINCIPLE.md`](EMBEDDED_UX_PRINCIPLE.md)
