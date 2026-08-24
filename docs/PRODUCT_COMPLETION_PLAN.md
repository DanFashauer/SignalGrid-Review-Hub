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
one shared-device workflow, one read-only device-management evidence source
(open-source lab first — Fleet; Microsoft Entra/Intune as the first enterprise
production connector — the §12 redirect), one deterministic allow / step-up /
restrict / deny loop, one operator console, one host-app integration pattern,
one evidence/audit story, one design partner.

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

**The gate suite protects the wrong ratio.** The preflight step count — printed
by `node scripts/preflight.mjs`, not pinned here, because it changes every time
a gate lands and this line held a stale 166 for exactly that reason — against
**~10% that protect the launch surface**. Every docs edit fires the full proof wall. Five doctrine
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

## 11. Second scan (2026-08-10, verification pass) — corrections and the revised plan

The owner asked for the §9 findings to be re-verified before more building. Three
independent sweeps re-checked every load-bearing claim against the tree as it
stands after D1. The thesis held; specific numbers and two prescriptions did not.
This section is the record, and D2–D4 below are restated in their corrected form
— where §10 and §11 disagree, §11 governs.

### 11.1 What the first scan got wrong (and what is actually true)

- **Decision-rendering surfaces: 11–12, not 6** — signalgrid-app has four
  (Decisions list, DecisionDetail, Dashboard table, LiveDecisionPanel), the
  review deck three, desktop and mobile-pwa one each, plus the api-server
  `/console`, the offline room console, and iOS SignalGridOperator.
- **"Zero /v1 UI consumers" was too strong.** Two signalgrid-app surfaces
  already call the real `/v1` (LiveDecisionPanel evaluates; AppWorkflows), and
  **iOS SignalGridOperator already consumes `/v1` decisions, evidence and audit
  end to end** — its `DecisionDetailView.swift` renders ~11 of the 12 detail
  elements and is the ready-made model for the web rewrite. What remains exactly
  true: **no web list/detail/evidence/audit view calls `/v1`**, while the launch
  profile justifies `/v1/decisions` as "the console's list view."
- **DecisionDetail.tsx is worse than reported:** 87 lines, and only outcome +
  latency carry live data. The fixture `Decision` type structurally cannot carry
  9 of the 12 elements, so the page needs a source change, not a facelift.
- **Three API clients, not two** — the orval fixtures client (app/desktop/pwa),
  the hand-written `v1.ts` (hardcoded demo bearer; outcome spelled `step_up`),
  and `control-plane.ts`. The fixtures client and `v1.ts` disagree on the
  outcome enum spelling and the id field, which breaks naive convergence.
- **Decision ladders: five-to-six, not four** — the scan missed
  `facility-trust-graph`, which maintains its own severity table **twice**
  (`evaluate.ts` and `clinical.ts`). No mapping exists between the core's 4
  outcomes, the simulator's 10, posture-composition's 8 and the graph's 6.
- **Connector families: exactly 51** (3 launch + 48 deferred), not "48–50."
- **Docs: 204 top-level is exact, but "46 canonical claims" was false** — that
  figure was the old doc-orphan count (now pinned at 10). Genuine
  self-canonical claims: ~3, non-overlapping. The real sickness is the
  clusters: **14 readiness docs (12 written in one 8-day July burst, never
  touched again)** and ~58 positioning/doctrine docs.
- **Gate suite: 167 entries, 163 distinct — four gates are exact duplicates**
  (`proof:nac`, `proof:webhooks`, `proof:emit-gate`, `proof:mdm-profile` each
  run twice under two names). Launch-protecting share is ~15% (band 13–17%),
  not 10%; the sharper fact stands: **47 gates fire on deferred families every
  push**, nearly double the launch coverage, and 8 doctrine-document proofs sit
  in the per-push critical path.
- **The "noisy workflows" prescription was mostly backwards.** `promote.yml` is
  already dispatch-only (and recently maintained — keep it);
  `level-10-audit.yml` is path-scoped with no cron and is the only one of the
  three that can be deleted freely; `scheduled-verification.yml` is the sole
  cron, and deleting it or promote without removing their entries from
  `scripts/lib/ci-jobs.mjs` in the same commit fails the preflight parity gate.
- **The ~85-doc move was oversold.** Only ~45 docs are genuinely free to move
  (sales/social/founder/competitive/stale-readiness). 25 docs are hard-required
  by literal path in `docs-sanity.mjs`; the orphan gate sits at its 10/10
  ceiling so the INDEX must be rewritten in the same commit; and three gates
  scan `docs/*.md` **non-recursively** (`check-proof-figures`,
  `check-proof-counts`, `generate-sync-manifest`), so a moved doc silently
  leaves guard scope — the exact "green while unchecked" defect this repo hunts.
  Several would-be "positioning" docs are enforced by dedicated preflight
  proofs (the IT-layer model by two gates; the five vertical models by one
  each) and are not free to move at all.

### 11.2 New finding the first scan missed entirely

**The two D1 categories are core-only, and nothing can notice.**
`device_management_health` and `local_authority` exist in `signalgrid-core`
(with active restrict-on-affirmative-bad rules) but the simulator and the iOS
EnterpriseShell port have no vocabulary for them. The parity gate compares
simulator↔Swift only — both sides are equally blind, so it stays green. A
device affirmatively reporting a broken management plane would get `restrict`
from `/v1` and `allow` from the on-device engine. Day-one-quiet limits the
blast radius (a fleet not emitting the new signals sees no divergence), but the
gap is real, silent, and ungated; there is also **no core↔simulator equivalence
gate at all**. Related: the launch profile still records device-management-health
as shipping in "shadow mode returning step_up" while the core now carries an
active restrict rule — the two statements need reconciling.

### 11.3 D2, restated (bind the console to /v1) — the verified work list

The launch profile currently names `signalgrid-review` as "the one operator
console" while classifying `signalgrid-app` demo-only; §10's ratified direction
(reclassify signalgrid-app as the console, review deck as the review deck)
resolves that contradiction and stands. Concretely:

1. Extend `artifacts/signalgrid-app/src/lib/v1.ts` beyond evaluate:
   `listDecisions`, `getDecision`, `getEvidence`, `getAudit`, `getContext`;
   replace the hardcoded demo bearer with injectable token plumbing (demo key
   as default, still labelled demo).
2. Reconcile the type split (fixtures `step-up`/`id` vs `/v1` `step_up`/
   `decisionId`) — adopt the `/v1` shapes; fix `OutcomeBadge`/`outcomeTone` and
   `format.ts` (string timestamps).
3. Rewrite `DecisionDetail.tsx` on the model of iOS `DecisionDetailView.swift`
   (the proven 11/12-element rendering): outcome, reason codes, matched rules,
   evidence snapshot (id/digest/policy version), signals used with per-signal
   freshness, tenant, latency, audit link, assurance label, resolution.
4. Move `DecisionList.tsx` and the Dashboard recent-decisions table off the
   monitoring fixtures onto `/v1/decisions`.
5. Add an Audit route rendering `/v1/audit` with the chain-verification result.
6. Assurance labels (P0 #238): read `/v1/context` and render the assurance
   posture wherever a verdict appears — `assurance.ts` names today's unlabeled
   consoles as an open defect; this closes it.
7. Widen the GA route fence (`artifacts/api-server/src/lib/profile.ts`): the
   launch profile publishes decisions/evidence/audit, but `GA_ALLOWED_ROUTES`
   currently allows only evaluate + list — add `GET /v1/decisions/{id}`,
   `/{id}/evidence`, `/v1/audit`, `/v1/context`.
8. Reclassify surfaces in `scripts/launch-profile.mjs` (app → launch console;
   review → review deck) and satisfy `check-launch-profile.mjs`.
9. Update the pinned e2e/observability expectations
   (`admin-console.spec.ts`, `decision-matrix.spec.ts`, `observability-proof.ts`).
10. Check the OpenAPI `EvaluateResult` schema against what the detail view
    needs (tenant, assurance, per-signal freshness) — spec drift is suspected;
    `proof:api-contract` gates it.

**D2.5 — truthfulness of the seam (from §11.2):** declare the core↔simulator/
iOS category gap where product truth lives (WHAT_SIGNALGRID_DOES_TODAY + launch
profile), reconcile the shadow-mode wording with the active restrict rule, and
add a pinned known-divergence list so the gap is loud instead of silent. Porting
the two categories into the simulator + Swift (via the SignalContext pattern,
never by editing the ported engines' behavior) is a Mac-lane task, sequenced
after the declaration, not before.

### 11.4 D3, restated (cut the noise) — re-sequenced to survive the gates

Order matters; each step names the gate that would otherwise fail:

1. **Quick wins, zero risk. DONE.** Delete the four duplicate preflight gates;
   delete `level-10-audit.yml` (uncovered by the parity maps — breaks nothing);
   retire the CONSOLIDATION_HARVEST merge-inventory doc (already an orphan;
   ratchet the orphan pin 10 → 9). All three landed together; the harvest doc
   no longer exists, so it is named here rather than linked.
2. **Make the three doc scanners recursive first**
   (`check-proof-figures.mjs`, `check-proof-counts.mjs`,
   `generate-sync-manifest.mjs`), so moved docs stay inside guard scope.
3. **Move the ~45 free docs** (sales/social/founder/competitive + the 12-doc
   stale readiness burst, keeping `PILOT_READINESS_CRITERIA`) to
   `docs/research/`, rewriting `docs/INDEX.md` and regenerating the live-sync
   manifest in the same commit.
4. **verify:breadth lane:** move the 47 deferred-family gates and the 8
   doctrine-doc proofs out of per-push preflight into a `verify:breadth`
   command with a matching CI lane, updating `scripts/lib/ci-jobs.mjs` and both
   parity checks in the same change — kept, runnable, no longer a per-push tax.
5. `scheduled-verification.yml`: keep or retire deliberately; if retired, its
   `ci-jobs.mjs` entry goes in the same commit. `promote.yml` stays.
6. The 25 `docs-sanity.mjs` REQUIRED_DOCS stay put for now; touching that list
   is its own reviewed change, not a side effect of a move.

### 11.5 D4 stands as written

## 12. The source-agnostic redirect (owner-directed, 2026-08-11)

Intake ledger row 77. The owner's correction, in their words: the build path had
drifted **too enterprise-heavy too early**. Microsoft Intune / Entra is the
*commercial target*; open-source MDM is the *low-cost engineering lab*; and
SignalGrid must be source-agnostic so the same decision engine works with Fleet,
Headwind, NanoMDM, Intune, Jamf, or Omnissa later. "The product should not care
which source produced the evidence as long as the adapter emits the same
normalized model."

**What this changed, mechanically:**

1. **The adapter contract** — `DeviceManagementEvidence`
   (`lib/integration-bridge/src/evidence.ts`): tenant, source system, device,
   platform, managed/compliance/policy states, ownership, freshness fields,
   evidence quality, provenance. Its laws are the repo's standing laws restated
   at the boundary: silence for the unanswered, quality lowers and never raises,
   and the unearned *negative* refused (unknown management may not become an
   "unmanaged" boolean).
2. **The Fleet adapter** — `fleetHostToDeviceManagementEvidence`, through the
   proven `@workspace/fleet-connector` normalizer. Fleet was already the chosen
   MDM (CLAUDE.md, `fleet/`, `docs/FLEET_LIVE_INTEGRATION.md`); it is now the
   named lab source on the launch path.
3. **The Headwind-shaped Android lab** — a fixture shape + adapter for shared
   rugged Android (scanners, kiosks), deliberately **not** a 52nd connector
   family: the freeze stands, and the contract is the point.
4. **The swap as a gate** — `proof:evidence-adapter` drives the same device
   states through fleet / headwind / intune adapters and fails unless outcomes
   and reason codes are identical, provenance excepted. Runs per-push.
5. **The criterion amendment** — launch profile v3: the connector clause names
   the evidence-source *role*, lab first, Entra/Intune as the first enterprise
   production connector. Graph stays a launch family (fixture mode needs no
   tenant); nothing was demoted, the prerequisite was.

**Build order from here (the owner's sequence):** open-source MDM lab →
normalized evidence adapter → shared-device decision experience → local/offline
authority model (first-unlock and offline-grant exist in `local-authority`
today; lost-device lives in `custody-beacon`/`location-services`, deferred;
local-network is a genuinely open modeling question) → operator evidence UX →
Microsoft Graph / Intune enterprise adapter → design partner / paid pilot.
D4's partner kit is therefore written lab-first: the demo needs no Microsoft
tenant; "bring your tenant" is the *enterprise* chapter, not the entry ticket.

**Guardrails carried over verbatim:** no live credentials, no production
claims, no autonomous remediation, no customer data, no MDM-replacement
claims, adapters supply evidence only, source systems remain systems of
record.

### 12.1 Design note: the local-network authority state (open, owner decision)

The owner's redirect names four local-authority concepts. Three exist today
under some name; **local-network** — "the device can reach local-network
resources while the WAN / control plane is dark" — is genuinely unmodeled
anywhere in `lib/`. This note is the wireframe-first step for it: the design
argued before any code.

**What it would answer.** Today the fabric can say a device is offline
(carrier reachability), that its link is associated-but-unusable
(link-usability's DHCP/DNS rungs), and whether its offline grant still stands
(local-authority). None of those distinguish the warehouse case that matters:
*the Wi-Fi and local servers are fine, only the internet/control plane is
dark.* A worker mid-pick should keep working against local WMS in that state;
today the evidence cannot express it.

**Where it belongs, if built.** NOT a new connector family (the freeze) and
NOT inside local-authority (that family deliberately owns no network axis —
reachability is assigned to carrier/link-usability by its own header). The
honest home is a **new rung on `link-usability`**: extend its
association→usable ladder with a `local_only` reachability state (link usable,
local resolution/services answering, WAN egress affirmatively failing), which
`decision-continuity` can then weigh when deciding which decision wins across
a partition. One family axis, no new family, no new API surface.

**Why it is not built in this pass.** It changes what an offline verdict can
mean — a worker-visible behavior — so it is an owner product decision, not a
lane's initiative: should "local-only" soften an offline restriction for named
workflows, or only annotate the evidence? Bucket: **owner decision required**
(operating method §3), surfaced here once, with the recommendation above.

**Addendum (2026-08-11) — the annotate-only half is BUILT.** The question
above has two separable halves, and only one of them is a worker-visible
behavior change. Under the owner's standing "go with your recommendations,"
the *annotate* half now exists: `link-usability` carries the `local_only`
rung (posture `local_only_link`, reason `LINK_LOCAL_ONLY`, critical finding
`wan_egress_failing_local_traffic_confirmed`). It alerts at exactly the same
severity as the other confirmed not-fully-usable rungs, never grants (the
exhaustive sweep still admits exactly three granting shapes), and refuses the
`not_associated`+`local_only` contradiction without citing either half —
all pinned in `proof:link-usability` (167 checks; normalized state space
grew 6480→7560, raw wire space 217728→241920). What remained **owner
decision required** was only the *softening* half: whether `local_only` may
ever soften an offline restriction for named workflows via
`decision-continuity`.

**DECIDED (owner, 2026-08-12): annotate-only IS the answer — this question
is CLOSED.** `local_only` names the state for operators and decision
evidence; it never softens an offline restriction. Nothing is wired toward
softening, deliberately and now permanently absent a new owner directive —
this is a decision, not unbuilt scope. The rung's doc comment in `types.ts`
records the same.

With one addition: `docs/DEMO_SCRIPT_FOR_PARTNERS.md` already exists — the kit
revises it rather than starting blank.

---

*The strongest product move now is not another dimension. It is making one
decision so clear that an operator trusts it without being told to.*
