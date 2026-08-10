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

## 9. Full-repo scan findings (2026-08-10) — the circle, diagnosed

A four-reader scan of the entire tree (artifacts, lib, docs, harness/native/CI),
run after the owner disclosed that **no Microsoft tenant or endpoint estate is
available and none can be obtained**. Findings verified with file-path evidence;
this section replaces feel with numbers.

**The seam nobody closed.** The product's decision loop and its UI are
disconnected. Six distinct surfaces render decisions; the one classified `launch`
(`signalgrid-review`) is a scrolling review deck, while the app with the routed
console IA (`signalgrid-app`) is classified `demo_only` — and its decision list
and detail read **24 synthetic fixtures** from `monitoring.ts`, not the real
`/v1` decisions the engine produces. `GET /v1/decisions`, `/:id`, `/:id/evidence`
and `/v1/audit` are implemented, run with no database and no vendor, and **no UI
calls them**. The decision-detail screen is 87 lines covering 3 of the 12
elements §4 requires; the good rendering exists — inside the review deck, where
no operator would find it.

**The core cannot speak two of its three launch families.**
`device_management_health` and `local_authority` never became signal categories
in `signalgrid-core` (`types.ts` `SIGNAL_CATEGORIES`/`EVIDENCE_FIELDS`). Fifty-one
families were built; two of the three that matter were never wired into the
engine's own vocabulary. **Four parallel decision engines** exist (core,
simulator, posture-composition, the emulator's own) and the console runs the
simulator's, not the product's. The Graph connector's fixture mode returns a
*reason string*, not a working connector; `lib/integration-bridge` maps only
FleetDM; `local-authority` has no mock transport.

**The breadth is NOT entangled — good news.** The api-server does not import
`@workspace/integrations` at all; deleting all 48 deferred families would not
break the console. The map never contaminated the engine. It contaminated the
*attention*.

**The docs are the loop.** 204 top-level documents: ~27% serve an operator, ~39%
are doctrine/positioning. Twelve documents compete to be the same readiness gate;
one identical positioning sentence appears 27 times across 13 files; **46 files
claim to be canonical**; two plans are dead (a cutover runbook declaring this
repo "Archived", and its manifest). ~85 files (~40%) belong in a research
library, not the product path. A design partner needs ~9.

**The gate suite protects the wrong ratio.** 166 preflight steps; **~10% protect
the launch surface**. Every docs edit fires the full proof wall. Five doctrine
proofs sit in the critical path — including three added the same week the freeze
was being written to stop exactly that category.

**The demo already exists and is buried.** `docs/room-entry-console.html` — the
decision core inlined into one offline HTML file, 20 scenarios across three
settings — plus `docker-compose.sim.yml` (one container, fixture-safe,
`/console`). Referenced once, in a Mac runbook. `pnpm run demo` now names it.

## 10. Demo-first execution order (replaces the six-month sequence for solo work)

The six-month arc (§7) remains the shape of the *company* plan, but Months 2 and
5 assumed a tenant the owner cannot provide. The solo-completable target is a
**fully self-contained, honestly-labelled demonstration product** that people
*with* resources can evaluate — and for them, the already-built gated Graph
transport turns "we have Intune" into a configuration step, not a build.

**D0 — surface what exists (done in this commit).** `pnpm run demo`; the 57 MB
of untracked iOS build junk deleted; findings ratified here.

**D1 — close the seam (the real build). DONE.** The core half: `signalgrid-core`
speaks all three launch families (`SIGNAL_CATEGORIES` 17, `EVIDENCE_FIELDS` 20,
day-one-quiet v1 rules `MANAGEMENT_HEALTH_BROKEN` / `LOCAL_AUTHORITY_WITHHELD`,
core-normalization v4). The integrations half: `integration-bridge` gained
`graphPostureToDrafts` / `deviceManagementHealthToDrafts` /
`localAuthorityToDrafts`; fixture-mode resolution for all three families now
returns a *working* fixture-backed connector (graph over its mock transport
seeded from `fixtures/microsoft-graph/`, drift-pinned; device-management-health
over demo reports; the new `local-authority/mock-transport`). The exit test is
`proof:launch-seam` (preflight + CI): **connector sync → core decision →
evidence, all three families, with `fetch` disabled for the run.** One planned
line item was corrected rather than done: the api-server *decision* surface
(`/v1` via `SignalGridCore.demo()`) never imported the simulator engine — the
simulator serves only its own `/simulator/*` demo routes, which the room-entry
demo uses, so it stays.

**D2 — one console (P0 tasks #237–240).** Bind Decisions list + Detail + a new
Audit route to `/v1`; build §4's decision detail where the operator lives;
assurance labels on every verdict; reclassify `signalgrid-app` as the console in
the launch profile (and the review deck as the review deck). Exit test: *evaluate
a decision in the UI, open it, see all 12 elements, verify the audit chain —
without the founder in the room.*

**D3 — cut the noise.** Move ~85 doctrine/positioning docs to `docs/research/`
with a stub index; retire the two dead plans; collapse the twelve readiness docs
to `PILOT_READINESSCRITERIA` + pointers; move the five doctrine proofs and
deferred-family proofs to a `verify:breadth` lane out of the per-push critical
path (kept, still runnable, no longer a tax); retire or dispatch-gate the noisy
workflows (`level-10-audit`, `scheduled-verification`, `promote`).

**D4 — the partner kit.** One demo script narrating the room console + full
console; a "bring your tenant" onboarding doc (the env flips:
`DEVICE_MANAGEMENT_HEALTH_TRANSPORT=graph`, `SIGNALGRID_LIVE_INTEGRATIONS`,
token); a feedback form; published links. Exit test: *a stranger with an Intune
tenant can evaluate SignalGrid against it without the owner present.*

**What stays true throughout:** every fixture-backed verdict is labelled
fixture-backed (§5). The demo's honesty about being a demo is the product
demonstrating its own thesis.

---

*The strongest product move now is not another dimension. It is making one
decision so clear that an operator trusts it without being told to.*
