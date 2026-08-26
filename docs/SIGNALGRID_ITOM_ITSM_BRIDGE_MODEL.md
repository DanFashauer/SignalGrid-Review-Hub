# SignalGrid ITOM / ITSM Bridge Model

> **ITOM says what is broken. ITSM says who owns it. SignalGrid decides what can
> safely continue.**

The two planes enterprise operations keeps collapsing into one. **ITSM** governs
service ownership, workflow and experience. **ITOM** governs infrastructure state,
observability and resilience. Neither answers the question SignalGrid exists for:
*does the active user's workflow remain safe while this event or incident exists?*

Nested under the [Enterprise IT Layer Model](SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md),
beside the [ITSM Layer Model](SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md).

Enforced by `scripts/src/itom-itsm-bridge-proof.ts` (`pnpm run
proof:itom-itsm-bridge`). Claims are tagged **PROVEN** (asserted against the
shipped engine or source), **STRUCTURAL** (guaranteed by a gate, type, or absence),
**DERIVED** (computed from evidence that already exists), **SPECIFICATION**
(written for a future build, deliberately not product vocabulary today), or
**DOCTRINE**.

Related: [Zero Trust Decision Principles](SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md)
· [KPI / KRI / KCI Model](SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md)
· [Security Operations Evidence Fabric](SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md)
· [Municipal Critical Services Resilience](SIGNALGRID_MUNICIPAL_CRITICAL_SERVICES_RESILIENCE_MODEL.md)

---

## 1. Purpose

**DOCTRINE.** A technical alert is not automatically a service decision. A service
ticket is not automatically proof of recovery.

An ITOM plane reports *network latency high, endpoint check-in stale, dependency
degraded, capacity breached*. An ITSM plane reports *incident opened, owner
assigned, SLA running, change approved*. Both can be entirely correct while the
question that matters goes unasked: **the nurse is holding the tablet right now —
can this medication order proceed?**

SignalGrid is the bridge. It reads operational state from ITOM and service
ownership from ITSM, and decides what the *current* workflow may do — then demands
evidence of recovery before the restriction lifts.

## 2. ITSM taxonomy (from source)

**DERIVED** — the source structure, mapped to what ships.

| ITSM group | Elements | SignalGrid surface |
|---|---|---|
| **Service Governance** | Business Alignment · Service Levels · Service Ownership | The row-67 ownership gate: every emitted reason code carries a named owner or the build fails (§5, PROVEN) |
| **Service Workflows** | Incident · Request · Problem · Change Enablement · Knowledge | Object type **derived** from resolution descriptors (ITSM layer model); `change-window` grades whether a change is permitted now; `itsm` is a gated read-only/emitter family |
| **Service Experience** | User Support · Experience Management · Continual Improvement | The embedded-UX law puts all worker-facing experience in the HOST app; SignalGrid contributes the resolution path and the named owner |
| **Outcomes** | Business Value · User Experience · Service Quality | Indicator layer — governed by the KPI/KRI/KCI law (§11) |

## 3. ITOM taxonomy (from source)

**DERIVED.**

| ITOM group | Elements | SignalGrid surface |
|---|---|---|
| **Infrastructure Operations** | Compute & Cloud · Network Operations · Capacity Management | `network-nac`/`nac`, `ot-posture`; capacity is a **consumed** figure, not one SignalGrid computes |
| **Observability & AIOps** | Unified Telemetry · Event Correlation · Agentic Automation · Automated Remediation · Noise Classification | `observability-integrity` (*is the plane that would tell you even working*), `telemetry`/`siem`/`syslog` emitters, `agent-identity` + `agent-behavior` for agentic action, `response-accountability` for remediation truthfulness |
| **Resilience Engineering** | Dependency Mapping · Availability Management · Resilience Testing | Flow situations + worst-concern-wins composition; `service-lifecycle`; recovery verification per §10 |
| **Outcomes** | Service Health · Operational Efficiency · Digital Resilience | Indicator layer (§11) |

## 4. The bridge role

**DOCTRINE.** SignalGrid is neither plane and does not become either. It performs
five jobs at decision time: **decide · route · verify · recover · feed back.**

```
ITOM evidence ─┐
               ├─► SignalGrid decision (allow / step_up / restrict / deny)
ITSM context ──┘        │
                        ├─► route to the named owner
                        ├─► require recovery evidence before release
                        └─► emit the indicator feedback (KPI/KRI/KCI)
```

## 5. Service ownership and technical health — PROVEN

**PROVEN, and it settles one of the proposed codes.** The specification proposes
`ITSM_SERVICE_OWNER_UNRESOLVED`. Row 70 of the intake ledger already found this
**structurally unreachable**, and this document's proof re-asserts it mechanically:
`scripts/it-layer-model.mjs` assigns every emitted reason code an owner drawn from
a closed set of roles with no catch-all, and `check-it-layer-model.mjs` **fails the
build** when any code lacks one.

So a reason code meaning *"nobody owns this"* can never fire — not because the
condition is impossible in the world, but because it is impossible in the *engine*:
the unowned code would have failed the build before it could be emitted. Keeping it
in the catalog would put a string in the operator console that no rule can produce.
**That is the unearned affirmative in reverse, and it stays out.**

The honest residue: ownership of a *reason code* is proven; ownership of a
*business service* is caller-supplied context and is graded as present/absent, never
invented.

## 6. Event-to-decision lifecycle

**DOCTRINE.** The ordering that keeps the two planes from contaminating each other:

1. **Observe** — ITOM reports state. Unreadable or stale telemetry is `unknown`.
2. **Correlate** — events group into one concern. *Uncorrelated is not benign.*
3. **Decide** — the workflow is evaluated now, with worst-concern-wins composition.
4. **Route** — the refusal carries its owner and its ITSM object type.
5. **Verify** — recovery is asserted only on evidence, never on ticket state.
6. **Release** — the restriction lifts on verification, not on closure.
7. **Feed back** — the outcome becomes indicator input, which informs assurance and
   never manufactures a grant.

## 7. Incident / problem / change / request linkage

**DERIVED, not declared.** Which ITSM object carries a refusal is read from the
shipped resolution descriptors rather than restated in a second table — one source
cannot disagree with itself. Layer 1 (User/Interface) is asserted **empty**: the
host app owns everything the worker sees, so a reason code landing there is a gate
failure, not a feature.

**Framework-naming rule carries over verbatim:** SignalGrid *references* ITSM
vocabulary and ITOM concepts and claims conformance to neither. No ITIL-version
conformance claim is made.

## 8. Observability and AIOps evidence

**Partly shipped.** `observability-integrity` already grades the question AIOps
cannot ask about itself — *is the observability plane trustworthy right now*.
Telemetry coverage, correlation state, and noise classification are consumed as
caller-supplied evidence; SignalGrid does not compute them and does not compete
with the AIOps platform that does.

The rule that matters: **`uncorrelated` and `noisy` are not `healthy`.** An event
plane that cannot group its own signals has told you something about its
reliability, and that raises assurance.

## 9. Automated remediation boundary — the sharpest rule here

**STRUCTURAL.** Agentic automation and automated remediation are ITOM
*capabilities*. SignalGrid's job is to govern **whether they may act, in what
scope, under whose approval, and against what recovery evidence.**

Shipped today and load-bearing:

- Remediation in this repository is **approval-gated and simulated**. That is the
  feature, not a limitation.
- `agent-identity` restricts an ungoverned or standing-credential agent;
  `agent-behavior` grades the action's judgment (volume burst, first-seen target,
  absent provenance, broad blast radius).
- `dual-control` exists for two-person integrity where an action warrants it.

The bridge rule: **an AIOps recommendation with no approval owner and no defined
verification is not executed — it is routed.** High correlation confidence is a
reason to act *sooner*, never a reason to act *unapproved*.

## 10. Resilience and recovery verification

**DOCTRINE, with a shipped analogue.** A closed ticket is not a recovered service.
This is the **watermelon** shape from the KPI/KRI/KCI model applied to operations:
`response-accountability` already grades *claimed RESOLVED while the concern is
still present* as `falsely_resolved` → `alert`, deterministically.

Applied to the bridge: a restriction lifts on **re-evaluated evidence**, not on
incident closure; and a resilience test that has never run is `not_tested` —
distinct from `passed`, and never rendered as green.

## 11. KPI / KRI / KCI mapping

**SPECIFICATION**, governed by the [indicator law](SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md):
*an indicator informs assurance; it never creates a grant.* The source's outcome
rows are the natural indicator set — ITSM (SLA breach rate, change success,
knowledge coverage, owner coverage), ITOM (service health, availability,
correlation accuracy, noise rate, telemetry coverage, MTTR), and the bridge
indicators that only exist because the bridge exists:

- decision-to-incident linkage rate
- route-owner unresolved rate
- remediation verification failure rate
- **restriction released without recovery evidence** (a KCI — the control failing)
- incident closed without service-health verification
- AIOps recommendation blocked by missing approval

No indicator name is minted as a decision reason code (asserted by the proof).

## 12. Limited GA scope

**STRUCTURAL — the freeze holds.** No new connector family, no new catalog, no new
reason code. Launch families remain `graph`, `device-management-health`,
`local-authority`. The ~22 proposed `ITSM_*` / `ITOM_*` codes and
`SignalGridItomItsmContext` are **SPECIFICATION**, consistent with rows 68–73.

The minimum viable bridge for Limited GA is *attachment*, not integration: route
owner, service owner, an incident reference, verification-required, recovery state,
and a service-health signal. **No ServiceNow / Jira / Freshservice / AIOps write
integration** — the route may be manual or API-ready at first.

## 13. Deferred expansion

**SPECIFICATION.** Bidirectional ITSM write (open/update/close), live AIOps
ingestion, and automated remediation execution are deferred behind the breadth
freeze. When built, each follows connector discipline: gated from birth,
fixture-backed, proof-carrying, mutation-swept.

### Assessor-package additions (#220)

Eight minimum tests for an *ITOM/ITSM bridge evidence* section: (1) a restricted
decision carries a service owner or an unresolved-owner reason code; (2) a
technical health issue routes to the correct owner; (3) an incident can be linked
or represented; (4) a remediation request cannot be marked complete without
verification; (5) a recovered service is re-evaluated before release; (6) event
correlation state is stored separately from incident closure; (7) automated
remediation stays approval-gated; (8) missing dependency mapping raises assurance
for critical workflows.

---

*ITSM governs the service experience. ITOM governs operational health. SignalGrid
governs the trust decision between them.*
