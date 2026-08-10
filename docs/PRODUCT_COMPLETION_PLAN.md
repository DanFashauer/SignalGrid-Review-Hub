# Product completion plan — what "done" means, and what stops now

> **Completion is not 100% of the vision. Completion is: a customer can
> understand it, a technical buyer can test it, a security reviewer can trust its
> boundaries, and an operator can use it without the founder explaining every
> screen.**

This is the **operating plan of record**. It does not restate the plans that
already exist — it sequences them and states what stops.

| Existing document | Its job | This plan's relationship |
|---|---|---|
| [LAUNCH_PROFILE.md](LAUNCH_PROFILE.md) | Which surfaces are `launch` / `deferred` / `demo_only` / `internal`, enforced by a bijection gate | **Authoritative on scope.** This plan does not redefine it. |
| [REALISTIC_LAUNCH_PLAN.md](REALISTIC_LAUNCH_PLAN.md) | The honest sequence to a company and production SaaS | **Authoritative on the arc.** This plan sequences its next six months. |
| [PILOT_READINESS_CRITERIA.md](PILOT_READINESS_CRITERIA.md) | The gate a paid pilot must pass | **Authoritative on the pilot gate.** Month 5–6 defers to it. |
| [PRODUCT_REALITY_CHECKLIST.md](PRODUCT_REALITY_CHECKLIST.md) | v0.2 focus, and what NOT to build | **Authoritative on anti-scope.** Extended here (§2). |
| [OPERATOR_GRID_CONSOLE.md](OPERATOR_GRID_CONSOLE.md) | What the console renders today | Input to the console IA (§4). |

## 1. The one question

Everything the product does must serve one question:

> **Should this shared-device workflow continue right now, and why?**

The first product is the **SignalGrid Shared-Device Trust Gateway**: one tenant,
one shared-device workflow, one read-only Entra/Intune connector path, one
deterministic allow / step-up / restrict / deny loop, one operator console, one
host-app integration pattern, one evidence/audit story, one design partner.

## 2. The freeze, widened — this is the change

Task #212 froze **connector families and catalogs**. That wording had a gap, and
work kept flowing through it: doctrine and vertical documents are neither a family
nor a catalog, so they were never blocked. Two landed the same day this plan was
written (Municipal Critical Services, ITOM/ITSM Bridge). Neither added a family, a
catalog, or a reason code — each respected the freeze **as written** — and each was
still effort spent widening the map rather than finishing the journey.

**The freeze now covers, until the first pilot is real:**

| Frozen | Note |
|---|---|
| New connector families | unchanged from #212 |
| New catalogs | unchanged from #212 |
| **New vertical / doctrine documents** | **new** — this is the gap that was open |
| New hardware concepts | |
| New broad API surfaces | |
| New mobile shells | |
| New automation agents / AI-copilot features | |
| New remediation actions | |

**Not frozen** — anything that moves a decision from *provable in a repo* to
*usable by an operator in a tenant*: the console, the connector experience, auth
and tenancy, evidence and audit surfacing, and the deployment path.

The existing doctrine documents keep their value and stay gated. They become a
**research and future-connector library**, not the product's first UX. Intake
continues to be *recorded* in the ledger; it stops being *built* unless it closes a
named launch blocker.

## 3. The five screens the product must be explainable in

1. **Dashboard** — is the grid healthy, what happened today
2. **Decision detail** — the trust moment (§4)
3. **Connector health** — is the Microsoft path real and fresh
4. **Policy version** — what rule set decided this, and when it changed
5. **Audit / evidence** — what a security reviewer opens

Console IA: Overview · Decisions · Decision Detail · Signals · Integrations ·
Policies · Audit · Settings. Everything else is demo, internal, research, or
future — and is labelled as such.

## 4. Decision detail — the single most important screen

If this screen is excellent, the product is understandable. It must show:
outcome; why; policy version; matched rules; signals used; source system per
signal; freshness; contradictions; **assurance basis** (`observed` vs
`projected_from_sourcing`); route owner; allowed actions; blocked actions; audit
trail; and the recovery/verification requirement before release.

Two laws this screen must make visible, because they are the product:

- **An unknown signal raised the assurance.** The screen must show *absence* as a
  cause, not omit it.
- **A restriction lifts on re-evaluated evidence, never on a closed ticket.**

## 5. Assurance labelling — the overclaim guard

Every environment declares what a verdict means: fixture-backed · live evidence ·
advisory only · shadow mode · enforced by host app · step-up answerable / not
answerable. This prevents the dangerous confusion where a demo decision reads as
production enforcement. It is a **P0**, not polish — the repo's whole credibility
rests on never reporting an unearned affirmative, and an unlabelled demo verdict
is exactly that.

## 6. Priority ranking

| Priority | Work | Why |
|---|---|---|
| **P0** | Decision-detail UX | the product's trust moment |
| **P0** | Microsoft connector setup UX | makes "real tenant" concrete |
| **P0** | Demo / pilot / production labelling | prevents overclaim risk |
| **P0** | Operator console IA | makes the product usable |
| **P0** | Tenant / auth / RBAC experience | required for customer trust |
| P1 | Policy version view | explainability |
| P1 | Audit / evidence explorer | security review |
| P1 | ITSM route-owner model (attach, not integrate) | makes decisions operational |
| P1 | Pilot dashboard | proves value to a buyer |
| P2 | KPI / KRI / KCI packs | after the wedge |
| P2 | Catalog browsing | not the first product |
| P3 | AI agent / copilot | after the deterministic product is proven |

## 7. Six-month sequence

**M1 — product freeze and design spine.** Ratify scope; widen the freeze (§2);
final console IA; decision-detail and connector-setup designs; product profile
states; retire stale public docs; settle the PR #152 disposition.
**M2 — tenant / auth / Microsoft foundation.** Enterprise auth, RBAC route
matrix, tenant isolation, Graph transport, sync runs, connector health UI, and
**no fixture fallback in the customer profile**.
**M3 — operator productization.** The eight console surfaces, evidence trace,
assurance labels. *Exit test: an operator explains a decision without the founder.*
**M4 — pilot hardening.** Managed staging, backup/restore rehearsal, logs/metrics/
traces, security-review package, onboarding guide, runbooks, shadow-mode policy.
**M5 — design-partner pilot.** One tenant, shadow decisions, false-allow /
false-restrict tracking, decision latency, connector freshness, operator feedback.
**M6 — Limited GA / paid pilot.** Pilot fixes, independent security review,
release candidate, pilot agreement, support process, messaging aligned to evidence.

Months 5–6 gate on [PILOT_READINESS_CRITERIA.md](PILOT_READINESS_CRITERIA.md),
which is authoritative and not restated here.

## 8. What this repository can and cannot close

Stated plainly, because a plan that hides its dependencies is its own unearned
affirmative:

**Closable here:** console IA and the five screens, assurance labelling, evidence
and audit surfacing, policy-version view, route-owner attachment, the read-only
Graph transport, doc retirement, and every gate that keeps the above honest.

**Not closable here — needs something outside the repo:** a real Microsoft tenant
(M2/M5), managed staging, database, secrets, DNS/TLS (M4), an independent security
reviewer (M6), and a design partner (M5). These are procurement and relationship
work, not code, and no amount of building in this repository substitutes for them.

---

*The strongest product move now is not another dimension. It is making one
decision so clear that an operator trusts it without being told to.*
