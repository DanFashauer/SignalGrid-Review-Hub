# SignalGrid Municipal Critical Services Trust & Resilience Model

> **Municipal systems do not fail only because of hackers. They fail because
> evidence, ownership, access, vendors, data, dependencies, communications, and
> recovery are not connected. SignalGrid connects those realities into governed
> trust decisions.**

The public-sector vertical reading of the SignalGrid thesis, nested under the
[Enterprise IT Layer Model](SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md) as *Public
Sector / Municipal Operations*. It is doctrine over what already ships — the
connector families, the ownership gate, the reconciliation arm, and the indicator
model — read against the nineteen ways municipal critical services actually break.

Enforced by `scripts/src/municipal-resilience-proof.ts` (`pnpm run
proof:municipal-resilience`). Every claim below is tagged **PROVEN** (asserted
against the shipped engine or the shipped source), **STRUCTURAL** (guaranteed by a
type, a gate, or an absence in the code), **DERIVED** (computed from evidence that
already exists), **SPECIFICATION** (written for a future build, deliberately not
product vocabulary today), or **DOCTRINE** (a governance position).

Related: [Zero Trust Decision Principles](SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md)
· [Enterprise ITSM Layer Model](SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md)
· [Security Operations Evidence Fabric](SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md)
· [KPI / KRI / KCI Model](SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md)
· [Offline-First Sync Catalog](OFFLINE_FIRST_SYNC_CATALOG.md)
· [Asset Management & IT Governance API Catalog](inspiration/ASSET_MANAGEMENT_IT_GOVERNANCE_API_CATALOG.md)
· [Communications Systems API Catalog](inspiration/COMMUNICATIONS_SYSTEMS_API_CATALOG.md)

---

## 1. Purpose

**DOCTRINE.** Municipal risk is not just "cybersecurity." A city's critical
services fail through a *combined* breakdown: automation governance, vendor
access, procurement, data ownership, security standards, credentials,
accountability, interdependencies, legacy infrastructure, sensitive-data
protection, communications redundancy, data integrity, institutional knowledge,
AI/email threats, access workarounds, and underused technology.

The core finding this model carries:

> Municipal systems fail when no one can prove who owns the risk, which system is
> authoritative, which data is accurate, which vendor still has access, which
> service depends on what, and whether recovery will work when essential public
> services are disrupted.

**The vulnerability is often not one broken system. The vulnerability is the
missing proof chain across systems, people, vendors, data, services, and
ownership.** Turning that missing chain into structured evidence and governed
decisions is precisely what SignalGrid is for — this document maps the municipal
failure modes onto the surfaces that already exist and marks honestly what does
not.

## 2. Municipal vulnerability taxonomy

**DERIVED** — nineteen themes, each mapped to its covering surface or named as a
gap. Where a shipped connector family is named, the proof asserts the family
still exists in `lib/integrations/src/integrations/`; the mapping cannot
silently rot.

| # | Theme | Failure mode | SignalGrid surface (today) |
|---|---|---|---|
| 1 | Automation overreach | Bad rules, stale data, or unchecked AI deny permits, misroute services, flag residents unfairly | `agent-identity` + `agent-behavior` grade WHO acts and the action's judgment; `dual-control` for two-person integrity; the recommendations engine is *reviewable suggestions only* by design |
| 2 | Unmonitored vendor access | A compromised privileged vendor cascades into critical infrastructure | `access-governance` (JML standing), `entitlement-binding`, `oauth-consent`, `link-usability` |
| 3 | Flawed procurement | Cheapest compliant bids ship unsupported, unpatched exposure | Program-owned (out of decision scope); the *result* is graded: `app-update` currency, `benchmark-selection` applicability, `vuln-scan` |
| 4 | Fragmented data ownership | Departments hold partial records; nobody owns reconciled truth | The IT-layer ownership gate: every emitted reason code carries a named owner or the build fails; the `/v1` decision-reconciliation arm |
| 5 | Inconsistent standards across departments | Attackers need only the weakest department | `benchmark-selection` + `policy-binding` (incl. the enforcement axis: report-only is not enforced), `uem` |
| 6 | Weak credentials on critical systems | Weak/shared/default credentials on internet-exposed OT threaten water and utilities | `credential-exposure`, `credential-rotation`, `bootstrap-credential` (one-time, shortest-practical), `ot-posture` |
| 7 | Cyber isolated inside IT | Attacks disrupt transport, utilities, healthcare — not just IT | The [ITSM layer model](SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md) routes every refusal to a service owner, derived from resolution descriptors, not declared |
| 8 | Unmanaged interdependencies | Upstream/downstream failures break public services | `@workspace/flows` situations + the grid-coverage model; worst-concern-wins composition |
| 9 | Unpatched legacy systems | Unsupported, poorly segmented systems enable ransomware | `vuln-scan`, `app-update`, `baselineCompliance`; the decision impact is *restrict administrative change, allow operationally necessary work* — the legacy estate is graded, never condemned (the row-21 law) |
| 10 | Aging energy infrastructure | Physical infrastructure decay is long-term resilience risk | `ot-posture` covers the observable posture; physical asset state beyond it is **out of scope** — an engineering-plane fact SignalGrid reads only when a system of record reports it |
| 11 | Unclear accountability | No single person owns the risk | **PROVEN mechanically**: `scripts/check-it-layer-model.mjs` fails the build when any emitted reason code lacks an owner (nine closed roles, no catch-all) |
| 12 | Inadequate sensitive-data protection | Outdated backup/storage exposes citizen data | `data-protection`, `store-scope`; immutable-backup evidence is SPECIFICATION (§12) |
| 13 | No communications redundancy | An M365 or data-center outage breaks municipal communications | The [Communications Systems API Catalog](inspiration/COMMUNICATIONS_SYSTEMS_API_CATALOG.md) (intake row 47), `carrier`, `observability-integrity`; the `local-authority` family answers what a shared device may do when the cloud plane is unreachable |
| 14 | Unreliable data across platforms | Reconciliation gaps deny benefits, misroute residents | The decision-reconciliation `/v1` arm (intake row 51): contradiction between systems is a first-class state, and its resolution is *manual adjudication*, never automated denial |
| 15 | Lost institutional knowledge | Retirements leave undocumented process dependencies | Human-owned (**out of scope** as a signal); `response-accountability`'s ownership axis grades the adjacent fact — an *unowned* concern is its own posture |
| 16 | Outdated vendor access privileges | Contractor remote credentials stay open for years | `credential-rotation`, `access-governance` leaver processing |
| 17 | Underused technology | Cities buy new tech while existing capability idles | **DERIVED today**: the coverage-gap report + `coverage.basis` — `projected_from_sourcing` vs `observed` IS the unused-capability gap, made visible per signal |
| 18 | AI-enhanced email threats | AI-crafted phishing/BEC bypass legacy defenses | `identity-risk` (sign-in risk), `edr-threat`; the email plane itself belongs to the email security stack — SignalGrid reads the resulting risk state |
| 19 | Insecure access workarounds | Access friction drives employees and responders to risky workarounds | The product thesis itself: `step_up` over block, `challenge-capability` (a step-up must be *answerable*), `break-glass` (the governed workaround that makes the insecure one unnecessary) |

## 3. Public-service ownership model

**DOCTRINE, with a PROVEN anchor.** A city is a federation of departments and
services — police, fire, EMS, water, power, transportation, public works,
permitting, benefits, public health, parks, finance, courts, records,
administration. **Do not treat "municipality" as one tenant with one risk
score.** Each service needs a service owner, data owner, risk owner, vendor
owner, criticality, dependency set, communications plan, recovery plan, and
citizen-impact profile. SignalGrid models trust at the service and workflow
level, not the organization level — which is already its shape: policies bind to
workflows, refusals route to owners, and the ownership gate (§2 row 11) is
mechanical, not aspirational.

## 4. Automation and AI accountability

**DOCTRINE over shipped surfaces.** An automated decision that affects a
resident needs evidence, a human accountability path, an appeal path, and fresh
data. The shipped analogues: `agent-identity` (an ungoverned or
standing-credential agent restricts), `agent-behavior` (volume burst, first-seen
target, absent provenance raise), `dual-control` (two-person integrity for
sensitive apply), and the recommendation engine's standing rule — *reviewable
suggestions only*. The municipal rule this composes into: **stale data + pending
automated denial → restrict the denial and require human review** — automation
may proceed toward grants of service only on evidence; refusals of service to a
resident deserve the same fail-closed skepticism the engine applies to grants of
access.

## 5. Vendor access governance

**DOCTRINE over shipped surfaces.** Vendor access must expire, be monitored, and
tie to an owner, contract, and purpose. Shipped: `access-governance` (joiner /
mover / leaver standing), `entitlement-binding`, `credential-rotation`,
`oauth-consent` (workload identity), `link-usability`. The municipal composition:
privileged vendor access + expired review + critical utility → step-up or deny
per policy, route the vendor owner *and* the service owner, and require the
review before continuing.

## 6. Procurement and lifecycle risk

**DOCTRINE.** Procurement is a program-plane activity SignalGrid does not sit
inside — but its *consequences* are exactly what the fabric grades: an
unsupported system is `app-update` non-currency, an unpatchable one is
`vuln-scan` exposure with `benchmark-selection` misfit. The honest boundary:
SignalGrid can make the cost of the cheapest-compliant bid *visible* in decision
outcomes; it cannot and should not sit in the tender process.

## 7. Data ownership, lineage and integrity

**DOCTRINE with PROVEN anchors.** Which data is authoritative is a question the
engine already refuses to shrug at: the reconciliation arm makes a cross-system
contradiction a first-class state, and the resolution path is manual
adjudication with the data-governance owner routed — never an automated denial
riding on contested data. Full lineage (source→transform→decision, per record)
is **SPECIFICATION**: named here for the future build, not claimed.

## 8. Department security standardization

**DERIVED.** Controls must be standardized *and measured* across departments.
The per-department cut of existing indicators (baseline coverage, patch
compliance, MFA coverage, logging coverage by department) is the KPI/KRI/KCI
model applied with a department dimension — the indicator law carries over
verbatim: a department's green scorecard raises nothing; it is a ceiling, and
the decision still reads direct evidence.

## 9. Critical infrastructure and OT credential risk

**DOCTRINE over shipped surfaces.** Weak, shared, or default credentials on
internet-exposed OT are the article's starkest scenario (water utilities).
Shipped: `ot-posture` (the OT/IIoT edge posture family), `credential-exposure`,
`bootstrap-credential` (temporary credentials graded one-time and
shortest-practical). Internet exposure of an OT asset raises assurance for every
workflow that depends on it — never lowers it because "it has always been that
way."

## 10. System dependency mapping

**DOCTRINE over shipped surfaces.** Which service depends on what is modelled
today as flows and situations with worst-concern-wins composition; the coverage
model states which dependencies are observed vs merely projected. A dependency
nobody has mapped is an `unknown` — and unknown raises assurance (§ Zero Trust
principles), it never quietly passes.

## 11. Communications redundancy

**DOCTRINE over shipped surfaces.** A single-path dependency (M365 as the only
voice/collaboration plane) is a resilience defect *before* any outage. Shipped
anchors: the Communications Systems catalog (row 47), `carrier`,
`observability-integrity` (is the plane that would tell you even working), and
`local-authority` — the launch family whose entire question is *what may a
shared device still do when the cloud plane is gone*. The municipal composition:
active outage + no verified redundant channel → restrict nonessential operations
and route the emergency-communications owner.

## 12. Sensitive data protection and backup resilience

**Partly shipped, partly SPECIFICATION.** `data-protection` and `store-scope`
grade the live handling of sensitive data. Immutable-backup evidence and
tested-restoration evidence are SPECIFICATION: the model requires *recovery
proven, not recovery assumed* — a backup that has never restored is a green
indicator wearing a claim (the watermelon shape, applied to disaster recovery).

## 13. Institutional knowledge continuity

**DOCTRINE, mostly human-owned.** Undocumented single-person dependencies are an
organizational fact SignalGrid cannot sense directly and does not pretend to.
What it can do: `response-accountability` already grades *unowned* concerns as
their own posture, and a change workflow may require runbook/owner verification
before proceeding — the knowledge gap surfaces at the moment it matters, as
friction with a named owner, not as a dashboard nobody reads.

## 14. Municipal KPI / KRI / KCI pack

**SPECIFICATION.** The full indicator pack (automation-review coverage, vendor
privileged-access coverage, reconciled resident-record coverage,
department-baseline coverage, default-credential exposure, communications
redundancy coverage, immutable-backup coverage, single-person dependency count,
wrongly-denied benefit count, restoration time, and the rest) is carried as a
specification under the [KPI / KRI / KCI model](SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md)'s
law: **an indicator informs assurance; it never creates a grant** — and, for the
municipal case, never creates an automated *denial* either. No indicator in this
pack is minted as a decision code (asserted by the proof).

## 15. SignalGrid decision impacts

**DOCTRINE** — the behavior table this model composes from surfaces that exist:

| Municipal condition | SignalGrid behavior |
|---|---|
| Data owner missing | route owner / restrict automated decision |
| Vendor access expired | step-up or deny privileged access |
| Communication redundancy missing | restrict critical-incident workflow, route emergency-communications owner |
| Legacy system unpatched | raise assurance, require compensating-control evidence |
| Automation using stale data | require human review |
| Institutional knowledge gap | require runbook / owner verification before change |
| Unclear accountability | block closure, route governance owner |
| Sensitive-data protection weak | restrict export, require backup/encryption evidence |

Worked examples (permit automation on stale parcel data; contractor access to a
water utility; dispatch on a single M365 path during an outage; contradictory
benefits eligibility; an unpatched public-safety server) each resolve to
restrict-the-automation / step-up-the-access / route-the-owner — never to a
silent allow and never to an unreviewable automated denial.

## 16. Limited GA relationship

**STRUCTURAL — the freeze holds.** This model adds **no new connector family, no
new catalog, and no new reason code**. The ~39 proposed `MUNICIPAL_*` codes and
the `SignalGridMunicipalContext` record are **SPECIFICATION** — the same
judgement as the `SAML_*`, `ZERO_TRUST_*`, `ITSM_*`, SecOps, and indicator
families before them: a code no rule emits is a string that looks like evidence.
The launch families remain `graph`, `device-management-health`,
`local-authority`. The article strengthens the launch doctrine rather than
stretching it: every source needs an owner, every decision needs evidence, every
automation needs review boundaries, every vendor path needs lifecycle
governance, every critical workflow needs recovery and communications plans.

## 17. Deferred public-sector expansion

**SPECIFICATION, named as planned and not linked.** The future vertical pack —
`lib/municipal-risk-catalog` (vulnerability taxonomy, indicator definitions,
decision-impact table as data) and a municipal context object on the `/v1`
surface — is deferred until after the launch wedge ships, per the breadth
freeze. When built, it follows connector discipline like every family before it:
gated from birth, fixture-backed, proof-carrying, mutation-swept.

---

*Positioning, short form: SignalGrid helps public-sector teams prove which
services are safe to continue, who owns the risk, and what must be verified
before trust is restored.*
