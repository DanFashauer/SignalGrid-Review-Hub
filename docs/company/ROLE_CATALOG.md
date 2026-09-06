# SignalGrid — role catalog

The complete inventory of every role the eventual company holds — one entry
per role, in the sixteen-field schema the founder ratified August 21, 2026.
Statuses: **ACTIVE** (performed now), **COVERED** (responsibility exists,
another person or agent covers it), **FRACTIONAL** (outside professional),
**FUTURE** (activation trigger not reached). Role ≠ employee.

The division map and doctrine live in [ORG_STRUCTURE.md](ORG_STRUCTURE.md);
the status-and-trigger summary is
[ROLE_ACTIVATION_MATRIX.md](ROLE_ACTIVATION_MATRIX.md); decision rights are
[RESPONSIBILITY_AND_DRI_MATRIX.md](RESPONSIBILITY_AND_DRI_MATRIX.md); the
hiring order is [HIRING_SEQUENCE.md](HIRING_SEQUENCE.md).

## Executive & corporate governance

The company is one person — founder and CEO Dan Fashauer — plus AI agent lanes that
carry execution. This division records every executive job the company needs, who or
what holds it today, and the concrete condition that turns an unheld one on.

Three conventions apply to every row below:

- **Role is not headcount.** A role with status COVERED is work being done today by
  the CEO or by an agent lane, not a person the company employs.
- **The agent roster is the layer beneath this one.** `docs/agent/org-roster.json`
  declares 42 engineering, signal-domain, company, and go-to-market agent roles, and
  `scripts/check-org-roster.mjs` reports on every run which of them have never been
  activated. Where a lane covers a role here, Current coverage names the lane and, if
  the lane has never run, says so.
- **Hiring priority here is an ordering within a division.** `docs/company/HIRING_SEQUENCE.md`
  (ratified by the founder, 2026-08-21) is the company-level order across all
  divisions, and it wins where the two are read together. Numbers rank 1 (earliest)
  to 10 within this catalog; `-` means the role should not be hired against on its current trigger.

### Chief Executive Officer (founder)

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | ACTIVE |
| Reports to | No internal reporting line; accountable to shareholders. No board exists today. |
| Mission | Set product scope and company direction, and hold the only signature the company has. |
| Responsibilities | Owns launch scope and the decision records that change it (DR-005 ratified launch-profile v4 and froze the current edge; the profile is at v5 today — read `LAUNCH_PROFILE_VERSION` in `scripts/launch-profile.mjs`); holds product strategy and the endpoint/infrastructure domain expertise the signal model rests on; approves everything that leaves the company — publication, outreach, counterparty paperwork; supplies the inputs only the owner can supply (billing figures, vendor accounts, repo-admin settings); directs the agent lanes and sets their delegated-authority boundaries; decides which roles in this catalog activate, and when. |
| Authority | Scope, publication, spend, counterparty engagement, role activation, and reversal of any delegated decision. |
| Cannot approve alone | Nothing structurally — but by standing rule: no scope widening without a written decision record; no compliance, certification, or attestation claim at all; no claim published against a gate that is failing. Regulated-vertical questions (healthcare, fintech) need a human compliance review, which this role does not itself supply. |
| Inputs | `docs/OWNER_ACTIONS.md`; `docs/COMPANY_BUILD_PLAN.md`; `docs/INTAKE_LEDGER.md`; lane inbox (`pnpm run lane:inbox`); gate, proof, and sim-result output. |
| Outputs | Entries in `docs/DECISION_RECORDS.md`; the ratified launch profile; owner-board dispositions; approved publications. |
| KPIs | Owner decisions captured as decision records rather than chat only (target 100%); open items in `docs/OWNER_ACTIONS.md` older than 14 days (target 0); executed decisions carrying a written reversal condition (target 100%). |
| Activation trigger | Active now. |
| Current coverage | Dan Fashauer, the only person in the company. Software execution is AI-covered via the agent roster; the CEO reads, ratifies, and reverses — he does not write the code. |
| Human / fractional / AI-supported | Human, AI-supported. |
| Hiring priority | - |
| Required competencies | Endpoint/UEM and infrastructure depth; scope discipline under commercial pressure; ability to read evidence output and reject an unsupported claim; written, reversible decision-making. |
| Customer/security implications | Every truth claim a buyer or assessor sees is downstream of this role. It is the last stop before an over-claim becomes public and the only role that may change what SignalGrid says it does. |

### Chief Operating Officer

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | FUTURE |
| Reports to | CEO |
| Mission | Run the company's execution rhythm so the CEO spends his time on scope, product, and counterparties rather than on coordination. |
| Responsibilities | Owns the operating cadence — planning periods, review meetings, the single prioritized backlog; holds cross-division delivery accountability once more than one delivery lane exists; owns vendor and tooling operations against owner-supplied spend figures; runs hiring operations and onboarding when headcount starts; chairs the operational-governance review that reads quality, release, and incident output together. |
| Authority | Sequencing and resourcing inside a scope the CEO has already ratified; internal process changes; vendor selection below an owner-set threshold. |
| Cannot approve alone | Launch-scope changes; anything published externally; counterparty paperwork; spend commitments; headcount offers; any change to what a gate asserts. |
| Inputs | Division plans; the build backlog; gate and CI health; agent-lane throughput; owner-supplied cost figures. |
| Outputs | Operating cadence and its written record; a single ranked cross-division backlog; quarterly operating review notes; onboarding runbooks. |
| KPIs | Share of committed period items delivered or explicitly re-planned (target ≥90%, no silent carryover); median age of open cross-division blockers; count of decisions escalated to the CEO that a delegated authority already covered (target: falling). |
| Activation trigger | Paid humans working on SignalGrid at the same time reach three, or the company runs two or more concurrent design-partner deployments — whichever comes first. |
| Current coverage | Not held as a role. The CEO performs the parts that cannot wait; cadence and sequencing are AI-covered in the product tree via the agent roster's `program-manager` lane (activated 2026-08-19) and `product-manager` lane. |
| Human / fractional / AI-supported | Human (fractional acceptable at activation). |
| Hiring priority | 6 |
| Required competencies | Multi-team delivery management in a regulated-buyer market; comfort operating alongside agent lanes rather than replacing them; evidence literacy — reading a proof suite rather than a status deck. |
| Customer/security implications | A COO who optimizes for delivery speed can erode the evidence culture that is the product's actual differentiator. The role must be hired with the fail-closed and no-over-claim rules as explicit, non-negotiable constraints. |

### Chief of Staff (including executive operations)

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | COVERED |
| Reports to | CEO |
| Mission | Make sure every owner decision is written down, routed to the right lane, and closed — and that owner time goes to the items only the owner can do. |
| Responsibilities | Maintains the owner-decision queue (`docs/OWNER_ACTIONS.md`) and drives each item to closed or explicitly dropped; drafts decision records for owner decisions, including the reversal condition, and files them in `docs/DECISION_RECORDS.md`; runs the intake loop so no owner input dies in a chat scrollback (`docs/INTAKE_LEDGER.md`); prepares the owner's read-ahead for anything needing a decision — the options, the evidence, the recommendation, on one screen; executive operations: calendar, inbox triage, meeting records, travel, and owner-only account and vendor sign-ups. |
| Authority | The format, routing, and priority order of owner-facing queues; declaring an item stale and returning it to its originating lane. |
| Cannot approve alone | Any decision it is staffing; scope; publication; spend; anything requiring the owner's signature. |
| Inputs | Owner messages and inputs of any format; lane messages; build-plan owner-hands section; division escalations. |
| Outputs | The owner action queue; drafted decision records; intake dispositions; meeting and decision notes. |
| KPIs | Owner decisions that reach a written record within 48 hours (target 100%); owner-queue items older than 14 days (target 0); intake items with no recorded disposition (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a hire when the owner queue holds more than 10 open items for two consecutive weeks, or when a decision is executed in the tree with no decision record written for it. |
| Current coverage | The CEO plus AI agent lanes: `program-manager` (activated 2026-08-19) drives queues and calls cold roles; the `records-archivist` lane is declared in the agent roster and has never been activated, which `check-org-roster.mjs` reports on every run. Executive operations — accounts, sign-ups, repo-admin settings — is not delegable and sits entirely with the CEO. |
| Human / fractional / AI-supported | AI-supported today; human or fractional at activation. |
| Hiring priority | 3 |
| Required competencies | Decision hygiene — writing what was decided, by whom, on what evidence, and what would reverse it; ruthless triage; comfort saying an item is stale. |
| Customer/security implications | The role holds owner-only credentials and unpublished decisions in draft. It handles material a buyer has not seen and must not circulate it; the publication boundary check exists because that leak shape is real. |

### Corporate strategy lead

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | COVERED |
| Reports to | CEO |
| Mission | Keep the company's strategic path chosen deliberately and written down, rather than drifting with whoever called last. |
| Responsibilities | Maintains the strategic path set and its trade-offs (`docs/COMPANY_OPERATING_PACK.md` records five: founder-led design-partner, strategic investment with product-control protections, OEM/embedded, acquisition with retained product leadership, full buyout); keeps the company-versus-product boundary decision current and re-argued only against its recorded triggers (`docs/COMPANY_VS_PRODUCT.md`); frames scope questions for the CEO with the evidence each option needs; reviews market and competitive input for strategic consequence, not for copy; writes the strategic half of any decision record. |
| Authority | What analysis gets done and how options are framed. |
| Cannot approve alone | Choosing a path; any external conversation; scope changes; any published statement of direction. |
| Inputs | Competitive and market briefs from the `competitive-analyst` lane; product evidence and launch profile; owner priorities; the estate consolidation picture. |
| Outputs | Strategy option memos with recorded trade-offs; updates to the operating pack; the trigger lists that would flip a standing decision. |
| KPIs | Standing strategic decisions carrying explicit flip-triggers (target 100%); strategy documents contradicted by a committed gate or proof (target 0); path decisions re-argued without new evidence (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role when two strategic paths are live at once — for example a design-partner program running while a financing or OEM conversation is open. |
| Current coverage | The CEO holds it. Supporting analysis is AI-covered via the agent roster's `competitive-analyst` and `pricing-packaging-analyst` lanes, both declared and never yet activated. |
| Human / fractional / AI-supported | Human (CEO), AI-supported. |
| Hiring priority | - |
| Required competencies | Category strategy in security and endpoint tooling; option framing under uncertainty; writing that separates what is known from what is assumed. |
| Customer/security implications | Strategy documents are the most common place a company invents a partner or a customer it does not have. Everything this role writes is held to the same claims bar as buyer-facing copy. |

### Business operations & program management lead

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | COVERED |
| Reports to | COO when active; CEO today |
| Mission | Turn ratified scope into sequenced work with owners and visible state, and keep the internal operating stack running. |
| Responsibilities | Maintains the single ranked backlog and calls out drift, contradictions, and stale entries; plans and sequences shifts across lanes, including cross-lane collision avoidance under the lane protocol (`docs/LANE_COORDINATION.md`); tracks program state honestly — a failing gate is reported failing, and a skipped run never counts as closed; runs internal tooling and systems administration for the company's own operations; tracks spend against owner-supplied figures and publishes the denominators (shift counts, run counts) that make a later owner billing number usable; reports which declared roles have never activated and either activates or retires them. |
| Authority | Sequencing inside ratified scope; backlog structure; declaring an item stale; calling a cold role. |
| Cannot approve alone | Scope; spend commitments; cost or price figures of any kind; publication; retiring a gate. |
| Inputs | `docs/BUILD_BACKLOG.md`; `docs/COMPANY_BUILD_PLAN.md`; roster activation report; lane messages and sim-request state; CI and preflight output. |
| Outputs | The ranked backlog; shift plans and their after-state; program status with named blockers; the never-activated role report; run and shift denominators. |
| KPIs | Backlog items with a named owner and a next action (target 100%); shifts closing with evidence committed rather than asserted (target 100%); pending sim-requests or unread lane messages older than 7 days (reported every run, target falling); declared roles never activated (target: falling, or retired with a tombstone). |
| Activation trigger | Active now as a covered responsibility. Converts to a hire when two or more human contributors need sequencing against each other, or when backlog state is being reconstructed from memory rather than read from the tree. |
| Current coverage | AI-covered via agent roster lanes: `program-manager` (activated 2026-08-19, the role that reads the roster gate and calls cold roles), `product-manager` (activated 2026-08-19), `sre`, and `mac-lane-steward` (activated 2026-08-21 for the cloud-to-Mac loop). |
| Human / fractional / AI-supported | AI-supported, with CEO accountability. |
| Hiring priority | 4 |
| Required competencies | Program management against evidence rather than status reports; systems administration; the discipline to publish a denominator before a rate. |
| Customer/security implications | This role decides what gets reported as done. Overstating completion here is how a buyer-visible over-claim gets manufactured internally before anyone writes copy. |

### Corporate secretary & board administration

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | FUTURE |
| Reports to | CEO |
| Mission | Keep the company's corporate record accurate, complete, and defensible from the day there is more than one interested party. |
| Responsibilities | Maintains the corporate record — formation documents, ownership ledger, resolutions, consents; convenes meetings and produces the minutes and written consents that record what was decided; keeps the delegation-of-authority matrix current and reconciled with this catalog; manages statutory filings and registered-agent obligations with outside counsel; runs the document-retention rules for corporate records. |
| Authority | Meeting mechanics, records format, filing calendar. |
| Cannot approve alone | Any corporate action itself — issuance, resolution, appointment, or amendment. All require the CEO and, when one exists, the board. |
| Inputs | Owner decisions; counsel guidance; equity and ownership events; this catalog's authority fields. |
| Outputs | Minute book; resolutions and written consents; ownership ledger; filing calendar; the delegation-of-authority matrix. |
| KPIs | Corporate actions with an executed written record (target 100%); statutory filings made on or before their due date (target 100%); delegation matrix rows contradicted by observed practice (target 0). |
| Activation trigger | The company issues equity or convertible instruments to a second party, appoints a director or forms a board or advisory board with a written charter, or accepts external investment — whichever is first. None of these has occurred. |
| Current coverage | Not held. There is one shareholder, no board, and no equity issued to any second party, so the function has no work today. Decision records in `docs/DECISION_RECORDS.md` are the current written record of owner decisions and are the seed of a future minute book. |
| Human / fractional / AI-supported | Fractional (outside corporate counsel or a corporate-secretary service), AI-supported for drafting and calendar. |
| Hiring priority | 5 |
| Required competencies | Corporate governance and entity administration; statutory filing practice; records discipline. |
| Customer/security implications | Enterprise and public-sector buyers diligence the corporate record. Gaps surface during procurement, not before it, and slow or stop a deal at the worst moment. |

### Investor relations lead

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | FUTURE |
| Reports to | CEO |
| Mission | Run a truthful, repeatable information flow to investors once investors exist. |
| Responsibilities | Prepares periodic updates whose every operational figure traces to a committed command or artifact; assembles and maintains a diligence data room by export from the existing self-contained materials, never by forking the tree; manages the investor question queue and routes technical questions to the lane that can answer with evidence; holds the line that unaudited internal figures are labeled as such; coordinates with the corporate secretary on information rights and consents. |
| Authority | Format and cadence of investor communication; what supporting evidence accompanies a figure. |
| Cannot approve alone | Any financial, valuation, revenue, or projection figure; any forward-looking statement; opening or closing a financing; sharing anything outside the publication boundary. |
| Inputs | Owner-supplied financial figures; product evidence and gate output; the executive one-pager, security questionnaire pack, and pilot scope skeleton. |
| Outputs | Investor updates; data-room index; the question-and-answer log with sources. |
| KPIs | Update figures traceable to a committed source (target 100%); investor questions answered with a citable artifact within 5 business days (target ≥90%); corrections issued after publication (target 0). |
| Activation trigger | **No investor relationship exists today; this role activates when the CEO opens a financing process in writing, or the first external party holds a security in the company.** |
| Current coverage | Not held, and there is nothing to hold — the company has taken no external investment and has no investors. The agent roster's `finance-fundraising` lane is declared and has never been activated; the cost model landed 2026-08-22 (`docs/COST_MODEL.md`, backlog row 22); the four owner-only billing figures remain unsupplied there. |
| Human / fractional / AI-supported | Human (CEO at activation), AI-supported for assembly. |
| Hiring priority | 7 |
| Required competencies | Investor communication in early-stage deep-tech; financial literacy sufficient to refuse an unsupported number; disclosure discipline. |
| Customer/security implications | Investor materials leak into the market. A figure or claim that would not survive a buyer's security questionnaire must not appear in an update either. |

### Strategic advisory coordinator

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | FUTURE |
| Reports to | CEO |
| Mission | Get specific expert judgment into specific decisions, on the record, without creating implied endorsement. |
| Responsibilities | Identifies the decision classes where outside judgment would change an outcome — regulated-vertical procurement, MDM and supervised-device practice, security assessment expectations; runs a written engagement for each advisor covering scope, term, confidentiality, and compensation, with counsel review; prepares briefing packets that state the question and the evidence, and records the advice and its disposition in the decision record; enforces the rule that an advisor relationship is never described publicly as a partnership, endorsement, or customer relationship; reviews advisor conflicts before engagement. |
| Authority | Which questions are put to advisors; briefing content and format. |
| Cannot approve alone | Engaging an advisor; any compensation, equity, or title; naming an advisor publicly; acting on advice that changes scope. |
| Inputs | Open decisions with an evidence gap; candidate advisor profiles; counsel review of terms. |
| Outputs | Advisor agreements (executed by the CEO); briefing packets; advice-and-disposition entries in decision records; the conflicts register. |
| KPIs | Advisor sessions producing a recorded disposition — adopted, adapted, or declined with a reason (target 100%); advisors publicly named without written consent (target 0); decisions taken on advice with no written record (target 0). |
| Activation trigger | **No advisory relationship exists today; this role activates when the CEO signs a written advisor agreement with a named individual.** |
| Current coverage | Not held. No advisors, formal or informal, are engaged. Outside expertise is currently absent from the company's decisions except where the CEO holds the domain himself. |
| Human / fractional / AI-supported | Human (CEO at activation), AI-supported for briefing preparation. |
| Hiring priority | 9 |
| Required competencies | Network access in healthcare, municipal, and warehouse IT operations; the discipline to convert advice into a written, disposable recommendation rather than an aura of validation. |
| Customer/security implications | Advisor names are the easiest way to imply endorsement the company has not earned. The claims gate treats an advisor named as a partner as an over-claim, and the guardrails forbid it. |

### Corporate development lead

| Field | Value |
|---|---|
| Division | Executive & corporate governance |
| Status | FUTURE |
| Reports to | CEO |
| Mission | Handle inbound and outbound structural approaches — OEM, embedded, reseller, acquisition — with the product-control preferences intact. |
| Responsibilities | Screens approaches against the recorded strategic paths and their product-control protections; runs structured diligence in both directions and assembles what the counterparty may see under the publication boundary; models deal structures against the owner's stated preference for retained product direction, without producing valuation or financial figures; coordinates counsel on term sheets, LOIs, and definitive documents; maintains the counterparty register with the current, honest state of each conversation. |
| Authority | Approach triage and diligence sequencing; what is prepared for a counterparty, pending CEO release. |
| Cannot approve alone | Entering a transaction discussion; any term, price, or valuation; releasing material outside the publication boundary; describing any counterparty relationship publicly. |
| Inputs | Inbound approaches; the strategic path set; the publication boundary; counsel guidance; product evidence. |
| Outputs | Approach assessments; the counterparty register; diligence packages; deal-structure options with their product-control consequences. |
| KPIs | Approaches assessed against recorded strategy within 10 business days (target 100%); material released to a counterparty without CEO approval (target 0); counterparty conversations described publicly before an approved announcement (target 0). |
| Activation trigger | **No partnership, OEM, reseller, alliance, or acquisition relationship or discussion exists today; this role activates when an inbound or outbound approach reaches written terms — an LOI, a term sheet, or a draft agreement.** |
| Current coverage | Not held. The company has no counterparties. The agent roster's `partner-alliances-analyst` lane is declared for assessing candidates and has never been activated; `docs/HARDWARE_PARTNER_MATRIX.md` and similar documents catalog *candidate* categories only. |
| Human / fractional / AI-supported | Human (CEO at activation) with fractional counsel; AI-supported for diligence assembly. |
| Hiring priority | 8 |
| Required competencies | Structural transactions in enterprise software; diligence management; the ability to keep product-control terms central when commercial terms dominate the room. |
| Customer/security implications | Diligence is where confidential product material and unpublished evidence move outside the company. Every release runs through the publication boundary, and no relationship is described publicly until it exists and the CEO has approved the words. |

## Quality & operational governance

Quality at SignalGrid is enforced mechanically before it is managed: the proof suite,
preflight, and the merge policy already fail work that drifts. This division names the
governance layer above those gates — who owns the system of quality, who decides a
release may go, who runs the postmortem, who owns the indicators, and who is
accountable when a gate is green in both directions.

Two honest notes carry across every row:

- **No company-level measured outputs have been assigned to governance yet.** The KPIs
  below are derived from what the repository can already count — gate results,
  decision records, roster activation, request queues — so each is checkable today
  rather than aspirational.
- **Internal objectives are not customer commitments.** The reliability objectives in
  `docs/RELIABILITY_SLO.md` are internal targets computed from supplied records. No
  service-level agreement is offered to anyone, and no role below may imply one.

### Head of quality & operational governance

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | CEO (COO when active) |
| Mission | Own one coherent system of quality across the company, and make sure a green result means what it claims. |
| Responsibilities | Owns the quality management system — what is gated, what is reported, and where the difference is written down; hunts gates that cannot fail, since a check that is green in both directions is the estate's own worst defect class; owns process improvement and corrective actions arising from postmortems, and closes them with evidence rather than intent; maintains the map of which validation lane covers what, including the documented gap between the local harness and the full preflight and breadth lanes; runs the periodic quality review across release, change, incident, and indicator output; keeps quality documentation truthful — a failing gate is reported failing. |
| Authority | Declaring a gate insufficient; requiring a self-test or mutation proof before a gate counts as coverage; setting review cadence and format. |
| Cannot approve alone | Removing or weakening a gate; releasing with a known failing gate; scope changes; any external quality or compliance claim. |
| Inputs | Proof, preflight, and breadth-lane results; review findings; postmortem actions; roster activation report; coverage ledgers. |
| Outputs | The quality-system map; gate-sufficiency findings; the corrective-action register; periodic quality review records. |
| KPIs | Gates with a self-test or mutation proof showing they can fail (target 100%, measured against the guard registries); corrective actions from postmortems closed with committed evidence (target 100%); quality claims in docs contradicted by a committed run (target 0); coverage figures published without a denominator (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role when a customer-facing quality commitment is made, or when gate maintenance is deferred for two consecutive shifts because no one owns it. |
| Current coverage | The CEO holds accountability. Execution is AI-covered via agent roster lanes: `qa-engineer` (activated 2026-08-19, adversarial review), `devex-tooling-engineer` (activated 2026-08-19, the gate fabric), and `compliance-analyst` (activated 2026-08-19) for control-claim wording. No company-level quality management system document exists yet; the gates are the system today. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | 5 |
| Required competencies | Quality management in software; adversarial thinking about verification — proving a check can fail; evidence-first writing. |
| Customer/security implications | This role protects the property the product is sold on: that a claim is backed by something that would have failed if the claim were false. A vacuous gate is a security defect here, not a process nit. |

### Release governance lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance |
| Mission | Decide, on recorded criteria, whether a surface may ship and what it is allowed to be called. |
| Responsibilities | Owns the launch profile — every surface classified launch, deferred, demo-only, or internal, and no surface unclassified (`scripts/launch-profile.mjs`, ratified at v4 by DR-005; currently v5 with 180 classifications — read `LAUNCH_PROFILE_VERSION`, not this sentence); runs the go/no-go for each release against written criteria, with the decision and its evidence recorded; keeps release artifacts and versioning coherent, including the API versioning policy; enforces that buyer-facing surfaces never present deferred capability as shipping, and that the claims gate covering this stays green; maintains release records so any shipped artifact can be traced to the revision and the gate run that cleared it. |
| Authority | Holding a release; requiring a proof or gate run before go; classification proposals. |
| Cannot approve alone | Reclassifying a surface or otherwise widening launch scope — that is an owner decision record under DR-005; shipping with a failing gate; any public claim about a released surface. |
| Inputs | Launch profile; preflight and breadth results; `pnpm --filter @workspace/api-server run test:api` results; the merge policy classification; pilot readiness criteria. |
| Outputs | Go/no-go records with evidence; the classified launch profile; release notes; the traceability record from artifact to revision. |
| KPIs | Surfaces with an explicit launch classification (target 100%, enforced by the launch profile gate); releases with a recorded go/no-go and its evidence (target 100%); buyer-facing claims asserting deferred capability (target 0, enforced by the claims gate); releases shipped with a known failing gate (target 0). |
| Activation trigger | Active now as a covered responsibility — it engages whenever a surface is added to or reclassified in the launch profile. Converts to a dedicated role at the first release to a party outside the company. |
| Current coverage | Mechanically enforced today by the launch profile gate, preflight, the claims gate, and the merge policy. The agent roster declares a `release-engineer` lane and a go-to-market `launch-manager` lane; **neither has ever been activated**, which `check-org-roster.mjs` reports on every run. Scope itself is frozen by DR-005, so the classification workload is currently low. |
| Human / fractional / AI-supported | AI-supported (gates plus lanes), CEO-accountable. |
| Hiring priority | 4 |
| Required competencies | Release management with hard entry criteria; versioning and compatibility discipline; the willingness to hold a release. |
| Customer/security implications | This is the control that keeps a demo-only or deferred surface from being sold as shipping. It is the single most direct defense against the over-claim shape that has already been caught on the public site. |

### Change management & merge governance lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance |
| Mission | Make every change to a controlled surface classified, reviewed at the right depth, and reversible. |
| Responsibilities | Owns the change classification policy and its risk tiers (`docs/GREEN_YELLOW_RED_MERGE_POLICY.md`), including the rule that a protected-wording match demotes a lane out of the fast path even when it looks like disclaimer text; defines which surfaces are controlled — decision core, gates, guard registries, sync manifest, launch profile, connector families — and what review each requires; owns the multi-lane collision protocol so parallel sessions do not independently implement the same shared surface (`docs/LANE_COORDINATION.md`); requires a reversal path on every non-trivial change and records it in the decision record; owns emergency-change handling: what may move fast, and what record it owes afterward. |
| Authority | Assigning a change's risk tier; requiring additional review; blocking a merge pending evidence. |
| Cannot approve alone | Bypassing a required review or gate; merging a red-tier change; changing what the decision core does; scope. |
| Inputs | Pull requests and their gate results; automated review findings; lane messages; the sync manifest; decision records. |
| Outputs | Change classifications; the controlled-surface register; merge decisions with rationale; the emergency-change log. |
| KPIs | Changes to controlled surfaces carrying a recorded classification and review (target 100%); merges that bypassed a required gate (target 0); cross-lane collisions on shared surfaces (target 0 — one has occurred, an 8-file reconciliation, which is why the protocol exists); changes without a stated reversal path (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role when more than one human commits to the repository, or when emergency changes exceed one per month. |
| Current coverage | AI-covered via agent roster lanes: `principal-engineer` (activated 2026-08-19, holds delegated authority for reversible technical calls and writes the decision records), `security-engineer`, and `devex-tooling-engineer`, on top of the committed merge policy, per-push CI, the pre-push lockfile hook, and an independent automated review bot on every pull request. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | - |
| Required competencies | Change control in a continuously delivered codebase; risk tiering that is proportionate rather than uniform; conflict resolution across parallel work streams. |
| Customer/security implications | Uncontrolled change to the decision core is how a fail-closed system quietly becomes fail-open. The tiering exists so security-relevant surfaces get depth while documentation moves quickly. |

### Incident postmortem & continuous improvement lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance |
| Mission | Convert every failure into a written cause and a change that would have caught it. |
| Responsibilities | Runs blameless postmortems on failures that reached a gate, a release, or the owner, and writes the cause rather than the symptom; maintains the incident and near-miss register, including gate escapes — defects that shipped past a check that should have caught them; requires each postmortem to name the specific control that would have prevented recurrence, and tracks it to closed; feeds recurring causes into process improvement and into the standing rules that live where the next contributor will read them; reviews whether a written rule actually held, since several have had to be re-learned mechanically after being documented and ignored. |
| Authority | Calling a postmortem; setting its scope; declaring a corrective action insufficient. |
| Cannot approve alone | Closing an action without evidence; attributing cause to a person; changing a gate as part of a fix. |
| Inputs | CI and scheduled-verification failures; review findings; regression tracking issues; owner-reported problems; near-miss reports from lanes. |
| Outputs | Postmortem records with cause and corrective action; the incident and near-miss register; recurring-cause analysis; rule changes at the point of use. |
| KPIs | Qualifying failures with a written postmortem within 5 business days (target 100%); corrective actions closed with committed evidence (target 100%); repeat incidents sharing a cause with a closed action (target 0); documented rules that had to be re-enforced mechanically after being written (tracked, target falling). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role at the first incident affecting a party outside the company, or when the register carries more than five open corrective actions. |
| Current coverage | Practiced but not registered. Causes are currently written into `CLAUDE.md` and decision records — the bash 3.2 empty-array abort, the lockfile re-divergence that produced the pre-push hook, the ungitignored iOS build output that stamped results as minted from a dirty tree — and the scheduled verification lane opens a tracking issue on regression. AI-covered via the `qa-engineer` and `sre` lanes. **No incident register exists**, so postmortems are discoverable only by reading the documents they landed in. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | - |
| Required competencies | Blameless postmortem facilitation; cause analysis that reaches the mechanism; the judgment to prefer an enforced check over a written reminder. |
| Customer/security implications | Buyers in regulated settings ask how failures are handled, and answer quality depends on records existing. A register that starts after the first customer incident is a register that starts too late. |

### Indicator governance lead (KPI / KRI / KCI)

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance |
| Mission | Define the company's indicators so each one has an owner, a source, and a stated limit on what it can prove. |
| Responsibilities | Maintains the indicator set across the three families — performance, risk, and control effectiveness — with a named owner and a committed source command for each; enforces the doctrine that an indicator may raise the assurance a decision requires and may never, by itself, lower it or produce a grant (`docs/SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md`, asserted by `proof:kpi-kri-kci`); publishes denominators alongside every rate, and refuses a percentage whose base is unstated; reviews indicators for staleness and retires ones nobody acts on; keeps company indicators distinct from product decision inputs so a healthy rollup never leaks into a per-action verdict. |
| Authority | Indicator definitions, thresholds, and retirement; rejecting a metric with no source. |
| Cannot approve alone | Publishing an indicator externally; using an indicator as a control claim; changing what the product's decision path consumes. |
| Inputs | Gate and proof output; reliability SLIs; roster activation report; queue and request state; owner-supplied figures. |
| Outputs | The indicator register with owners, sources, and limits; periodic indicator review; retirement records. |
| KPIs | Published indicators traceable to a committed command or artifact (target 100%); rates published without a denominator (target 0); indicators with no named owner (target 0); indicators unreviewed for more than 90 days (target 0). |
| Activation trigger | Active now as a covered responsibility for product-side indicators. Converts to a dedicated role when the first company-level indicator is reported to anyone outside the company. |
| Current coverage | The doctrine and its proof exist and run in CI; the company-side register does not. No company-level KPI, KRI, or KCI has an assigned owner today — the indicators in this catalog are the first proposed set. AI-covered via the `performance-engineer` and `sre` lanes for the measurement side. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | 6 |
| Required competencies | Metric design that survives contact with incentives; statistical honesty about coverage and base rates; familiarity with control-effectiveness measurement. |
| Customer/security implications | Indicators are the shape most likely to be mistaken for assurance. Logging coverage healthy is not this event was captured, and EDR installed is not this device is safe right now; the doctrine exists so a favorable rollup never becomes an unearned grant. |

### Service management lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance (COO when active) |
| Mission | Run the company's own service disciplines — request intake, operational state, and internal objectives — so operations are observable rather than remembered. |
| Responsibilities | Owns request and work intake across lanes, including the cloud-to-Mac verification request loop and the lane mail channel, where a refusal or a skip never closes a request and pending is reported on every run; owns internal service objectives and error budgets (`docs/RELIABILITY_SLO.md`), including the fail-closed integrity objective that has no budget at all; maintains the operational state of the estate — which watchers run, at what cadence, and which holes are known and stated; runs the internal service catalog: which environments and stacks exist, who operates them, and how each is validated; keeps operational documentation accurate about what is automated and what waits on a human lane. |
| Authority | Intake structure and routing; internal service objectives and their review; declaring a request unfulfilled. |
| Cannot approve alone | Any external service commitment; changing a fail-closed objective; scope; releasing evidence outside the publication boundary. |
| Inputs | `artifacts/sim-requests/` and `artifacts/sim-results/`; `artifacts/lane-messages/`; CI, scheduled verification, and Mac lane results; reliability SLIs. |
| Outputs | The request register and its pending report; internal objective and error-budget reports; the watcher and cadence map with known holes named; the internal service catalog. |
| KPIs | Requests closed with a committed result carrying provenance (target 100%); requests pending more than 7 days (reported every run, target falling); fail-closed integrity violations (target 0, zero-tolerance — no error budget); watchers whose last run is unknown (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role at the first hosted deployment operated for a party other than the company itself. |
| Current coverage | AI-covered via agent roster lanes: `sre` (activated 2026-08-19) and `mac-lane-steward` (activated 2026-08-21, the standing cloud-to-Mac loop duty), with `check-sim-requests.mjs` and `check-lane-messages.mjs` reporting owed work on every run. Two holes are stated rather than smoothed: the estate scan is on-demand because CI has one checkout, and the Mac lane runs at human cadence by design. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | 7 |
| Required competencies | Service management practice; operational instrumentation; the discipline to report a queue rather than assert it is empty. |
| Customer/security implications | Internal objectives are not customer commitments, and this role must never let one be presented as the other. No service-level agreement is offered to anyone today. |

### Records & document control lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | COVERED |
| Reports to | Head of quality & operational governance |
| Mission | Make sure the company's records are findable, current, and honest about their own age. |
| Responsibilities | Owns document control: what is canonical, what is superseded, and what is archived with a tombstone rather than deleted; captures owner inputs and decisions into durable records so nothing lives only in a chat scrollback; runs staleness detection — a document describing a state the tree has left is a defect, and pinned counts in prose are the specific shape that rots; maintains provenance rules for records of execution, including that working-tree cleanliness is sampled before a run, not after, so the field answers what code produced this result; owns retention and the publication boundary between internal records and anything releasable. |
| Authority | Canonical-versus-superseded status; requiring a tombstone; flagging a document stale. |
| Cannot approve alone | Deleting a record; releasing a record outside the publication boundary; changing a decision record's content after ratification. |
| Inputs | Owner inputs in any format; decision records; document index; freshness-check output; the publication boundary check. |
| Outputs | The canonical document index; supersession and tombstone records; the intake ledger; retention rules. |
| KPIs | Documents reachable from an index (target 100%; orphan count currently tracked and non-zero); documents contradicted by a committed gate or proof (target 0); owner inputs with no recorded disposition (target 0); records of execution with unusable provenance (target 0). |
| Activation trigger | Active now as a covered responsibility. Converts to a dedicated role when records must be produced for an outside party — diligence, procurement, or an assessment. |
| Current coverage | Partly mechanical, partly unowned. `docs/INTAKE_LEDGER.md`, `docs/DECISION_RECORDS.md`, and the freshness and cited-path checks cover parts of it; the agent roster's `records-archivist` lane is **declared and has never been activated**, and the docs corpus has a known orphan list and a stale entry-point document recorded in `docs/COMPANY_BUILD_PLAN.md`. |
| Human / fractional / AI-supported | AI-supported, CEO-accountable. |
| Hiring priority | 8 |
| Required competencies | Document control and retention practice; information architecture for a large corpus; skepticism toward any figure written in prose rather than computed. |
| Customer/security implications | Records are what an assessor reads. A stale document that over-describes the product is indistinguishable, from outside, from an intentional over-claim. |

### Business continuity & operational resilience lead

| Field | Value |
|---|---|
| Division | Quality & operational governance |
| Status | FUTURE |
| Reports to | Head of quality & operational governance (COO when active) |
| Mission | Make sure the company can keep operating, and can restore what it holds, when something is lost. |
| Responsibilities | Runs the business impact analysis: what the company holds, who depends on it, and how long each thing may be unavailable; owns recovery objectives and the restore procedures that meet them, including the rule that a backup nobody has restored is not a backup; schedules and records recovery exercises, and treats an unexercised procedure as untested; maintains continuity plans for single-person dependency — the concentration risk of one founder holding every credential and approval; owns the succession and access-recovery plan for owner-only accounts and signing authority. |
| Authority | Exercise scheduling and scope; declaring a procedure untested; recovery objective proposals. |
| Cannot approve alone | Recovery objectives themselves; any continuity commitment to an outside party; changes to credential custody; scope. |
| Inputs | `docs/BACKUP_AND_RESTORE.md` and the restore proof; infrastructure and account inventory; incident register; owner-held account list. |
| Outputs | Business impact analysis; recovery objectives; exercise records with results; the continuity and succession plan. |
| KPIs | Recovery procedures exercised within the last 12 months (target 100%); restore exercises that verified integrity after restore, not just completion (target 100%); systems with an owner-only single point of access and no recovery path (target 0); recovery objectives with no exercise evidence (target 0). |
| Activation trigger | The company holds data belonging to a party other than itself — the first non-simulated deployment, or the first record written to a hosted ledger on behalf of anyone else. Neither has occurred. |
| Current coverage | Not held at company level. The product half exists and runs: `proof:backup-restore` seeds a ledger, backs it up, destroys the schema, restores, and re-verifies the hash chain on every pull request, and the role-split work proved the restore recreates the privilege posture rather than silently re-minting ownership. There is **no company continuity plan and no succession or access-recovery plan**; single-founder concentration risk is unmitigated and stated here rather than smoothed. |
| Human / fractional / AI-supported | Fractional at activation; AI-supported for exercise design and records. |
| Hiring priority | 6 |
| Required competencies | Continuity planning and impact analysis; recovery testing discipline; credential custody and succession design. |
| Customer/security implications | Continuity questions appear in every enterprise and public-sector security questionnaire. Answering them requires exercises that happened, and the honest answer today is that the product restore path is exercised and the company plan does not yet exist.

## Product

**Division output: choose the right product.**

Product strategy is founder-held and performed today. Product management is
covered by AI agent lanes plus the founder; no product manager has been hired.
The launch edge is frozen by owner decision DR-005 (`docs/DECISION_RECORDS.md`,
2026-08-20), which ratified the then-174 classifications of v4 in `scripts/launch-profile.mjs`
(v5 today, 180 classifications — read `LAUNCH_PROFILE_VERSION`; the launch set below is unchanged)
— three launch connector families (`graph`, `device-management-health`,
`local-authority`), three launch signal kinds, three launch app surfaces (the
API server, the operator console, `ios:EnterpriseShell`) — and closed with the
instruction "do not widen the product again now". Every role below inherits that
constraint: **no role in this division may widen a product claim.**

Hiring-priority numbers are this catalog's proposed sequence for the division,
not a commitment to hire and not a schedule. Role ≠ employee; capability ≠
headcount.

### Chief Product Officer / VP Product

| Field | Value |
|---|---|
| Division | Product |
| Status | ACTIVE |
| Reports to | Founder/CEO (Dan Fashauer holds both seats) |
| Mission | Decide what SignalGrid is and is not, and hold the launch edge fixed until a decision record moves it. |
| Responsibilities | Own product strategy and the frozen launch scope under DR-005; ratify or refuse every scope change through a dated entry in `docs/DECISION_RECORDS.md`; hold the precedence of the two design laws (`docs/EMBEDDED_UX_PRINCIPLE.md`, `docs/ADMIN_DESIGN_PRINCIPLE.md`); arbitrate when a proof result and a roadmap item disagree, in the proof's favor; approve what buyer-facing surfaces may state, against the claims gate; sequence the portfolio across Shared-Device Trust, Decision Platform, Integrations, and Enterprise/Admin. |
| Authority | Product scope, sequencing, and the definition of launch; reclassification of any entry in `scripts/launch-profile.mjs` by issuing a decision record; refusal of any feature that would put a SignalGrid surface in front of an end user. |
| Cannot approve alone | Security exceptions that lower assurance or relax a fail-closed path (independent company assurance must concur); regulated-vertical positions for healthcare or fintech (human compliance review, not optional); changes to agent-lane authority, repo access, or model/provider selection (AI/Agent Operations); any public statement of a partnership, certification, attestation, SLA, or customer (the underlying fact must exist first, and the claims gate is the check). |
| Inputs | `docs/BUILD_BACKLOG.md`; `docs/INTAKE_LEDGER.md`; proof and gate results from `node scripts/preflight.mjs` and `pnpm run verify:breadth`; lane inboxes (`pnpm run lane:inbox`); the agent roster's never-activated report. |
| Outputs | Decision records; launch-profile classifications; the product's one-sentence definition; the ranked division portfolio. |
| KPIs | Zero launch-scope widenings without a decision record; zero claims-gate failures on merged buyer-facing surfaces; every owner decision reaches a dated record within one working day. |
| Activation trigger | Active now. |
| Current coverage | Dan Fashauer, founder/CEO, performing this directly. DR-005 (2026-08-20) is the most recent exercise of the authority. AI-supported via the agent roster's `product-manager` and `positioning-messaging` lanes. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Endpoint and infrastructure domain depth; ability to read a proof result and a launch-profile classification and act on the difference; decision-record discipline; scope refusal under commercial pressure; enough platform literacy to distinguish what an app can do from what MDM or the OS must do. |
| Customer/security implications | This seat is the single point where product ambition can outrun evidence. Every over-claim a buyer or assessor would later catch originates here or is stopped here. It also owns the fail-closed posture as a product property, not an engineering detail. |

### Head of Product

| Field | Value |
|---|---|
| Division | Product |
| Status | COVERED |
| Reports to | Chief Product Officer / VP Product |
| Mission | Turn strategy into a ranked, evidence-backed build queue that the engineering and agent lanes can execute without re-litigating scope. |
| Responsibilities | Groom and rank `docs/BUILD_BACKLOG.md` against the frozen launch scope; keep the roadmap and the portfolio one artifact, not two; name stale entries and backlog-versus-ledger contradictions rather than carrying them; run intake disposition so every owner input reaches a ledger row; hold the boundary between "deferred" and "dropped" explicitly; brief the CPO on what a decision record must decide. |
| Authority | Ranking and re-ranking inside ratified scope; closing or merging backlog items that are stale, duplicated, or already shipped; the definition of "done" for a backlog row (a proof, not an assertion). |
| Cannot approve alone | Activating a deferred connector family, signal kind, or app surface; any change to the launch profile; any commitment of a delivery date to an external party; retiring a gate or proof to unblock a roadmap item. |
| Inputs | Owner instructions; agent-lane shift reports; proof and gate failures; `node scripts/check-lane-messages.mjs` and `node scripts/check-sim-requests.mjs` outstanding items. |
| Outputs | The ranked backlog; intake ledger dispositions; per-shift target lists; the roadmap view the founder reads. |
| KPIs | Every backlog row carries an owner role and a verifiable completion condition; zero contradictions between backlog and intake ledger at shift close; median age of an open priority-1 row trending down week over week. |
| Activation trigger | Covered and running now. Separates into a dedicated human role when more than one human writes to the backlog in the same week, or when the founder is no longer the ranking authority for two consecutive shifts. |
| Current coverage | AI-covered via agent roster: `product-manager` lane (`docs/agent/org-roster.json`, activated 2026-08-19 — backlog re-file, three owner-board contradictions corrected), with the founder as ranking authority. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 6 |
| Required competencies | Backlog hygiene under a frozen scope; reading gate output as product signal; writing acceptance conditions a machine can check; comfort saying "this is deferred" in public without softening it. |
| Customer/security implications | A backlog that drifts from the launch profile produces surfaces nobody classified, and unclassified surfaces are exactly where over-claims and unowned trust boundaries appear. |

### Shared-Device Trust PM

| Field | Value |
|---|---|
| Division | Product |
| Status | COVERED |
| Reports to | Head of Product |
| Mission | Own the Assist gate as the frontline worker's experience — which is to say, own the fact that they never see it. |
| Responsibilities | Own the verdict vocabulary (`allow` / `step_up` / `restrict` / `deny`) and the reason codes the host app renders in its own words; hold the embedded-UX law so no SignalGrid-visible end-user surface is added; own `ios:EnterpriseShell` as the reference shell for shared-device custody, badge, and session handoff; define the shared-device scenarios the simulator must reproduce (shift change, badge left in the reader, device passed between workers); keep the healthcare, municipal, and warehouse variants one product with different fixtures, not three products. |
| Authority | Reason-code naming and semantics; scenario coverage in the simulator fixture set; the host-app integration contract's ergonomics inside ratified scope. |
| Cannot approve alone | Any end-user-visible SignalGrid screen, login, or portal; any domain-safety behavior (patient lookup, clinical guidance, inventory correctness) — that belongs in host apps; changes to `DecisionEngine.swift` or `AppWorkflows.swift`, which are byte-faithful ports and off limits for behavior; a verdict semantics change without the Decision Platform PM and independent assurance. |
| Inputs | `docs/EMBEDDED_UX_PRINCIPLE.md`; simulator scenarios and `proof:*` results; `docs/FRONTLINE_CONTEXT_SIGNALS.md`; native-lane findings; whatever real frontline evidence the research role produces. |
| Outputs | Reason-code specification; shared-device scenario set; the host-app integration contract's product half; EnterpriseShell behavior specs written to sit *around* the ported engines. |
| KPIs | Every reason code maps to exactly one host-app message pattern and one fixture; zero end-user-visible SignalGrid surfaces in any shipped build; every named shared-device scenario has a passing proof. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a host application outside this repository integrates the gate and needs a counterpart for its own product team. |
| Current coverage | AI-covered via agent roster: `mobile-native-engineer` and `product-manager` lanes, with the founder deciding scope. The embedded-UX law is written down and enforced in review rather than by a person. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 7 |
| Required competencies | Frontline shift operations literacy; API-as-product thinking (the surface is a verdict, not a screen); restraint about UI; ability to specify behavior for a byte-faithful port without touching it. |
| Customer/security implications | Every reason code is a disclosure decision: it tells a host app why an action was held. Too specific leaks posture about the device or the person; too vague makes the host app's message useless. This role sets that line. |

### Decision Platform PM

| Field | Value |
|---|---|
| Division | Product |
| Status | COVERED |
| Reports to | Head of Product |
| Mission | Own the deterministic decision core and the `/v1` surface as a product an assessor could interrogate. |
| Responsibilities | Own the `/v1` decision API contract, its versioning policy, and the deprecation path; own the fixture set as product evidence — the proofs are what a buyer is being asked to trust; hold the determinism invariants (no wall clock, no randomness in a decision path) as product requirements rather than lint; own the performance envelope's product meaning, keeping the in-process bench and the HTTP load figures separately labeled; specify provenance and evidence freshness so a stale record reads as stale. |
| Authority | API contract shape inside ratified scope; fixture and scenario coverage priorities; which figures the product publishes and how they are labeled. |
| Cannot approve alone | Any clock, randomness, or network dependency entering a decision path; switching off, weakening, or exempting a gate; a latency or throughput number becoming a commitment (a threshold on shared infrastructure is a flaky gate, and figures stay reported, not promised); a breaking `/v1` change. |
| Inputs | `docs/CI_AND_VALIDATION.md`; `pnpm run review:invariants`; `proof:*` results; `pnpm run test:load` and `bench:decision-*` output; API contract audits. |
| Outputs | Versioned API contract; the fixture and scenario coverage plan; the evidence narrative (what each proof proves and what it does not); labeled performance figures. |
| KPIs | Every `/v1` route documented with its real response codes; zero determinism-invariant violations at merge; every published figure traceable to a named command and a dated run. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a second consumer outside this repository builds against `/v1` and the contract must be negotiated rather than declared. |
| Current coverage | AI-covered via agent roster: `api-contract-architect`, `principal-engineer`, and `performance-engineer` lanes, with the founder ratifying scope. Contract audits and the proof suite exist and run in CI today. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 9 |
| Required competencies | Technical PM depth: API design, versioning, determinism reasoning; ability to read a proof harness and tell coverage from theater; discipline about the difference between a measurement and a promise. |
| Customer/security implications | This role owns the evidence a security assessor will actually pull on. A proof that passes vacuously, or a figure quoted without its conditions, is a finding waiting to happen — and it fails the fail-closed doctrine at the level of the claim rather than the code. |

### Integrations PM

| Field | Value |
|---|---|
| Division | Product |
| Status | COVERED |
| Reports to | Head of Product |
| Mission | Decide which signal sources SignalGrid consumes, in what order, and what each one is honestly worth. |
| Responsibilities | Own the three ratified launch connector families (`graph`, `device-management-health`, `local-authority`) as products, not adapters; keep the deferred families visibly deferred everywhere they are named, including on buyer-facing surfaces; require a live shape check before any family's behavior is described in the present tense; specify how an unknown, missing, stale, or contradictory input raises assurance rather than lowering it, per family; own the connector deprecation and vendor-drift response path. |
| Authority | Sequencing within the ratified launch families; the acceptance bar for a family's fixtures; the wording that describes what a family observes and what it only infers. |
| Cannot approve alone | Activating any of the deferred families (a decision record plus a live shape check are required); describing a derived state as a wire fact; any vendor engagement, integration listing, or joint statement — no such relationship exists today and none may be implied; access to a vendor's live tenant data (AI/Agent Operations and independent assurance both concur). |
| Inputs | `pnpm run verify:breadth` (56 steps: 47 gates covering the 48 deferred families, 8 doctrine proofs, and `proof:decision-palette` — count the STEPS entries in `scripts/verify-breadth.mjs`, not this parenthetical); live shape-check records in `docs/*_LIVE_SHAPE_CHECK.md`; `docs/SIGNAL_SOURCE_CATALOG.md`; domain-lead findings. |
| Outputs | Connector roadmap inside ratified scope; per-family honesty notes (observed versus derived); the deferred-family register as it appears publicly. |
| KPIs | Zero deferred families described in the present tense on any buyer-facing surface; every launch family has at least one live shape check on record; every family's unknown-input path has an explicit counterexample. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a deferred family is activated by decision record, or when a second launch family requires a vendor-specific certification or review process to proceed. |
| Current coverage | AI-covered via agent roster: the six signal-domain lanes (identity, endpoint/UEM, security operations, network, physical/OT, ITSM) plus `product-manager`. The `network-domain` lane's live RADIUS work is the pattern — it found that a quarantined device still receives an `Access-Accept`, so `quarantined` is always derived, never reported. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 8 |
| Required competencies | Identity, endpoint management, and network protocol literacy; ability to read a vendor API and tell a reported fact from a customer-configured label; skepticism toward vendor documentation as evidence. |
| Customer/security implications | Connectors are where trust enters the system. A family that grades an unverified input as affirmative hands out access the customer never authorized, and it does so silently — which is why every unknown-input path needs a counterexample rather than a test that passes. |

### Enterprise & Admin PM

| Field | Value |
|---|---|
| Division | Product |
| Status | COVERED |
| Reports to | Head of Product |
| Mission | Own the operator and administrator experience: the surfaces where a customer's IT team configures, reviews, and proves the gate's behavior. |
| Responsibilities | Own the operator console (a ratified launch surface) against the admin design law — progressive disclosure, only necessary data, one source of truth; own the tenant administration model, including what an admin can see across a boundary and what they cannot; own the evidence and audit views an assessor would be shown; own the setup path (which grants a customer's IT team must issue, in what order, and what the product can answer before each one lands); own admin-side terminology so one object has one name everywhere. |
| Authority | Console information architecture and default views; admin workflow sequencing; which numbers appear on which surface, inside ratified scope. |
| Cannot approve alone | Any cross-tenant visibility change (independent company assurance must confirm the boundary is real, not asserted); any claim about on-device enforcement (an app cannot restrict other apps, grant device access, or self-kiosk — that requires a supervised device under MDM); any admin action that could relax a fail-closed default; retention or export of customer audit data (compliance review). |
| Inputs | `docs/ADMIN_DESIGN_PRINCIPLE.md`; `docs/ADMIN_FLOWS.md`; `docs/PILOT_SCOPE_SKELETON.md`; control-plane contract; audit-ledger capabilities. |
| Outputs | Console specifications; the admin setup path; the tenant administration model; the assessor-facing evidence view. |
| KPIs | Every console number reads from one source and means the same thing on every surface; an administrator can answer "why was this action held" without leaving the console; zero admin surfaces presenting a deferred capability as configurable. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a tenant administrator outside the founder's own accounts configures a flow in the operator console. |
| Current coverage | AI-covered via agent roster: `web-engineer` and `solutions-architect` lanes plus the founder; the admin design law is written down and enforced in review. No external administrator has configured the console. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 9 |
| Required competencies | Enterprise IT administration experience (MDM, IdP, directory); multi-tenant permission modeling; audit and evidence presentation; the judgment to leave data off a screen. |
| Customer/security implications | The console is where tenant boundaries become visible or leak. It is also the surface an assessor sees first, so anything on it that cannot be proven becomes a credibility problem for everything that can. |

### Product Operations Manager

| Field | Value |
|---|---|
| Division | Product |
| Status | FUTURE |
| Reports to | Head of Product |
| Mission | Keep the product organization's operating record accurate: intake, decisions, releases, and what each shift actually produced. |
| Responsibilities | Run the intake-to-ledger loop so no owner input is lost or silently dropped; keep decision records complete, dated, and traceable to their source wording; run the release-note and change-communication path; maintain the portfolio view across divisions; measure the product process itself (cycle time, rework, stale rows) and report it without flattering it. |
| Authority | Process mechanics: templates, cadence, ledger and record hygiene; declaring a record incomplete and returning it. |
| Cannot approve alone | Product scope or ranking; any external communication of a roadmap; retiring a record or ledger row. |
| Inputs | Owner inputs; shift reports; decision records; lane messages and simulation-request status. |
| Outputs | Ledger and record hygiene reports; release notes; the portfolio view; process metrics. |
| KPIs | 100% of owner inputs dispositioned to a ledger row within one shift; zero decision records missing their reversal condition; stale-row count trending down. |
| Activation trigger | Activates when two or more humans write to the product backlog in the same week, or when open intake-ledger rows exceed the count one coordinating session can disposition in a shift for two consecutive weeks. |
| Current coverage | Not staffed. Partially covered today by the `program-manager` and `records-archivist` agent lanes — the archivist lane's own roster entry states it is effectively continuous and performed by the coordinating session, and should become a distinct role only if intake volume outgrows one session. That is precisely this role's trigger. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 10 |
| Required competencies | Operating-cadence design; records discipline; measurement of process without vanity metrics; comfort reporting a bad number unchanged. |
| Customer/security implications | Provenance is a product property here. A record that cannot say what produced it, or an input that vanished between a message and a decision, undermines the same evidence chain customers are asked to rely on. |

---

## Product design & research

**Division output: make the product understandable and usable.**

Design has real, shipped ground to stand on. A design system exists in two
places and is kept in sync deliberately: `native/ios/EnterpriseShell/Services/DesignSystem.swift`
(SG tokens, `SG.sans` / `SG.mono` / `SG.monoDigits` scaling through
`UIFontMetrics`) and the web token set in `artifacts/signalgrid-web/src/index.css`.
Accessibility work is real rather than planned: Dynamic Type is wired through
the type ramp, and the decision-state palette is contrast-measured against both
`SG.background` and `SG.card` in both appearances. The `deny` state was re-toned
under DR-005 to `#C67070` dark / `#8A3F3F` light — measured at 5.05:1 and 4.55:1
dark, 6.50:1 and 7.33:1 light, replacing a 3.18:1 pairing on card that was the
weakest contrast in the system on its most safety-critical state.

The once-unfinished part is stated as plainly: raw `UIFont.systemFont` /
`monospacedSystemFont` calls outside `DesignSystem.swift` in
`native/ios/EnterpriseShell` stand at 0 as of 2026-09-06 (18 on 2026-08-21), and
`scripts/check-ios-dynamic-type.mjs` gates the next one in preflight and CI.
Hiring-priority numbers below are this division's proposed sequence, not a commitment.

### Head of Design

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | COVERED |
| Reports to | Chief Product Officer / VP Product |
| Mission | Make an invisible product legible — to the worker through their own app, and to the operator through one coherent console. |
| Responsibilities | Own the visual and interaction language across the iOS shell, the operator console, and the marketing site as one system; hold the two design laws and resolve conflicts between them; own the decision-state palette as a safety surface, not a brand surface; approve token changes and require they land on every rendered surface in one change, never one platform at a time; set the evidence bar for a design change (measured contrast, verified at accessibility text sizes, before it merges). |
| Authority | Token values, type ramp, component vocabulary; the visual identity; refusal of any design change that lands on one platform only. |
| Cannot approve alone | Any change to what a verdict color means; any end-user-facing SignalGrid surface (the embedded-UX law forbids it); brand claims on buyer-facing surfaces (positioning and the claims gate); a contrast exception below WCAG AA on a decision state. |
| Inputs | `docs/BRAND_CONTRAST_FINDING.md`; both design law documents; measured contrast ratios; accessibility findings; the console and shell surfaces themselves. |
| Outputs | The token set in both trees; the component vocabulary; design decision records with measured ratios; review verdicts on user-facing changes. |
| KPIs | Zero token forks between the iOS and web trees at merge; every decision-state pairing measured at or above 4.5:1 on every ground it renders on; every design change ships to all rendered surfaces in one commit. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a second designer contributes, or when a surface ships that no agent lane has design authority over. |
| Current coverage | AI-covered via agent roster: `brand-design` lane (activated 2026-08-20). Its recorded output is the DR-005 `deny` re-tone applied across `index.css` and `DesignSystem.swift` in one commit — a fork between the two was why an earlier attempt was reverted, which is why the one-commit rule is now written into the role. |
| Human / fractional / AI-supported | AI-supported today; human or fractional when the trigger fires |
| Hiring priority | 8 |
| Required competencies | Design systems across native and web; color science sufficient to reason about contrast ratios rather than eyeball them; restraint (this product's design law is mostly about what not to show); ability to write a design decision with its measurement attached. |
| Customer/security implications | The decision-state palette is the only place where a safety-critical outcome is communicated by color. A `deny` that fails contrast is a safety defect, not an aesthetic one — and color alone is never sufficient, so text and icon redundancy must survive every re-tone. |

### Product Designer

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | COVERED |
| Reports to | Head of Design |
| Mission | Design the operator and administrator surfaces so a busy person can tell, in one look, whether anything needs them. |
| Responsibilities | Design the operator console's default and drill-down views under progressive disclosure; design the interaction model for held actions, step-up prompts triggered inside host apps, and evidence review; design the EnterpriseShell screens that are not the ported decision path; prototype against real fixture data rather than placeholder content; specify empty, degraded, and stale states as first-class, since fail-closed means those states are common; verify every screen at default and at accessibility text sizes before handing off. |
| Authority | Screen-level layout and interaction inside the established token and component vocabulary; the default view of any admin surface. |
| Cannot approve alone | New tokens or components (Design Systems Lead and Head of Design); any surface that would be visible to an end user; presenting a deferred capability as configurable; a layout that requires fixed-height rows for text that must scale. |
| Inputs | `docs/ADMIN_DESIGN_PRINCIPLE.md`; `docs/LAUNCH_CONSOLE_WIREFRAMES.md`; fixture and simulator output; PM specifications; accessibility findings. |
| Outputs | Screen specifications and prototypes; interaction specs for held, stepped-up, and restricted actions; state inventories including degraded and stale. |
| KPIs | Every shipped screen verified at `accessibility-extra-large`; every screen has a specified empty, stale, and error state; zero screens where a number is recomputed rather than read from one source. |
| Activation trigger | Covered and running now. Becomes a dedicated human role at the first console surface that a non-founder operator uses in their own work, rather than in a demo. |
| Current coverage | AI-covered via agent roster: `web-engineer` and `brand-design` lanes, with the founder reviewing. Screens exist and are maintained; no human designer has worked on them. |
| Human / fractional / AI-supported | AI-supported today; human or fractional when the trigger fires |
| Hiring priority | 7 |
| Required competencies | Enterprise and operations tooling design; interaction design for exception-driven interfaces; prototyping against real data; Dynamic Type and responsive layout mechanics on both iOS and web. |
| Customer/security implications | A console that buries the one held action, or that shows a stale value as though it were current, causes an operator to act on a false picture. Calm-by-default only works if the exception is unmistakable when it arrives. |

### Design Systems Lead

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | COVERED |
| Reports to | Head of Design |
| Mission | Keep one design system across two codebases, so a token change cannot land on one platform and not the other. |
| Responsibilities | Own `native/ios/EnterpriseShell/Services/DesignSystem.swift` and the web token set as a single canonical system with two renderings; own the type ramp and its `UIFontMetrics` mapping; own the component vocabulary — outcome badge, approval chip, health dot — so one object behaves the same on every surface; keep every color defined for both appearances and never pin an interface style; build and maintain the mechanical checks that catch drift (contrast measurement, a lint rule banning raw system fonts outside the design system). |
| Authority | Token definitions and naming; the type ramp; component API and deprecation; rejecting a change that lands on one tree only. |
| Cannot approve alone | Decision-state color meaning or values (Head of Design, with measured ratios); removing a contrast check; any exception to the both-appearances rule. |
| Inputs | Measured contrast ratios; the two token trees; native and web lane findings; accessibility audit results. |
| Outputs | The canonical token set; the component library; drift checks and lint rules; migration notes when a token changes. |
| KPIs | Zero token forks between trees at merge; zero raw `UIFont.systemFont` / `monospacedSystemFont` calls outside `DesignSystem.swift` (0 as of 2026-09-06; 18 on 2026-08-21; gated by `scripts/check-ios-dynamic-type.mjs`); every color defined for light and dark. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when a third rendering target adopts the tokens (the desktop shell, or a host-app SDK component set), because two trees can be held by review and three cannot. |
| Current coverage | AI-covered via agent roster: `brand-design` lane, with `mobile-native-engineer` and `web-engineer` applying changes. The system is real and in use; the raw-font drift check is a gate (`scripts/check-ios-dynamic-type.mjs`, in preflight and CI) and the contrast measurement runs as `proof:decision-palette`. |
| Human / fractional / AI-supported | AI-supported today; human when the trigger fires |
| Hiring priority | 8 |
| Required competencies | Cross-platform design systems (SwiftUI/UIKit and CSS custom properties); contrast measurement; writing lint rules and checks rather than guidelines; migration discipline. |
| Customer/security implications | A forked token means two surfaces can disagree about what `deny` looks like. Consistency here is what lets an operator learn one vocabulary and trust it on every screen. |

### Accessibility Specialist

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | COVERED |
| Reports to | Head of Design |
| Mission | Make every surface usable at the settings real frontline users actually run, and prove it mechanically rather than by inspection. |
| Responsibilities | Hold WCAG AA (4.5:1) for decision colors against every ground they render on, in both appearances; own Dynamic Type end to end — scaling type, wrapping labels, minimum row heights expressed as `greaterThanOrEqualToConstant`; require verification at `accessibility-extra-large`, not at default size; own keyboard access, focus order, live regions, and reduced motion on the web console; convert repeated findings into checks (a lint rule, a contrast test, a screenshot run at large text) so the same defect cannot return; specify non-color redundancy for every decision state. |
| Authority | Blocking a user-facing change that regresses contrast, scaling, or keyboard access; the verification procedure for any UI change. |
| Cannot approve alone | A contrast exception on a decision state; shipping a surface unverified at accessibility text sizes; any claim of conformance to an accessibility standard on a buyer-facing surface — that requires evidence and review, and no attestation exists. |
| Inputs | `docs/BRAND_CONTRAST_FINDING.md`; measured ratios; simulator screenshots at large content sizes (`xcrun simctl ui booted content_size accessibility-extra-large`); web audit output. |
| Outputs | Measured contrast records; accessibility verification runs; lint rules and automated checks; remediation lists with concrete file and line references. |
| KPIs | Every decision-state pairing at or above 4.5:1 on `SG.background` and `SG.card` in both appearances; zero raw system-font calls outside the design system; every user-facing change verified at `accessibility-extra-large` before merge. |
| Activation trigger | Covered and running now — the roster's trigger is "any user-facing surface changes". Becomes a dedicated human or fractional role when a customer procurement process requires an accessibility conformance report, or when a surface ships that automated checks cannot evaluate. |
| Current coverage | Declared in the agent roster (`accessibility-specialist`) but not yet activated as its own lane; the accessibility work delivered so far was done by the `brand-design`, `mobile-native-engineer`, and `web-engineer` lanes — the Dynamic Type ramp, the `onDeny` foreground fix (white on the dark `deny` fill measures 3.53:1, so the foreground flips instead), and the web pass covering viewport, contrast, live regions, and reduced motion. No raw font calls remain outside the design system as of 2026-09-06 (eighteen on 2026-08-21; `scripts/check-ios-dynamic-type.mjs` gates it). |
| Human / fractional / AI-supported | AI-supported today; fractional human for any conformance report |
| Hiring priority | 7 |
| Required competencies | WCAG 2.2 AA in practice; iOS Dynamic Type and Auto Layout failure modes; VoiceOver and screen-reader testing; the habit of converting a finding into a check. |
| Customer/security implications | The verdict screens are the safety-critical ones. Truncation, overlap, or an unreadable `deny` at an accessibility text size is a safety defect on the exact surface that must never be misread — and each of those defects was invisible at default text size, which is why the verification setting is part of the role, not a preference. |

### UX Researcher

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | FUTURE |
| Reports to | Head of Design |
| Mission | Replace inferred beliefs about frontline shared-device work with observed evidence from people who do it. |
| Responsibilities | Observe real shared-device shifts — handoffs, badge behavior, what workers do when an action is held; test whether host-app messages driven by reason codes are understood in context; validate operator console comprehension with administrators who did not build it; separate findings by source strength and mark inferred claims as inferred; feed findings into the backlog as evidence rows, never as opinions. |
| Authority | Research method and participant criteria; declaring a product assumption unverified. |
| Cannot approve alone | Product scope changes; any research involving patient, worker, or customer data (compliance review and independent assurance both required, and for healthcare or fintech a human compliance review is mandatory); publishing any participant's identity or organization. |
| Inputs | Product assumptions in docs that no one has checked; the ICP and customer-research lane's public-evidence findings; host-app integration questions. |
| Outputs | Observed-behavior findings with source tiers; comprehension test results for reason codes and console views; a register of assumptions still unverified. |
| KPIs | Every buyer-facing product assumption is labeled observed or inferred; each research cycle closes at least one previously unverified assumption; zero findings published without their method and sample described. |
| Activation trigger | **No relationship exists today; this role activates when** an organization agrees to let SignalGrid observe or interview people doing shared-device frontline work, and the access is documented — or, earlier, when a product decision is about to be made on a buyer or worker assumption that no public evidence supports. |
| Current coverage | Not staffed and not covered. The closest thing today is the `icp-customer-research` agent lane, which is not yet activated and whose own roster entry records the honest state: every buyer claim in the docs is currently inferred from the product rather than from anyone who buys, and its first task is public-evidence research (vendor documentation, published case studies, job postings), with source tiers marked. No customer, pilot, or design-partner relationship exists. |
| Human / fractional / AI-supported | Human or fractional when the trigger fires; AI-supported for public-evidence synthesis today |
| Hiring priority | 6 |
| Required competencies | Field research in operational environments (clinical, municipal, warehouse); comprehension testing; source-tier discipline; research ethics and consent handling in regulated settings. |
| Customer/security implications | Research in healthcare and similar settings touches environments where privacy obligations apply to what is merely observed. Method, consent, and data handling need review before the first session, not after — and no research access may be described publicly as a relationship it is not. |

### Content Designer / UX Writer

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | COVERED |
| Reports to | Head of Design |
| Mission | Make the product's words say exactly what is true, in the fewest of them, on every surface a person reads. |
| Responsibilities | Own the reason-code phrasing SignalGrid hands to host apps, and the guidance host apps use to render it in their own voice; own console and admin copy, including error, empty, and stale states; own the terminology register so one object has one name across console, shell, docs, and site; keep the house idiom out of buyer-facing surfaces and maintain a glossary for the terms that stay; review copy against the claims gate before it merges. |
| Authority | Wording on product surfaces; terminology decisions; rejecting copy that overstates or that renames an existing object. |
| Cannot approve alone | Any statement implying a partnership, certification, attestation, SLA, or customer; describing a deferred capability in the present tense; changing what a reason code means (Shared-Device Trust PM); regulated-vertical wording (compliance review). |
| Inputs | Reason-code specifications; `docs/PUBLIC_MESSAGING_GUARDRAILS.md`; the launch profile's deferred register; claims-gate results. |
| Outputs | Reason-code phrasing and host-app rendering guidance; console copy; the terminology register and glossary. |
| KPIs | One name per object across all surfaces; zero claims-gate failures attributable to product copy; every reason code has an approved host-app message pattern. |
| Activation trigger | Covered and running now. Becomes a dedicated human role when the product ships copy in a second language, or when host-app partners need a maintained content contract rather than a document. |
| Current coverage | AI-covered via agent roster: `docs-writer` and `positioning-messaging` lanes. The positioning lane's roster entry records the live problem this role owns — multiple incompatible product labels in circulation, and public surfaces carrying retired ones — with a launch-claims gate as the mechanical fix. |
| Human / fractional / AI-supported | AI-supported today; human or fractional when the trigger fires |
| Hiring priority | 8 |
| Required competencies | Technical and interface writing in the Google developer style; terminology governance; writing for a product the reader never sees; the discipline to write "we cannot verify this" plainly. |
| Customer/security implications | Reason-code wording is a disclosure surface: it can leak device or person posture into a host app's UI. Copy is also where over-claims most often enter, and a public repository means a wrong sentence is a public wrong sentence. |

### Service Designer

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | FUTURE |
| Reports to | Head of Design |
| Mission | Design the whole path around the gate — enrollment, shift handoff, exception handling, and what a human does when the answer is no. |
| Responsibilities | Map the end-to-end service across device, worker, host app, operator, and IT, and name every point where a human must act; design the exception path when an action is held, including who resolves it and how fast; design the enrollment and decommission journeys for shared devices; design the operator escalation path so a held action never dead-ends; identify which parts of the path SignalGrid owns and which belong to the host app, MDM, or IdP, and keep that boundary visible. |
| Authority | Service blueprints and journey definitions; naming a gap in the path where no owner exists. |
| Cannot approve alone | Anything implying SignalGrid enforces on device (device restriction, non-removability, kiosk lock are MDM and OS capabilities requiring a supervised device); operational commitments about response times; changes to the product's scope boundary. |
| Inputs | Deployment and pilot documentation; operator workflows; UX research findings; MDM and IdP capability boundaries. |
| Outputs | Service blueprints; exception-handling designs; enrollment and decommission journeys; the ownership boundary map. |
| KPIs | Every held-action path terminates in a named human owner; every journey step attributed to the system that actually performs it; zero blueprint steps that assume a capability the platform does not grant. |
| Activation trigger | Activates at the first deployment where the path crosses more than one organizational role — for example, an IT administrator enrolls the device and a different operations owner handles held actions. No such deployment exists today. |
| Current coverage | Not staffed. Partially anticipated by the `solutions-architect` agent lane, which is not yet activated; its queued task is to turn `docs/PILOT_SCOPE_SKELETON.md` into a concrete reference architecture naming which grants a customer's IT team must issue, in what order. That is the service path's first half. |
| Human / fractional / AI-supported | Fractional or human when the trigger fires |
| Hiring priority | 9 |
| Required competencies | Service design in operational and regulated settings; enterprise IT process literacy; blueprinting across organizational boundaries; clarity about platform limits. |
| Customer/security implications | An exception path with no owner becomes an exception path with a workaround — usually a shared credential or a propped-open device. Designing the "no" is how a fail-closed product stays deployed instead of being disabled. |

### Design Operations

| Field | Value |
|---|---|
| Division | Product design & research |
| Status | FUTURE |
| Reports to | Head of Design |
| Mission | Keep design work reviewable, versioned, and mechanically checked as the number of contributors grows past one. |
| Responsibilities | Run the design review cadence and the handoff format between design and implementation; maintain the design file and asset system with the same versioning discipline the code has; keep the automated design checks running (contrast measurement, large-text screenshot runs, token drift) and visible; onboard new design contributors, human or agent, into the token system and the two design laws; track design debt as a list with owners rather than as a feeling. |
| Authority | Review cadence, handoff format, tooling choices inside the division; blocking a handoff that lacks its measurements. |
| Cannot approve alone | Token or component changes; anything that sends design assets or product screenshots to an external service (that is an owner decision and an AI/Agent Operations data-exposure question); tooling that would place customer or product data outside the repository. |
| Inputs | Design review outcomes; automated check results; contributor onboarding needs; the design debt list. |
| Outputs | Review cadence and records; handoff templates; check automation; the design debt register. |
| KPIs | Every user-facing change reviewed before merge with its measurements attached; automated design checks run on every relevant change; design debt register has an owner per row. |
| Activation trigger | Activates when more than one designer — human or a second dedicated agent lane — contributes to the same surface, or when design assets need to live somewhere other than this repository. |
| Current coverage | Not staffed. The function is currently absorbed by the `program-manager` agent lane's shift cadence and by the repository's existing review gates, which is sufficient for one design contributor and stops being sufficient at two. |
| Human / fractional / AI-supported | AI-supported today; human or fractional when the trigger fires |
| Hiring priority | 10 |
| Required competencies | Design operations tooling; versioning and review process design; automation of visual checks; onboarding documentation. |
| Customer/security implications | Design tooling is a data-exposure surface: screenshots of an operator console can contain tenant identifiers, device names, and decision history. Any external design service is a data-handling decision, not a convenience one.

## Engineering

**Measurable output: build the product correctly.** Leadership row: CTO / VP Engineering.

Nine roles cover the engineering capability list (architecture, backend, frontend, full-stack, API/SDK, iOS, Android, desktop, connector/integration, data/persistence, firmware/edge, release, developer experience, performance, test/QA automation, engineering management, technical leadership). Capability variants are named inside each role rather than split into separate headcount.

Today the division has no employees. Every engineering role except the manager role is performed by AI agent lanes registered in [`docs/agent/org-roster.json`](../agent/org-roster.json), with the founder reviewing and holding accountability. Where a lane is declared in the roster but has never been activated, this catalog says so; a declared-and-never-run role is a gap, not coverage.

Two scope rules bind every role below. First, launch scope is frozen by DR-005 (`docs/DECISION_RECORDS.md`): no role here may widen the ratified connector families, signal kinds, or app surfaces. Second, naming a vendor system as an integration target is not a claim of a relationship with that vendor — no such relationship exists today.

### Head of Engineering (CTO / VP Engineering)

| Field | Value |
|---|---|
| Division | Engineering |
| Status | ACTIVE |
| Reports to | Founder/CEO |
| Mission | Own that what ships is deterministic, provable, and inside the frozen launch scope. |
| Responsibilities | Sets technical direction and the shift sequence against `docs/COMPANY_BUILD_PLAN.md`; ratifies decision records with reversal conditions and holds the launch-profile edge so nothing widens without one; decides which gates block a push and which only report; holds final human accountability for anything an agent lane produces or merges; arbitrates cross-lane collisions under `docs/LANE_COORDINATION.md`; owns the engineering hiring sequence and each hire's trigger |
| Authority | Build sequencing; branch and merge policy; blocking-vs-reporting status of a gate; ratifying reversible technical decisions; assigning work to agent lanes |
| Cannot approve alone | Widening launch scope past DR-005; publishing anything externally; regulated-vertical compliance sign-off (HIPAA/SOC 2 require human compliance review, not an engineering call); spend and billing decisions; sending repository or tenant data to an external service; destructive git history operations |
| Inputs | Agent-lane output and findings; preflight, `verify:breadth` and proof results; the build plan and owner board; lane messages and simulation-request debt |
| Outputs | Decision records; the launch-profile classification set; merged `main`; hiring triggers; scope rulings |
| KPIs | Pushes that fail CI on a gate the local harness does not run, per month (target 0); share of decision-path merges carrying an executable counterexample (target 100%); scope changes made without a decision record (target 0) |
| Activation trigger | Active now. |
| Current coverage | Founder/CEO Dan Fashauer personally: sequencing, review, and every ratification. Execution is AI-covered via agent roster: principal-engineer, product-manager, devex-tooling-engineer, program-manager lanes and others. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Deterministic systems judgment; reading evidence instead of assertions; scope discipline under commercial pressure; endpoint and infrastructure domain knowledge; directing AI execution lanes while keeping named human accountability |
| Customer/security implications | This is the last human before a trust decision changes behavior. Fail-closed semantics, tenant boundaries, and honest status reporting are this role's accountability, not a downstream reviewer's. |

### Principal Engineer / Technical Architect

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Head of Engineering (CTO / VP Engineering) |
| Mission | Hold the architecture of the decision core and the published contracts so behavior stays deterministic and provable as surfaces are added. |
| Responsibilities | Owns decision-core architecture across `lib/signalgrid-core` and `lib/signalgrid-simulator`, including the rule that new logic goes around the byte-faithful ports rather than into them; owns the `/v1` and `/cp/v1` contract — envelope shape, idempotency, versioning, deprecation (API/SDK contract variant); owns persistence architecture — the audit ledger hash chain, migrations, export, restore, and the runtime/owner role split (data-persistence variant); writes decision records that carry evidence and a reversal path; sets and checks TS-simulator to Swift-port parity; reviews agent-generated code on any decision path before merge |
| Authority | Reversible technical decisions inside ratified scope; module boundaries and interface shape; dependency selection; whether a change belongs in the core or around it |
| Cannot approve alone | Behavior changes to `native/ios/EnterpriseShell/Services/DecisionEngine.swift` or `AppWorkflows.swift`; adding a connector family or signal kind to the launch profile; contract-breaking `/v1` changes; anything irreversible in tenant data or ledger history |
| Inputs | Build backlog; gate and proof failures; contract audits; lane messages; QA and security findings |
| Outputs | Decision records; architecture docs; the OpenAPI contract; migration and reversal plans |
| KPIs | Post-merge `/v1` contract defects per quarter (target 0); decision-path changes shipped with proof coverage (target 100%); `test:api` passed equal to total on every api-server change |
| Activation trigger | Responsibility is active now and agent-covered. The human hire (sequence position 2) activates at the first of: a decision that is irreversible in tenant data or a customer device fleet reaches the owner with no technical peer able to review it; a deployment is operated by anyone outside this repository; or the owner commits the hire. |
| Current coverage | AI-covered via agent roster: principal-engineer lane (activated 2026-08-19; produced DR-001..DR-003), api-contract-architect and data-persistence-engineer lanes (activated 2026-08-20). Founder reviews every decision record. |
| Human / fractional / AI-supported | AI-supported today; human hire planned (Founding Principal Engineer) |
| Hiring priority | 2 |
| Required competencies | Deterministic decision systems and fixture-backed design; API contract and versioning discipline; Postgres and append-only ledger integrity; TypeScript plus enough Swift to verify port parity; writing decisions down with a reversal path |
| Customer/security implications | Architecture decides whether the gate can fail open. Tenant isolation, ledger tamper-evidence, and the impossibility of a wall-clock or random input on a decision path are set here or nowhere. |

### Decision Core Engineer (backend and platform services)

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Principal Engineer / Technical Architect |
| Mission | Implement and maintain the deterministic decision path, the control-plane and decision APIs, and the audit ledger. |
| Responsibilities | Implements decision logic in `lib/*` behind fixtures, with no wall-clock or randomness on any decision path; builds and maintains `artifacts/api-server` — the `/v1` decision API and `/cp/v1` control plane — keeping `test:api` at full pass count and re-asserting neighbor routes when a route is added; owns the Postgres audit ledger: migrations, pagination, export, restore, and the non-owner runtime role; keeps fail-closed literal, so an unknown or unreachable signal raises assurance and never lowers it; keeps `pnpm run review:invariants` green as a condition of merge, not as cleanup |
| Authority | Implementation approach inside an agreed interface; fixture design; internal refactors that leave every gate green |
| Cannot approve alone | Any contract change visible to a client; new signal kinds or connector families; schema changes that drop ledger history; loosening, skipping, or path-filtering a gate |
| Inputs | Architecture decisions and contracts; backlog items; QA, security and performance findings; emulator scenarios |
| Outputs | Decision-core code and fixtures; API server routes; migrations and export tooling; proofs accompanying each change |
| KPIs | Nondeterminism findings on decision paths (target 0); `test:api` passed equal to total on every push; ledger chain-integrity proof green on every push across clean, short-of-floor and tampered states |
| Activation trigger | Active now and agent-covered. The human hire (sequence position 4) activates when decision-core and API queue depth exceeds what one reviewed lane lands in a week for two consecutive weeks, or when a deployment outside this repository needs a named owner reachable during business hours. |
| Current coverage | AI-covered via agent roster: principal-engineer, data-persistence-engineer and api-contract-architect lanes, with security-engineer reviewing auth seams. Founder reviews merges. |
| Human / fractional / AI-supported | AI-supported today; human hire planned |
| Hiring priority | 4 |
| Required competencies | TypeScript/Node services; Postgres schema and integrity work; HTTP contract design; property and fixture-based testing; discipline to add a counterexample with every behavior change |
| Customer/security implications | Owns the code path that returns allow, step_up, restrict, or deny. A silent pass here is indistinguishable from a working gate until an incident, which is why every failure mode needs an explicit counterexample. |

### Integration Engineer (connectors and device evidence)

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Principal Engineer / Technical Architect |
| Mission | Turn third-party device, identity and network systems into signals the decision core can trust, with every failure mode of each connector demonstrated. |
| Responsibilities | Builds and maintains connector families under `lib/*-connector` and `lib/integrations`, strictly inside the ratified launch set; keeps deferred families deferred — declared code arms do not activate without a decision record; builds emulator scenarios in `artifacts/connector-emulator` so unknown, stale, error and contradictory upstream responses each have a counterexample; documents each connector's freshness semantics and what its absence means for the gate; owns edge, dock and firmware surfaces and keeps hardware statements inside what a pre-production concept can assert (firmware/edge variant); verifies grant-producing and assurance-lowering paths adversarially with a harness that can itself be proven to fail |
| Authority | Connector implementation shape; emulator fixture design; retry, timeout and staleness handling within fail-closed rules |
| Cannot approve alone | Activating a deferred connector family or signal kind; any statement that a vendor integration is supported, certified, or represents a partnership or alliance; sending live credentials or tenant data outside a local run; claiming on-device enforcement from an unsupervised or simulated device |
| Inputs | Ratified launch profile; vendor API documentation; emulator scenarios; domain-lane findings; endpoint and identity signal models in `docs/` |
| Outputs | Connector implementations; emulator scenarios and fixtures; freshness and failure-mode documentation; live-lane verification records |
| KPIs | Launch-scope connectors with emulator scenarios for unknown, stale and error responses (target 100%); grant-producing paths carrying an explicit counterexample (target 100%); connector claims in docs without a backing proof (target 0) |
| Activation trigger | Active now and agent-covered. The human hire (sequence position 5) activates at the first deployment where a customer's own system must be connected by someone other than the founder, or when a fourth launch-scope connector family is ratified. |
| Current coverage | AI-covered via agent roster: endpoint-uem-domain, iam-domain, network-domain and secops-domain lanes, plus the security-engineer lane's connector trust sweeps. The firmware-hardware-engineer lane is declared in the roster and has never been activated — the firmware/edge variant is uncovered today. |
| Human / fractional / AI-supported | AI-supported today; human hire planned |
| Hiring priority | 5 |
| Required competencies | Endpoint management, identity and network telemetry APIs; OAuth and service-credential handling; designing emulators that reproduce partial and lying upstreams; skepticism toward vendor-reported state |
| Customer/security implications | Every connector is an inbound trust boundary. A connector that reports a device as healthy when it cannot actually tell is the failure mode this role exists to make impossible, and it must never be described to a customer as a vendor relationship. |

### Client Engineer (operator console and native shells)

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Head of Engineering (CTO / VP Engineering) |
| Mission | Build the surfaces people look at so they match the decision core exactly and behave like the operating system they run on. |
| Responsibilities | Builds and maintains the operator console and web artifacts under `artifacts/signalgrid-*` (frontend and full-stack variants); maintains the iOS apps in `native/ios` — EnterpriseShell and SignalGridMobile — putting new logic around the byte-faithful ported engines and never into them; maintains the Android and Tauri desktop surfaces and the parity claims made for them; holds accessibility as a build condition: Dynamic Type via the `SG` font metrics, wrap-capable rows, WCAG AA on decision colors against both backgrounds in both appearances, verified at `accessibility-extra-large`; keeps platform honesty in the interface so no screen implies the app can grant device access, restrict other apps, or self-kiosk without MDM on a supervised device |
| Authority | Interaction and layout decisions inside the design system; client-side state and rendering approach; simulator-only demo flags |
| Cannot approve alone | Behavior edits to the ported Swift engines; new user-visible product claims or capability copy; pinning `UIUserInterfaceStyle`; publishing screenshots, demos or recordings externally |
| Inputs | Decision-core contracts and fixtures; design tokens in `Services/DesignSystem.swift`; accessibility findings; the ratified launch app surfaces |
| Outputs | Operator console; iOS, Android and desktop builds; screenshot and parity evidence; accessibility fixes |
| KPIs | Decision-state colors at or above 4.5:1 on both background and card in both appearances (target 100% of states); raw `UIFont.systemFont`/`monospacedSystemFont` calls in EnterpriseShell (target 0); simulator-to-native parity proof green on every release candidate |
| Activation trigger | Active now and agent-covered. The human hire (sequence position 6) activates when an operator console is used daily by someone outside the company, or when two client platforms need feature work in the same week for two consecutive weeks. |
| Current coverage | AI-covered via agent roster: web-engineer lane (activated 2026-08-19; 14 findings, 8 applied). The mobile-native-engineer, desktop-engineer and accessibility-specialist lanes are declared and not yet activated — native and desktop work is done ad hoc by whichever lane the founder assigns, and that is a gap. |
| Human / fractional / AI-supported | AI-supported today; human hire planned |
| Hiring priority | 6 |
| Required competencies | Swift/UIKit and SwiftUI; TypeScript and modern web build tooling; platform accessibility APIs and WCAG measurement; restraint about what an unprivileged app can actually do on a managed device |
| Customer/security implications | The console is where an operator reads a decision. A label that truncates at an accessibility text size, or a deny state below contrast floor, is a safety defect on the most consequential state the product renders. |

### Product Security Engineer (embedded)

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Head of Engineering (CTO / VP Engineering), with a review line to the independent assurance function |
| Mission | Help each product group build safely from inside the loop — the first of the company's two security layers. |
| Responsibilities | Threat-models each new surface before it ships, including abuse of the agent lanes themselves; reviews auth and authz seams — session and tenant permissions, dual control, WebAuthn, admin-action audit; owns supply chain hygiene: pinned third-party actions, SBOM, dependency review, lockfile discipline, workflow permission scoping; drives adversarial trust testing of grant-producing and assurance-lowering paths, requiring a mutation self-test that proves the harness can fail; reviews agent-generated code for unreviewed dependencies, injected content and secret exposure |
| Authority | Blocking a merge on a finding with a concrete failure scenario; dependency pinning and permission scoping; requiring a counterexample before a path is considered covered |
| Cannot approve alone | Declaring any control satisfied for an external audience; accepting a residual risk; any certification, attestation or assessor-facing statement; regulated-vertical sign-off; being the only security review of its own work |
| Inputs | Design and contract changes; CI and script changes; dependency alerts; QA findings; connector trust sweeps |
| Outputs | Threat models; security findings with reproduction; hardening changes; SBOM and pinning updates; counterexample tests |
| KPIs | Grant-producing paths with adversarial counterexamples (target 100%); unpinned third-party actions in CI (target 0); median age of an open high-severity finding (target under 7 days) |
| Activation trigger | Active now and agent-covered. The human hire (sequence position 4, alongside the backend hire) activates when the product processes a real tenant's data outside the founder's direct control, or when an external security questionnaire is answered for the first time. |
| Current coverage | AI-covered via agent roster: security-engineer lane (activated 2026-08-19; SBOM token split, third-party action pinning plus `check-action-pinning.mjs`, connector-tier trust sweep). The threat-modeler lane is declared and not yet activated. Founder reviews. |
| Human / fractional / AI-supported | AI-supported today; human hire planned |
| Hiring priority | 4 |
| Required competencies | Application and API security; identity and authorization design; supply-chain security; adversarial test design including mutation testing; reviewing machine-generated code with suspicion |
| Customer/security implications | This layer sits inside the build loop and must never be the only layer. The independent questions — can we prove it, can this fail open, are tenant boundaries real, could evidence be stale, can provenance be manipulated, would an assessor believe it — belong to the CISO-side assurance function by design, and this role does not answer them about its own work. |

### Quality, Test and Performance Engineer

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Head of Engineering (CTO / VP Engineering) |
| Mission | Make the product's claims fail loudly — adversarial review, the proof suite, and performance numbers that are not flattering by omission. |
| Responsibilities | Reviews the newest and least-soaked surfaces adversarially, reporting only findings with a concrete failure scenario; owns the `proof:*` suite, scenario fixtures and the simulator scenarios that stand in for a database; owns the benches and the load/stress lane, and states the in-process versus over-HTTP gap rather than quoting the better number; keeps correctness gated while throughput, percentiles and the saturation knee stay reported, because a latency threshold on a shared runner becomes a switched-off gate; re-measures published baseline figures whenever the decision path changes, since no gate covers those numbers |
| Authority | Declaring a gate flaky and moving it from gated to reported; blocking a release candidate on a reproducible defect; defining the scenario matrix |
| Cannot approve alone | Removing a gate or path-filtering it away from part of its subject; publishing performance figures externally; changing a documented figure without a fresh measurement |
| Inputs | New and changed surfaces; proof and harness output; bench and load results; defect reports from other lanes |
| Outputs | Confirmed defects with reproduction; proofs and fixtures; bench and load result tables with their measurement conditions |
| KPIs | Defects found before merge versus after, as a ratio (trend upward); proofs with a mutation self-test demonstrating they can fail (target 100%); age of the oldest published performance figure relative to the last decision-path change (target: no figure older than the change it describes) |
| Activation trigger | Active now. |
| Current coverage | AI-covered via agent roster: qa-engineer lane (activated 2026-08-19; 5 confirmed defects including the freshness gate's NaN-date silent pass) and performance-engineer lane (activated 2026-08-19, standing baseline duty). Founder reviews findings before they change scope. |
| Human / fractional / AI-supported | AI-supported |
| Hiring priority | - |
| Required competencies | Adversarial test design; property, fixture and mutation testing; load generation and percentile statistics; the discipline to report a failing gate as failing |
| Customer/security implications | Evidence culture is the product's differentiator. A proof that cannot fail is worse than no proof, because it converts an untested path into a claimed one. |

### Developer Experience and Release Engineer

| Field | Value |
|---|---|
| Division | Engineering |
| Status | COVERED |
| Reports to | Head of Engineering (CTO / VP Engineering) |
| Mission | Keep the gate fabric trustworthy and every release reproducible from a clean tree. |
| Responsibilities | Guards the guards — preflight, the proof harness, the mutation guard, the preflight-to-CI parity checks — with the standing question of whether any gate is path-filtered away from part of its own subject; keeps the local harness and CI honest about their difference, so a branch cannot pass locally and fail on a gate the harness has no concept of; owns launch-profile mechanics, promotion tiers, packaging and version discipline (release variant); owns lockfile discipline and the pre-push hook, including the platform-binary dance that re-diverges a correctly regenerated lockfile; owns the cross-lane loop — simulation requests, committed results with pre-run provenance, and lane messages — so every result records which code produced it |
| Authority | Harness and tooling design; adding a gate; hook behavior; build and packaging mechanics |
| Cannot approve alone | Reclassifying a surface in the launch profile; disabling or narrowing a gate; force-push or history rewrite; cutting a public release |
| Inputs | Gate failures and CI logs; new proofs needing registration; lane messages and pending simulation requests; toolchain changes |
| Outputs | Preflight and harness updates; registered gates; release profiles and packaging; simulation results with provenance; sync manifests |
| KPIs | Gates demonstrated capable of failing via mutation (target 100%); branches that pass the local harness and fail CI, per month (target 0); simulation results minted from a dirty working tree (target 0) |
| Activation trigger | Active now. |
| Current coverage | AI-covered via agent roster: devex-tooling-engineer lane (activated 2026-08-19), mac-lane-steward lane (activated 2026-08-21, owns the cloud side of the cloud-to-Mac loop), and the sre lane for CI estate health. The release-engineer lane is declared and not yet activated — release discipline is currently carried by the launch profile and preflight rather than by a running lane. |
| Human / fractional / AI-supported | AI-supported |
| Hiring priority | - |
| Required competencies | CI/CD and monorepo tooling; shell portability including bash 3.2 constraints; build reproducibility and provenance; designing checks that cannot pass vacuously |
| Customer/security implications | Provenance is part of the product's evidence claim. A result stamped from a dirty tree, or a gate that passes because it never ran, breaks the chain between a claim and the code that supports it. |

### Engineering Manager / Technical Lead

| Field | Value |
|---|---|
| Division | Engineering |
| Status | FUTURE |
| Reports to | Head of Engineering (CTO / VP Engineering) |
| Mission | Hold delivery and people accountability for one product group once more than one engineer works in it. |
| Responsibilities | Staffs a stable cross-functional product group — product, design, engineering, QA and an embedded security counterpart — so work does not move by departmental handoff; sequences that group's queue against the build plan and reports slippage in the same week it happens; owns on-call rotation and keeps operational toil below half of the group's capacity; owns growth, feedback and performance conversations for its engineers; runs incident duties as assigned operational roles (Incident Commander, Operations Lead, Communications, Planning) rather than as permanent titles; represents the group in cross-group scope and interface decisions |
| Authority | Within-group prioritization and sequencing; rotation and load balancing; technical approach for the group's own surfaces |
| Cannot approve alone | Headcount, compensation or termination; scope changes to the launch profile; cross-group interface changes; publishing anything externally |
| Inputs | Build plan and group backlog; incident and on-call data; individual goals; cross-group dependencies |
| Outputs | Group plan and status; staffed on-call rotation; incident role assignments; performance and growth records |
| KPIs | Group cycle time from ready to merged (median, tracked monthly); operational toil as a share of group capacity (target under 50%); share of group changes landing with proof coverage (target 100%) |
| Activation trigger | A product group reaches four humans, or any engineer acquires a direct report — whichever comes first. Not before; a group of one or two is sequenced directly by the Head of Engineering. |
| Current coverage | Not covered, and not needed today: there are no engineering employees to manage. The founder sequences work directly; the program-manager lane runs the shift cadence and the product-manager lane grooms the queue. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Managing engineers in a regulated-buyer context; incident command; capacity and toil measurement; keeping a cross-functional group aligned without reintroducing handoffs |
| Customer/security implications | Once more than one person can change a decision path, review and on-call become organizational controls rather than personal habits. This role is where that transition is made explicit. |

## Security, trust & assurance

**Division output: make trust claims defensible.**

SignalGrid's product is a trust decision. That makes security an output of the
company, not a review stage at the end of one. The division is built in two
layers, and the separation is deliberate.

**Layer 1 — product-group security (embedded, inside the loop).** A security
engineer sits inside each stable product group (Decision Core; Device Evidence
& Connectors; Operator Experience; Platform & Trust) and helps the group build
safely: threat models on the design, secure defaults, review of the code that
carries the decision. This layer is measured by defects prevented, and it is
partisan — it wants the group to ship.

**Layer 2 — independent assurance (outside the loop).** The CISO side does not
help build. It asks six questions of anything the company says about itself:

1. Can we prove it?
2. Can this fail open?
3. Are tenant boundaries real?
4. Could our evidence be stale?
5. Can an attacker manipulate provenance?
6. Would an assessor believe this?

A role that answers all six for its own work is not independent. Layer 2 exists
so a "yes" has a source other than the person who wants it to be yes.

**Where the layers stand today.** Both are COVERED, not staffed. Layer 1 runs
through the `security-engineer` and `threat-modeler` lanes on the agent roster
(`docs/agent/org-roster.json`). Layer 2 is exercised mechanically rather than by
a person: every claim in the repository is expected to carry an executable
counterexample, and the gate estate is what currently asks the six questions —
`pnpm run review:invariants` (fail-closed and determinism invariants),
`pnpm run proof:grant-safety` (enumerated grant safety),
`pnpm run proof:db-role-split` (runtime is not the schema owner, proven both
directions on a real Postgres), `pnpm run proof:isolation-scope` (tenant
boundaries), `pnpm run guard:boundary` (the publication boundary — nothing
reaches this public repo unclassified, see `docs/PUBLICATION_BOUNDARY.md`),
`pnpm run proof:unsafe-claim` and `node scripts/check-known-false-claims.mjs`
(a claim that was disproved once cannot be restated). Cross-lane adversarial
review supplies the rest.

**What that coverage is not.** A gate estate is not an assessor, an attacker, or
an on-call responder. No penetration test has been performed by an external
party, no red-team engagement exists, and no security operations capability is
running. Those roles are recorded below as FRACTIONAL-when-engaged or FUTURE
with the condition that turns them on, and they are off today.

### Chief Information Security Officer (CISO)

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Own the independent assurance layer so that every security or trust statement SignalGrid makes in public survives an adversarial reading. |
| Responsibilities | Set the two-layer doctrine and keep layer 2 structurally independent of the groups it reviews; own the six assessor questions as a standing review applied to product claims, docs and evidence; own security architecture direction, the risk register and the accepted-risk record; approve or refuse public trust claims before they leave the repository; own incident authority and the declaration threshold; sponsor the security champions model inside product groups |
| Authority | Refuse a public security or trust claim; declare a security incident; require a proof or gate before a claim ships; set severity thresholds and remediation deadlines; accept a documented low risk within a stated boundary |
| Cannot approve alone | Widening launch scope beyond the DR-005 freeze; any statement of certification, attestation, partnership or customer; accepting a high or critical risk; engaging an external assessor or tester; changing the publication boundary in `docs/PUBLICATION_BOUNDARY.md`; anything with a cost or contractual commitment (owner-only) |
| Inputs | Threat models (`docs/PRODUCT_CORE_THREAT_MODEL.md`); gate and proof results; the control matrix (`docs/SECURITY_CONTROLS_MATRIX.md`); inbound customer security questionnaires; decision records (`docs/DECISION_RECORDS.md`) |
| Outputs | Risk register with owners and dates; ratified security doctrine; claim approvals and refusals on the record; incident declarations; the assurance position stated in `SECURITY.md` |
| KPIs | Number of public trust claims shipped without a linked executable proof (target 0); median age of the newest evidence backing an active claim; percentage of accepted risks carrying an owner, boundary and review date; number of claim refusals overturned by later evidence |
| Activation trigger | Accountability is active now, held by the founder. The role separates into a distinct person when any one of these is true: a second security-affecting engineer is hired; a signed customer agreement names a security officer; or an external assessment engagement is scoped. |
| Current coverage | Founder/CEO holds the accountability line. Day-to-day assurance is AI-covered via the agent roster (`security-engineer`, `threat-modeler` lanes) plus the proof and gate estate, which is what actually asks the six questions today. No person other than the founder currently holds security authority. |
| Human / fractional / AI-supported | Human (founder) + AI-supported |
| Hiring priority | 10 |
| Required competencies | Security leadership in a product company; threat modeling; evidence and assurance design; regulated-buyer security review (healthcare, municipal); the judgment to refuse a claim that is merely probably true |
| Customer/security implications | This is the role a customer's security team escalates to. If it is absent or captured by delivery pressure, the company's trust claims degrade to marketing, which for a trust gate is the whole product. |

### Head of product security (embedded security engineering)

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO (dotted line into each product group) |
| Mission | Put a security engineer inside each product group so unsafe designs are caught while they are still cheap to change. |
| Responsibilities | Embed a security counterpart in each product group and keep that person inside the group's loop, not appended to it; run secure design review on decision-path and connector changes; application security — input handling, authorization checks, secret handling, dependency choices in product code; run the security champions program so each group has a non-security engineer who owns the basics; keep the fail-closed and determinism invariants enforced rather than described; write the abuse cases that become fixtures |
| Authority | Block a merge on a security defect in the changed code; require a fixture or proof for a security-relevant behavior; set secure-coding standards for product code |
| Cannot approve alone | Its own group's public security claims (layer 2 reviews those); any exception to fail-closed behavior; production credential access; scope changes to the decision core ports |
| Inputs | Design docs and pull requests; threat models; abuse cases; connector specifications; findings from vulnerability and supply-chain work |
| Outputs | Design review records; security fixtures and proofs added to the gate suite; the champions roster; secure-coding standards for the repo |
| KPIs | Percentage of decision-path changes with a recorded design review; security defects found pre-merge vs post-merge; number of security behaviors asserted only by prose rather than by a proof (target 0) |
| Activation trigger | The first non-founder engineer joins a product group. Until then the responsibility exists and is agent-covered; there is no group to embed into. |
| Current coverage | AI-covered via agent roster: `security-engineer` lane, with `threat-modeler` on design review. Enforcement is mechanical — `pnpm run review:invariants`, `pnpm run proof:grant-safety`, `pnpm run proof:data-protection`, `pnpm run proof:access-governance`. |
| Human / fractional / AI-supported | AI-supported today; Human when triggered |
| Hiring priority | 7 |
| Required competencies | Application security in TypeScript and Swift; authorization modeling; connector and API security; writing tests that fail for the right reason; working inside a delivery team without becoming a gate |
| Customer/security implications | Determines whether the Assist gate's allow/step_up/restrict/deny path can be made to fail open by a code change. That is the single defect class the product cannot survive. |

### Security architect & threat modeling lead

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO |
| Mission | Define the trust boundaries, then keep the shipped system honest to them. |
| Responsibilities | Own the product threat model and re-run it when a boundary moves, not on a calendar; define tenant, signal-source and control-plane trust boundaries and where each decision is allowed to be made; own the zero-trust decision principles the core is built on; review architecture for fail-open paths, provenance manipulation and evidence staleness before code exists; keep the control matrix mapped to real enforcement rather than intent |
| Authority | Define trust boundaries and required controls at each; require a threat model before a new signal source or connector family is built; reject an architecture that cannot be proven fail-closed |
| Cannot approve alone | Adding a new external trust dependency; changing the decision core's deterministic contract; any architecture decision that widens launch scope |
| Inputs | Product and connector designs; signal source catalog; incident and near-miss findings; assessor and questionnaire pushback |
| Outputs | `docs/PRODUCT_CORE_THREAT_MODEL.md` and its updates; trust boundary diagrams; control requirements per boundary; architecture decision records |
| KPIs | Percentage of connector families with a current threat model; number of shipped trust boundaries with no corresponding proof (target 0); mean time from boundary change to threat model update |
| Activation trigger | Active now as a responsibility. It becomes a named human role when a second product group exists or when a connector family is built against a customer's production system. |
| Current coverage | AI-covered via agent roster: `threat-modeler` and `principal-engineer` lanes, anchored by `docs/PRODUCT_CORE_THREAT_MODEL.md` and `pnpm run proof:zero-trust-principles`. |
| Human / fractional / AI-supported | AI-supported |
| Hiring priority | - |
| Required competencies | Threat modeling (STRIDE or equivalent) applied to distributed decision systems; identity and device trust architecture; multi-tenant isolation design; the discipline to model the system that exists rather than the one described |
| Customer/security implications | A customer's assessor will test the boundary claims first. Boundaries that exist only in a diagram fail that test immediately. |

### Independent trust assurance engineer

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO |
| Mission | Try to break the company's own evidence, so an outsider is not the first to succeed. |
| Responsibilities | Apply the six assessor questions to every published claim and record the answer with a link to the check that produced it; attack the evidence chain itself — stale evidence, unreachable gates, vacuous passes, proofs that would stay green if the behavior were deleted; audit provenance for manipulability, including working-tree cleanliness and result attribution; verify tenant boundary claims against enumerated cases rather than samples; maintain the assessor package so an external reviewer gets the same picture the company has; keep the false-claims memory current so a disproved claim cannot return |
| Authority | Mark any claim unproven and require it be withdrawn or qualified; fail an evidence artifact for staleness or bad provenance; require a mutation test against any gate it does not trust |
| Cannot approve alone | Restoring a claim it previously refuted; changes to the gate registries; publication of an assessor package externally |
| Inputs | The full proof and gate estate; `artifacts/live-evidence/mac-run.json`; `docs/agent/FALSE_CLAIMS.json`; `docs/EVIDENCE_COVERAGE.md`; cross-lane review output |
| Outputs | Assurance findings with reproduction steps; `pnpm run guard:assessor-package` results; refuted-claim entries; mutation test results against gates |
| KPIs | Number of gates proven non-vacuous by mutation test, as a percentage of security-relevant gates; number of claims withdrawn after assurance review; age of the oldest evidence artifact still cited by a live claim; number of previously refuted claims that reappeared in tracked docs (target 0) |
| Activation trigger | Active now, performed mechanically. It becomes a funded human role at the first external security assessment or the first customer contract with an audit right — whichever comes first. |
| Current coverage | AI-covered plus gate estate: `pnpm run guard:assessor-package`, `pnpm run proof:self-audit`, `pnpm run proof:unsafe-claim`, `node scripts/check-known-false-claims.mjs`, `node scripts/check-memory-freshness.mjs`, `pnpm run guard:registries`, `pnpm run guard:mutations`, and `pnpm run scan:estate` across the wider repository set. Adversarial cross-lane review supplies human judgment; no independent human assurance reviewer exists today. |
| Human / fractional / AI-supported | AI-supported today; Human when triggered |
| Hiring priority | 8 |
| Required competencies | Audit and assurance thinking; test and gate design including mutation testing; provenance and supply-chain integrity; comfort disagreeing with the people who built the thing |
| Customer/security implications | This role decides whether "we can prove it" is true. Everything the sales and trust-center surfaces say rests on its answer. |

### Platform, cloud & identity security engineer

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO (embedded in the Platform & Trust product group) |
| Mission | Make the runtime, the identity plane and the tenant boundary safe by construction, not by configuration discipline. |
| Responsibilities | Cloud and infrastructure security — network egress control, container base and image hygiene, least-privilege service roles, infrastructure-as-code review; identity security for workforce and workload — session binding, token binding, step-up and passkey assurance, privileged access activation; database and persistence security including runtime/owner role separation and backup integrity; secrets and key management, rotation, and bootstrap credential handling; tenant isolation enforcement and the break-glass and dual-control paths |
| Authority | Set least-privilege baselines for infrastructure and service identities; block an infrastructure change that widens egress or grants standing privilege; require rotation after exposure |
| Cannot approve alone | Standing production access for any human or agent; disabling a dual-control path; cross-tenant data movement; changes to the break-glass procedure |
| Inputs | Infrastructure definitions; identity provider configuration; connector credential requirements; egress and posture check results |
| Outputs | Hardening baselines; identity and session security controls; rotation runbooks; isolation and privilege proofs registered in the gate suite |
| KPIs | Number of standing privileged credentials (target 0); percentage of privileged actions requiring dual control; time to rotate a credential after suspected exposure; number of tenant isolation cases proven by enumeration rather than sampling |
| Activation trigger | The first customer-facing environment that holds tenant data outside the founder's control. Today no such environment exists; the responsibility is exercised against the local and fixture-backed stack. |
| Current coverage | AI-covered via agent roster: `iam-domain`, `sre`, `data-persistence-engineer` and `security-engineer` lanes. Enforced by `pnpm run proof:isolation-scope`, `pnpm run proof:identity-risk`, `pnpm run proof:db-role-split`, `pnpm run proof:dual-control`, `pnpm run proof:break-glass`, `pnpm run guard:ungated-fetch`. |
| Human / fractional / AI-supported | AI-supported |
| Hiring priority | - |
| Required competencies | Cloud infrastructure security; identity protocols (OIDC, SAML, WebAuthn, SCIM) and their failure modes; database privilege design; secrets management; multi-tenant isolation testing |
| Customer/security implications | Tenant boundary and privileged access are the two questions every healthcare and municipal security review asks. Both are answered here or not at all. |

### Vulnerability management & software supply-chain engineer

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO |
| Mission | Know what the product is made of, know what is wrong with it, and close the gap on a clock. |
| Responsibilities | Maintain the software bill of materials and keep it derived from the build rather than typed; triage dependency and platform advisories against actual reachability, with severity-based remediation deadlines; secure the build and release path — pinned actions, reproducible builds, artifact provenance, lockfile integrity; run and act on scanning across code, dependencies, containers and infrastructure definitions; own the vulnerability disclosure intake described in `SECURITY.md` and route reports to a fix |
| Authority | Set remediation deadlines by severity; block a release on an unremediated critical vulnerability; require a dependency be removed or replaced |
| Cannot approve alone | Accepting a critical or high vulnerability past its deadline; adding a dependency that reaches the decision path; publishing an advisory or disclosure response |
| Inputs | Advisory feeds; automated dependency updates; scanner output; `artifacts/sbom`; build and release logs |
| Outputs | Current SBOM; triage records with reachability findings; remediation tickets with deadlines; release provenance records |
| KPIs | Median time to remediate by severity; percentage of build actions pinned to an immutable reference; percentage of shipped artifacts with a generated SBOM; count of dependencies reaching the decision path with an open high or critical advisory (target 0) |
| Activation trigger | Active now as an automated responsibility. It becomes a human role when the release cadence exceeds what triage-by-lane can clear inside the severity deadlines, measured as a rolling four-week breach of the critical remediation deadline. |
| Current coverage | AI-covered via agent roster: `security-engineer` and `release-engineer` lanes, with `pnpm run proof:vuln-scan`, `node scripts/check-action-pinning.mjs`, `artifacts/sbom`, automated dependency update triage, and the pre-push lockfile hook. |
| Human / fractional / AI-supported | AI-supported |
| Hiring priority | - |
| Required competencies | Vulnerability triage with reachability analysis; SBOM tooling and formats; CI/CD supply-chain hardening; coordinated disclosure handling |
| Customer/security implications | Regulated buyers ask for an SBOM and a remediation SLA in the questionnaire. The SBOM must be generated, and the deadlines must be ones the company has actually met. |

### Security operations & incident response lead

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | FUTURE |
| Reports to | CISO |
| Mission | Detect, contain and explain security incidents in a running service, and preserve enough evidence to say truthfully what happened. |
| Responsibilities | Build detection and alerting on the control plane, decision API and connector surfaces, tuned to the fail-closed model; run incident response using operational roles assigned at declaration time — Incident Commander, Operations Lead, Communications, Planning — not permanent titles; own containment and recovery procedures, including break-glass and credential rotation under duress; own forensic readiness — log retention, tamper-evident audit records, chain of custody for evidence; run post-incident review that produces a gate or a proof, not only a document; meet customer and regulatory notification timelines set by the compliance side |
| Authority | Declare and downgrade incident severity; contain by revoking credentials or disabling a connector; require preservation of evidence |
| Cannot approve alone | Customer or regulator notification content and timing; public statements about an incident; permanent architectural changes made under incident pressure; deleting or truncating audit evidence |
| Inputs | Telemetry and audit ledger; alerting; customer reports; vulnerability disclosures; connector and identity provider signals |
| Outputs | Incident records and timelines; containment actions; post-incident reviews with a linked gate or proof; forensic evidence packages |
| KPIs | Mean time to detect and to contain; percentage of incidents with a complete reconstructable timeline from tamper-evident records; percentage of post-incident reviews that produced an executable check |
| Activation trigger | The first production environment carrying a customer's data goes live, or the first paid deployment is signed — whichever is first. Neither has occurred. Until then there is no service to operate and no incident surface to watch. |
| Current coverage | Not covered as an operational function; there is no service under watch. The precursor work is AI-covered via the `secops-domain` and `sre` lanes: tamper-evident audit records (`pnpm run proof:audit-ledger`), observability integrity (`pnpm run proof:observability-integrity`), response accountability modeling (`pnpm run proof:response-accountability`), and the evidence model in `docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md`. |
| Human / fractional / AI-supported | Human when triggered; AI-supported for detection engineering and triage |
| Hiring priority | - |
| Required competencies | Detection engineering; incident command; digital forensics and evidence handling; log integrity design; writing incident communications that are accurate under time pressure |
| Customer/security implications | A shared-device trust gate failing in a hospital is a clinical continuity event, not only a security one. Detection and honest reconstruction are what let a customer decide whether to keep running. |

### Offensive security specialist — penetration testing and red team

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | FRACTIONAL |
| Reports to | CISO (engagement owner), with findings reported to Founder/CEO |
| Mission | Attempt to defeat the Assist gate and its evidence chain from the outside, under scope, and report what worked. |
| Responsibilities | Test the decision path for fail-open conditions under adversarial input, degraded signals and unreachable sources; attempt cross-tenant access and authorization bypass against the control plane and `/v1` surfaces; attempt provenance and evidence manipulation — forged signals, replayed attestations, tampered audit records; test the device and connector surfaces including session and token binding; deliver reproducible findings with severity and evidence, and retest after remediation |
| Authority | Set testing technique within the agreed rules of engagement; assign finding severity in its own report |
| Cannot approve alone | Anything — this is an engaged external role with no internal decision rights; scope, targets, timing and disclosure are set by the engagement agreement |
| Inputs | Signed rules of engagement and scope; architecture and threat model documents; test environment access; prior findings |
| Outputs | Penetration test report with reproducible findings; retest results; an attack narrative usable in customer security review |
| KPIs | Number of exploitable fail-open paths found; percentage of critical and high findings remediated and retested within the agreed window; number of findings that a repository gate should have caught but did not |
| Activation trigger | No relationship exists today; this role activates when the owner engages a named testing firm or independent tester under a signed scope and rules-of-engagement document, which is itself triggered by the first design-partner deployment handling real customer data. |
| Current coverage | Not covered. No penetration test, red-team exercise or external security assessment has been performed, and no tester is engaged. Internal adversarial work is limited to the proof estate and cross-lane review, which is not an equivalent substitute and is not described as one. |
| Human / fractional / AI-supported | Fractional (external, engaged per assessment) |
| Hiring priority | 5 |
| Required competencies | Application and API penetration testing; multi-tenant authorization testing; identity and device attestation attack techniques; clear reporting a small engineering team can act on |
| Customer/security implications | Enterprise and healthcare buyers ask for a recent third-party test report. Not having one is a factual answer today; claiming or implying one would be false. |

### Trust center lead (customer security assurance and security research)

| Field | Value |
|---|---|
| Division | Security, trust & assurance |
| Status | COVERED |
| Reports to | CISO |
| Mission | Give a buyer's security team a truthful, current and self-serve answer, and never let the answer outrun the evidence. |
| Responsibilities | Maintain the public trust surface — security posture, architecture, data handling, subprocessor position and current limitations, stated as they are; own the security questionnaire response pack and keep every answer traceable to a control or a proof; run the disclosure intake and researcher communication path described in `SECURITY.md`; publish security research and technical write-ups that are reproducible from the repository; keep public messaging inside the guardrails so no answer implies a certification, partnership, customer or service-level commitment that does not exist |
| Authority | Refuse or requalify any questionnaire answer that lacks evidence; set the public trust surface's structure and update cadence |
| Cannot approve alone | Any new public claim of certification, attestation, partnership, customer or availability commitment; publishing an incident description; releasing research that touches the private core |
| Inputs | Control matrix; proof and gate results; assurance findings; inbound questionnaires and buyer objections; `docs/PUBLIC_MESSAGING_GUARDRAILS.md` |
| Outputs | The public trust surface; `docs/SECURITY_QUESTIONNAIRE_PACK.md` and its answer library; disclosure responses; published research |
| KPIs | Median time to return a completed customer questionnaire; percentage of answers linked to a named control or executable proof; number of published statements later withdrawn as unsupported (target 0) |
| Activation trigger | Active now at low volume. It becomes a named human role when inbound security questionnaires exceed one per week, or when a buyer requires a hosted trust portal as a condition of evaluation. |
| Current coverage | AI-covered via agent roster: `compliance-analyst` and `docs-writer` lanes, bounded by `pnpm run proof:unsafe-claim`, `node scripts/docs-sanity.mjs` and the publication boundary gate. The founder approves every outbound claim. |
| Human / fractional / AI-supported | Human (founder approval) + AI-supported |
| Hiring priority | - |
| Required competencies | Technical security writing; questionnaire and assessment frameworks; translating engineering evidence into buyer language without inflating it; disclosure handling |
| Customer/security implications | This is the first security artifact a prospect reads. Overstating here converts a sales problem into a legal one. |

## Privacy, compliance & risk

**Division output: keep promises provable to assessors.**

Security decides whether the system is safe. This division decides whether the
company can *demonstrate* it — to a data protection authority, a customer's
audit team, an external assessor, or a court. The two divisions share the
independent-assurance posture and split on subject matter: security owns the
control, compliance owns the record that the control operated.

Three constraints govern everything below.

**Nothing here is a certification claim.** SignalGrid holds no certification,
attestation or audit report. No assessor, auditor or certification body is
engaged. Roles that describe SOC 2 or ISO 27001 work are *readiness* roles —
they build controls and evidence so that an audit could be scoped later. A
readiness posture is not an audit result and is never presented as one.

**AI assistance does not transfer regulatory assurance.** This company is built
with substantial AI assistance, and Claude Code does not guarantee HIPAA or
SOC 2 outcomes. Any control, policy or evidence artifact produced with AI
assistance requires human compliance review before it is relied on externally.
That review is a named responsibility below, not an assumption.

**AI governance lives here; AI operations lives elsewhere.** This division sets
the risk and accountability boundary for agent work — what agents may do, what a
human must approve, how AI incidents are handled, per the role-definition
guidance in the NIST AI Risk Management Framework. The AI, automation & data
division runs the lanes inside that boundary. The separation is the point: the
function that operates the agents does not certify them.

Today the division is COVERED by the `compliance-analyst` agent lane, the
founder's approval authority, and the gate estate. There is no privacy officer,
no auditor, no assessor and no vendor risk program in operation.

### Chief Risk & Compliance Officer

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Hold one accountable view of company risk and make sure every promise the company makes has a record behind it. |
| Responsibilities | Maintain the enterprise risk register — security, privacy, AI, regulatory, third-party and operational — with an owner and review date per entry; own the control framework and the mapping from obligation to control to evidence; set the compliance calendar and the readiness roadmap, and refuse to compress it into a claim; own regulated-vertical posture for healthcare, municipal and warehouse deployments, including where domain safety obligations sit with the host application rather than with SignalGrid; approve or refuse compliance-affecting commitments in customer paperwork; chair risk acceptance and record every accepted risk with its boundary |
| Authority | Accept a documented low or moderate risk with a stated boundary and review date; require a control before a commitment is signed; halt a compliance-affecting commitment pending review |
| Cannot approve alone | Any certification, attestation or audit claim; accepting a high or critical risk; contractual regulatory commitments such as a business associate agreement or data processing agreement; engaging an assessor; anything with a cost figure (owner-only) |
| Inputs | Risk submissions from every division; regulatory intelligence; customer contractual requirements; assurance and audit findings; decision records |
| Outputs | Enterprise risk register; control framework and obligation mapping; risk acceptance records; the compliance roadmap and its honest current position |
| KPIs | Percentage of register entries with a named owner and a review date not past due; number of external commitments made without a mapped control (target 0); percentage of high risks with a dated treatment plan |
| Activation trigger | Active now as an accountability line held by the founder, initially combined with the CISO and legal roles per `docs/company/ORG_STRUCTURE.md`. It separates into a distinct role at the first signed regulatory commitment (a business associate agreement, a data processing agreement, or a public-sector contract term). |
| Current coverage | Founder/CEO holds the accountability. Execution is AI-covered via agent roster: `compliance-analyst` lane, with `commercial-counsel` on contractual language. The control mapping lives in `docs/SECURITY_CONTROLS_MATRIX.md`. |
| Human / fractional / AI-supported | Human (founder) + AI-supported |
| Hiring priority | - |
| Required competencies | Risk management in regulated software; control framework design; healthcare and public-sector procurement obligations; the discipline to keep readiness and audit result separate in public language |
| Customer/security implications | Regulated buyers buy the record as much as the product. A risk register that is a document rather than a practice fails the first serious diligence review. |

### Privacy Officer / Data Protection Officer

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | FUTURE |
| Reports to | Chief Risk & Compliance Officer, with a reporting line to Founder/CEO preserved for independence |
| Mission | Keep personal data out of the system where possible, and accounted for where it is not. |
| Responsibilities | Maintain the data inventory and data flow map — what personal data enters the decision path, from which source, held how long, and why; enforce data minimization at design time, including the position that domain data such as patient identity belongs in host applications rather than in SignalGrid; run privacy impact assessments for new signal sources, connectors and verticals; own lawful basis, notice, retention and deletion positions, and the data subject request procedure; own the sub-processor register and cross-border transfer position; advise on breach assessment and notification thresholds jointly with incident response |
| Authority | Require a privacy impact assessment before a signal source ships; block collection of a data element without a stated purpose and retention period; set retention and deletion defaults |
| Cannot approve alone | New categories of personal or special-category data entering the decision path; cross-border transfer arrangements; breach notification decisions; contractual data protection terms |
| Inputs | Signal source catalog and connector designs; customer data protection requirements; regulatory developments; incident findings |
| Outputs | Data inventory and flow map; completed privacy impact assessments; retention schedule; data subject request procedure; sub-processor register |
| KPIs | Percentage of signal sources with a completed assessment and a stated retention period; number of personal data elements collected without a documented purpose (target 0); time to fulfil a data subject request against the statutory deadline |
| Activation trigger | Any one of: SignalGrid processes personal data of EU or UK data subjects as controller or processor under a signed agreement; a customer contract requires a named data protection officer or privacy contact; or the product begins handling protected health information under a business associate agreement. None has occurred. |
| Current coverage | Not covered as a role. Partially handled by design constraint rather than by a person: the embedded UX law keeps domain data in host applications, the decision core is fixture-backed, and `pnpm run proof:data-protection` asserts handling behavior. AI-covered for analysis via the `compliance-analyst` lane. No privacy assessments have been performed by a qualified human. |
| Human / fractional / AI-supported | Fractional first (external privacy counsel or DPO service), then Human |
| Hiring priority | 9 |
| Required competencies | GDPR and UK GDPR, HIPAA, and US state privacy law; privacy impact assessment practice; data mapping in event-driven systems; independence from the delivery organization |
| Customer/security implications | Frontline shared devices sit close to patients, residents and workers. Data that never enters the system needs no protection later; this role's main lever is preventing collection, not securing it. |

### Compliance engineering lead (controls as code and evidence management)

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | COVERED |
| Reports to | Chief Risk & Compliance Officer |
| Mission | Make each control produce its own evidence automatically, with a timestamp, so readiness is a measurement rather than a scramble. |
| Responsibilities | Implement controls as executable checks in the gate estate and map each one to the SOC 2 Trust Services Criteria and ISO/IEC 27001 Annex A controls it supports, without asserting either has been audited; run evidence management — collection, provenance, freshness, retention and retrieval, so an evidence artifact states what code produced it and when; keep the assessor package assemblable on demand from current sources rather than curated by hand; detect and flag stale evidence and vacuous checks before an assessor does; route every AI-assisted control or policy artifact through named human compliance review before external reliance; maintain readiness gap tracking with the honest current state of each gap |
| Authority | Fail an evidence artifact for staleness or missing provenance; require a control be expressed as an executable check before it counts as implemented; set evidence retention and refresh intervals |
| Cannot approve alone | Declaring a control effective without human compliance review; presenting readiness as an audit result; scoping an audit; publishing the assessor package externally |
| Inputs | Control framework and obligation mapping; gate and proof results; `artifacts/live-evidence/mac-run.json`; customer control requirements |
| Outputs | Control-to-check mapping; the assessor package; evidence freshness reports; readiness gap register with dates |
| KPIs | Percentage of framework controls backed by an executable check rather than a description; percentage of evidence artifacts with complete provenance and an age inside their refresh interval; number of controls marked effective without recorded human review (target 0) |
| Activation trigger | Active now. It becomes a funded human role when a customer contract requires an audit report or an assessment on a dated schedule, which is also the point at which AI-assisted evidence must be countersigned by a qualified human reviewer. |
| Current coverage | AI-covered via agent roster: `compliance-analyst` lane. Mechanically supported by `pnpm run guard:assessor-package`, `node scripts/check-memory-freshness.mjs`, `pnpm run guard:registries`, `pnpm run proof:audit-ledger` and `pnpm run verify:breadth`. Human review is the founder's, and the founder is not a compliance professional — this is the division's largest honest gap. |
| Human / fractional / AI-supported | AI-supported, with fractional human compliance review required before any external reliance |
| Hiring priority | 6 |
| Required competencies | SOC 2 and ISO/IEC 27001 control design; automation and CI engineering; evidence provenance and integrity; the ability to tell an implemented control from a described one |
| Customer/security implications | Evidence that cannot be regenerated on demand is evidence that will be stale on the day it matters. Automating collection is what makes a small company auditable at all. |

### Control assurance & audit coordination lead

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | FUTURE |
| Reports to | Chief Risk & Compliance Officer |
| Mission | Test that controls actually operated over a period, and run external assessments without disrupting delivery. |
| Responsibilities | Design and run control testing — sampling, operating effectiveness over a period, and exception handling — independent of the engineers who built the control; track findings and remediation to closure with dates and evidence of fix; coordinate external assessments end to end: scoping, evidence requests, walkthroughs, management responses, and the report's factual accuracy; run internal readiness assessments before an external one is scoped, so surprises are internal; manage the audit calendar and the internal control owners' obligations |
| Authority | Select samples and testing scope; record a control as ineffective; set finding severity and remediation deadlines |
| Cannot approve alone | Closing a finding without evidence of remediation; the content of management responses; audit scope changes; any public statement about assessment status |
| Inputs | Control framework and evidence store; assessor requests; prior findings; system changes affecting control design |
| Outputs | Control test results with sample evidence; findings register with remediation status; assessment coordination records; management responses |
| KPIs | Percentage of controls tested inside their scheduled window; number of findings closed without evidence (target 0); mean time from finding to verified remediation; number of assessor evidence requests answered from the existing evidence store rather than newly produced |
| Activation trigger | An external assessment is scoped with a named firm and a defined observation window, or a customer contract grants an audit right with a stated notice period. Neither exists. |
| Current coverage | Not covered. Internal readiness testing is AI-covered via the `compliance-analyst` lane and the gate estate, which tests controls continuously but is not independent of the lanes that built them — a limitation this catalog records rather than resolves. |
| Human / fractional / AI-supported | Fractional first (readiness consultant), then Human |
| Hiring priority | - |
| Required competencies | Internal audit and control testing methodology; SOC 2 and ISO/IEC 27001 assessment mechanics; findings management; running an audit without letting it consume an engineering team |
| Customer/security implications | An assessment that arrives with no internal testing behind it produces findings in front of the customer instead of before them. |

### AI risk & governance officer

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | COVERED |
| Reports to | Chief Risk & Compliance Officer |
| Mission | Keep a named human accountable for every action an AI agent takes on behalf of the company. |
| Responsibilities | Set the agent authority boundary — which lanes may change which repositories, which actions require human approval, and which are owner-only — and keep it enforced rather than documented; govern model and provider selection against data exposure, retention and residency terms, and record which provider handled what class of data; require and audit human review of AI-generated code and AI-generated policy or evidence artifacts before external reliance; govern evaluation and prompt or workflow versioning so a behavior change is attributable to a version; audit tool calls and agent activity for provenance, and treat unauthorized agent action as an AI incident with its own handling path; maintain the AI risk register aligned to the NIST AI Risk Management Framework's govern, map, measure and manage functions |
| Authority | Suspend an agent lane's access; require human review for a class of AI-produced output; refuse a model or provider on data exposure grounds; classify an AI incident |
| Cannot approve alone | Widening agent authority to a new repository or to production systems; provider or model changes with contractual or cost implications (owner-only); relying on AI-produced compliance evidence without qualified human review; disclosure of an AI incident |
| Inputs | Agent roster and its activation records; lane coordination protocol; review coverage ledger; tool-call and commit history; provider terms |
| Outputs | Agent authority matrix; AI risk register; evaluation results and prompt version records; AI incident records; human accountability mapping per lane |
| KPIs | Percentage of agent-authored changes to security or compliance surfaces with recorded human review; number of agent actions outside the declared authority boundary (target 0); percentage of lanes with a named accountable human; evaluation coverage of decision-affecting agent behaviors |
| Activation trigger | Active now — this is the function that governs the lanes currently building the company. It separates from the founder when agent lanes act against a customer-controlled environment, or when a customer contract requires disclosure of AI use in the delivery of the service. |
| Current coverage | Founder/CEO is the accountable human for every lane. AI-covered for execution via agent roster: `agent-ops-economics` lane. Enforced by `docs/LANE_COORDINATION.md`, `docs/agent/org-roster.json` activation gating (an activation must name an artifact), `docs/agent/review-coverage.json`, `pnpm run proof:agent-behavior` and `pnpm run proof:agent-identity`. The arrangement is partly self-referential — the lanes that run the company operate under a boundary those same lanes help maintain — and the founder's approval is the only external check today. |
| Human / fractional / AI-supported | Human (founder accountable) + AI-supported |
| Hiring priority | - |
| Required competencies | NIST AI RMF and comparable AI governance frameworks; model and provider risk assessment; evaluation design; software supply-chain thinking applied to generated code; clear-headedness about what an agent did versus what it reported |
| Customer/security implications | Buyers increasingly ask whether AI touched the code that makes their security decisions. The truthful answer is yes, and this role is what makes that answer safe to give. |

### Third-party & vendor risk manager

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | FUTURE |
| Reports to | Chief Risk & Compliance Officer |
| Mission | Know every outside party that can touch customer data or the decision path, and hold each to a stated standard. |
| Responsibilities | Maintain the vendor and sub-processor inventory with data classification, access scope and criticality per entry; run due diligence proportionate to access — security posture, data handling, incident and notification terms, business continuity; own contractual security and privacy terms with vendors, including notification windows and audit rights; monitor vendors continuously for incidents, ownership changes and posture drift, and re-review on a schedule; assess integration and connector providers before a connector family is built against them; own vendor offboarding, including data return and deletion evidence |
| Authority | Require due diligence before a vendor is used; classify vendor criticality; block onboarding of a vendor with unacceptable data handling terms |
| Cannot approve alone | Contract execution and commercial terms (owner-only); accepting a vendor with a known unremediated critical finding; granting a vendor access to customer data |
| Inputs | Proposed vendor and connector integrations; vendor documentation and assessment reports; incident notifications; contract terms |
| Outputs | Vendor and sub-processor register; due diligence records and risk ratings; required contractual terms; offboarding evidence |
| KPIs | Percentage of vendors with data access carrying a current assessment; number of unregistered sub-processors found in review (target 0); time from vendor incident notification to internal assessment |
| Activation trigger | The first vendor or sub-processor that can access customer or tenant data is contracted, or a customer requires a published sub-processor list. Neither has occurred; no sub-processor handles customer data today because there are no customers. |
| Current coverage | Not covered as a program. Provider and integration analysis is AI-covered via the `partner-alliances-analyst` and `solutions-architect` lanes, and integration surfaces are constrained by `pnpm run guard:ungated-fetch`, which prevents an ungated outbound call from shipping. No relationship exists today with any assessed vendor handling customer data. |
| Human / fractional / AI-supported | AI-supported today; Fractional then Human when triggered |
| Hiring priority | - |
| Required competencies | Third-party risk assessment methodology; contractual security and privacy terms; sub-processor and transfer obligations; proportionate diligence that does not stall integration work |
| Customer/security implications | A customer inherits every sub-processor SignalGrid uses. An unregistered one is a contract breach discovered by the customer's auditor rather than by SignalGrid. |

### Regulatory intelligence & policy management lead

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | COVERED |
| Reports to | Chief Risk & Compliance Officer |
| Mission | Track the obligations that apply to SignalGrid and its customers, and keep internal policy current, findable and actually followed. |
| Responsibilities | Monitor regulation and guidance relevant to the verticals and to AI-built software — HIPAA, GDPR and UK GDPR, US state privacy law, the EU AI Act, public-sector procurement and accessibility requirements — and translate changes into control or product requirements with dates; own the policy lifecycle: authorship, review cycle, approval, versioning, distribution and attestation of acknowledgment; map each obligation to the policy and control that satisfies it, and flag obligations with no mapping; maintain the horizon list of obligations that will apply at a stated future scale or geography, so they are designed for rather than discovered; brief the owner on regulatory changes that alter launch scope or public claims |
| Authority | Flag an obligation as unmapped and require an owner; set policy review cycles; require a policy update after a regulatory change |
| Cannot approve alone | Legal interpretation of an obligation (requires qualified counsel); changes to the launch scope frozen by DR-005; public statements about regulatory position |
| Inputs | Regulatory and standards sources; customer contractual requirements; vertical requirements from industry solutions; product roadmap |
| Outputs | Obligation register with applicability and dates; policy set with versions and review dates; obligation-to-policy-to-control mapping; owner briefings |
| KPIs | Percentage of applicable obligations mapped to a policy and control; percentage of policies inside their review cycle; lead time between a published regulatory change and an internal requirement being raised |
| Activation trigger | Active now at low volume, since applicability is narrow while there is no customer and no production processing. It becomes a named human role at the first regulated customer engagement, or when the product is offered in a jurisdiction whose obligations differ from the current one. |
| Current coverage | AI-covered via agent roster: `compliance-analyst` and `records-archivist` lanes, with `commercial-counsel` for contract-facing language. Founder approves. No qualified legal or regulatory professional currently reviews the output, so interpretations are treated as research rather than as advice. |
| Human / fractional / AI-supported | AI-supported, with fractional counsel for interpretation |
| Hiring priority | - |
| Required competencies | Regulatory research across healthcare, privacy, AI and public sector; policy writing that engineers will read; obligation mapping; distinguishing what a regulation requires from what a vendor says it requires |
| Customer/security implications | Customers ask which obligations SignalGrid takes on and which stay with them. The honest boundary — domain safety and clinical decisions sit in host applications — has to be stated the same way every time. |

### External audit, assessment & advisory partners

| Field | Value |
|---|---|
| Division | Privacy, compliance & risk |
| Status | FRACTIONAL |
| Reports to | Chief Risk & Compliance Officer for coordination; independent in opinion |
| Mission | Provide the independent opinion that the company cannot produce about itself. |
| Responsibilities | Perform independent audit or assessment against a defined framework and observation window; issue findings and, where applicable, a report whose factual content the company does not control; provide readiness advisory ahead of a first assessment, kept separate from the party that later performs it; provide qualified human compliance review of AI-assisted control and evidence work, which Claude Code does not and cannot supply; provide privacy and regulatory legal opinions where interpretation is required |
| Authority | Its own findings, opinion and report content, within the engagement's scope |
| Cannot approve alone | Nothing internal — external parties hold no internal decision rights; scope, timing and remediation commitments are set by the owner |
| Inputs | Signed engagement scope; the assessor package and evidence store; system and control documentation; management responses |
| Outputs | Assessment findings and reports; readiness gap analyses; written compliance and legal opinions |
| KPIs | Number of findings that internal readiness testing had already identified, as a percentage of total findings; percentage of evidence requests satisfied from the existing evidence store; time from engagement start to report |
| Activation trigger | No relationship exists today; this role activates when the owner signs an engagement with a named audit firm, assessor or compliance counsel. That engagement is itself triggered by a customer contract requiring an audit report or attestation, and no such contract exists. |
| Current coverage | Not covered. No auditor, assessor, certification body or compliance counsel is engaged, and SignalGrid holds no certification, attestation or audit report. Internal readiness work is AI-covered via the `compliance-analyst` lane and the gate estate; Claude Code does not guarantee HIPAA or SOC 2 outcomes, and human compliance review by a qualified professional is required before any external reliance. That review has not been performed. |
| Human / fractional / AI-supported | Fractional (external, engaged per assessment) |
| Hiring priority | - |
| Required competencies | Licensed or accredited assessment capability for the relevant framework; healthcare and public-sector sector experience; independence from the readiness advisor; willingness to test a company that automates its own evidence |
| Customer/security implications | The independence is the value. An opinion the company can influence is worth nothing to the buyer's risk committee, which is exactly the audience it exists for. |

## Platform, SRE & internal IT

**Measurable output: keep the product operable.** Leadership row: VP Platform / Head of Infrastructure.

This division owns everything between a merged commit and a system an operator can run, restore, and observe — plus the company's own machines, accounts, and internal access. Today it is almost entirely lane-covered and gate-covered rather than staffed: the durable stack is documented in `docs/DEPLOYMENT.md`, the restore path is exercised on every pull request by `pnpm run proof:backup-restore`, and reliability objectives live in `docs/RELIABILITY_SLO.md` as fixture-computed SLIs, not as commitments to anyone outside the company. SignalGrid operates no production service for external users, so the roles that only exist to run one are FUTURE and say so.

**Operating doctrine: incident command is a set of roles assigned during an incident, not a set of job titles.** This is the Google SRE model, written down now so the first real incident does not have to invent it. When an incident is declared, the declaring person assigns these four positions; one person may hold several while the incident is small, and any position may be handed off explicitly and out loud. None of them is a line on anyone's employment record.

| Incident position | What the holder does during the incident | What the holder must not do |
| --- | --- | --- |
| Incident Commander | Owns the incident; decides severity, assigns the other positions, holds the single decision thread, declares resolution | Fix things personally — the moment the IC starts debugging, nobody is commanding |
| Operations Lead | Owns the hands on the system; the only position that changes state, and every change is narrated to the IC | Change scope or declare the incident over |
| Communications | Owns the record and the outbound updates on a stated cadence; writes the timeline as it happens | Speculate on cause, or promise a fix time |
| Planning | Owns what happens next: handoffs, shift length, follow-up items, the postmortem draft | Direct the response — that is the IC |

Two rules bind the doctrine to this division's staffing. First, **toil is capped below half of role capacity**: an operations role whose manual, repetitive, automatable work exceeds 50 percent of measured time is a signal to build tooling or to add capacity, not a signal to work harder — the SRE role's KPI measures this on a time ledger. Second, **postmortems are blameless and mandatory** for every declared incident, and each one produces either a code change, a gate, or an explicit accepted-risk record with the owner's name on it.

### VP Platform / Head of Infrastructure

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | COVERED |
| Reports to | Founder/CEO (eventually CTO or President/COO) |
| Mission | Own whether SignalGrid can be run, restored, observed, and paid for by whoever operates it. |
| Responsibilities | Own the deployment topology and environment tiers (`dev`/`alpha`/`beta`/`prod`) and what each is permitted to reach; own reliability objectives and the error-budget policy; own backup, restore, and disaster-recovery posture including proof that a restore was exercised; own internal IT, corporate identity, and endpoint posture as a single accountable surface; own infrastructure and model-provider cost accountability jointly with Finance; set the incident-command doctrine and name who may declare an incident |
| Authority | Deployment topology, environment tiers, observability stack, backup schedule and retention, incident severity definitions, whether a release is operationally safe to cut |
| Cannot approve alone | Product scope changes (owner, per DR-005); any public claim about availability, uptime, certification, or an operational commitment to a party outside the company; spend commitments or vendor selection with a cost impact (owner-only); tenant-isolation design changes (joint with CISO side); changes to the fail-closed decision path |
| Inputs | Engineering release candidates; SLI records from `lib/reliability`; incident timelines and postmortems; capacity and load results from `pnpm run test:load` and the decision-core benches; owner cost constraints |
| Outputs | Deployment and environment policy; the reliability objective set and error-budget policy; DR posture and restore evidence; incident doctrine and on-call structure; an operability sign-off per release |
| KPIs | Restore drill passes on 100 percent of pull requests that touch persistence; error-budget policy published for every measured SLO with a stated action at exhaustion; zero releases cut without an operability sign-off; incident postmortem completed within five business days for every declared incident |
| Activation trigger | Hire when SignalGrid operates infrastructure it does not fully automate — concretely, when more than one long-lived environment exists that a gate cannot recreate from the repository, or when the first deployment outside the founder's control needs an operational owner. |
| Current coverage | Founder/CEO holds the accountability; the responsibility is executed by agent lanes — AI-covered via agent roster: `sre`, `release-engineer`, and `devex-tooling-engineer` lanes — with `docs/DEPLOYMENT.md`, `docs/BACKUP_AND_RESTORE.md`, and `docs/RELIABILITY_SLO.md` as the written policy surface. |
| Human / fractional / AI-supported | Human (future) with AI support today |
| Hiring priority | 10 |
| Required competencies | Production infrastructure ownership; SRE practice including error budgets and blameless postmortems; Postgres operations and restore verification; container and CI/CD topology; corporate IT and identity administration; cost accountability without inventing numbers |
| Customer/security implications | This role owns the surfaces an operator's security review will probe first: where data rests, who can reach it, how a restore is proven, and what happens when a signal source is unreachable. An honest answer here is a precondition for any security questionnaire; an overstated one is a claims-gate failure. |

### Site reliability engineer

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | FUTURE |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Apply engineering to operations so that a running SignalGrid deployment recovers fast and stays measurably within its reliability objectives. |
| Responsibilities | Own SLI instrumentation and error-budget reporting for decision availability, decision latency, and fail-closed integrity; run and improve the on-call rotation and the incident-command doctrine in practice; automate away toil and keep it below half of role capacity on a measured time ledger; own capacity headroom and the saturation knee from load and bench results; write and rehearse runbooks so the restore path and the failure paths are exercised before they are needed; drive postmortem follow-ups to closure |
| Authority | On-call rotation structure; runbook content; toil-reduction work prioritization; declaring an incident and its initial severity; halting a release when an error budget is exhausted |
| Cannot approve alone | Changes to the decision core or the fail-closed path; error-budget policy itself (VP Platform); any external statement about uptime or availability; tenant-isolation changes; spend |
| Inputs | `/metrics` and health endpoints; decision outcome records feeding `lib/reliability`; `pnpm run test:load` and `test:stress` results; `bench:decision-latency` and `bench:decision-throughput`; incident timelines |
| Outputs | Error-budget reports; runbooks; on-call schedule; postmortems and their follow-up items; capacity headroom statements |
| KPIs | Toil below 50 percent of measured role capacity, reported monthly; error-budget burn published every week for all three SLOs; median time-to-mitigate for declared incidents trending down quarter over quarter; 100 percent of declared incidents with a postmortem and at least one closed follow-up |
| Activation trigger | Hire when SignalGrid itself operates a production deployment serving users outside the company — that is, when a deployment exists that the company runs, that a person outside the company depends on, and that has an on-call expectation. Until that is true, reliability is a fixture-computed property of the decision core, not an operations job. |
| Current coverage | Not performed as an operations job, because there is no operated production service. The engineering half is AI-covered via agent roster: `sre` lane, with `lib/reliability` computing SLIs deterministically from supplied records and `proof:reliability` gating the zero-tolerance fail-closed objective. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | 6 |
| Required competencies | SRE practice: SLIs, SLOs, error budgets, toil measurement; incident command; Linux and container operations; Postgres behavior under failure; observability instrumentation; writing runbooks a stranger can follow at 3 a.m. |
| Customer/security implications | Reliability work must never buy availability by weakening the fail-closed rule — a single fail-open exhausts a zero-tolerance objective at any window size, and no volume of clean decisions buys it back. Any operator asking about recovery expects a restore that has actually been run. |

### Cloud & platform engineer

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | COVERED |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Make the served surfaces reproducible from the repository — build, image, environment, and network path — with no undocumented step. |
| Responsibilities | Own build and release mechanics for the API image and the durable stack, including `Dockerfile.api` and `docker-compose.prod.yml`; own environment tiering and the gating variables that decide durability, live-integration permission, and auth mode; own secret handling and credential placement so no secret reaches the repository; own network path and CORS or origin policy for the served surfaces; own infrastructure-as-code and keep every environment recreatable from a checkout; keep the toolchain honest across linux-x64 and macOS/arm64 build lanes |
| Authority | Build topology, image contents, base image currency, environment variable contracts, network and origin policy for non-production tiers |
| Cannot approve alone | Enabling live vendor integrations on any tier; production environment changes; credential issuance to a person or agent; anything that widens what a tier may reach |
| Inputs | Merged commits; CI results; dependency and base-image advisories; environment requirements from Engineering and Security |
| Outputs | Reproducible images and compose stacks; environment tier definitions; IaC; deployment documentation; a green `verify:docker` lane |
| KPIs | Every environment recreatable from a clean checkout with zero manual steps outside documentation; zero secrets in the repository per the secret-scan gate; base-image and dependency currency queue cleared on its scheduled cadence; `verify:docker` green on the default branch |
| Activation trigger | Active now as a lane-covered responsibility. Hire a human when more than one environment must be kept alive continuously by hand, or when a deployment target exists that the repository's gates cannot recreate. |
| Current coverage | AI-covered via agent roster: `release-engineer`, `devex-tooling-engineer`, and `network-domain` lanes; per-push CI and `verify:docker` are the enforcement surface; the founder holds credential and spend authority. |
| Human / fractional / AI-supported | AI-supported, founder-accountable |
| Hiring priority | 7 |
| Required competencies | Container build and registry mechanics; compose and orchestration; secret management; TLS and network path debugging; CI/CD; cross-architecture toolchain wrangling; infrastructure-as-code |
| Customer/security implications | The environment tier decides whether the system may make live vendor calls at all and whether persistence is durable. A tier misconfigured toward permissiveness is a security defect, not a convenience — the default is in-memory and deny-all cross-origin, and it stays that way unless someone deliberately widens it. |

### Database & persistence reliability engineer

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | COVERED |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Guarantee that the audit ledger and decision records survive failure and can be shown to be the same records after a restore. |
| Responsibilities | Own backup, restore, and retention for the durable stack, including manifest checksums and the ledger head hash captured at dump time; rehearse the restore path continuously rather than on a calendar; own schema migrations and their reversibility; own the runtime and owner role split so the application cannot alter its own history; own ledger integrity verification and export; own database capacity, vacuum, and growth behavior |
| Authority | Backup schedule and retention within policy; migration design and ordering; database role and grant structure; restore rehearsal cadence |
| Cannot approve alone | Retention policy changes with legal or contractual implications; destructive operations on any environment holding real records; changes to the ledger's tamper-evidence design; any claim about immutability made outside the repository |
| Inputs | Schema changes from Engineering; ledger verification output; growth and row-count telemetry; restore drill results |
| Outputs | Backup archives with manifests; verified restores; migration sets; ledger verification and export artifacts; capacity forecasts |
| KPIs | Restore drill green on 100 percent of pull requests touching persistence, via `proof:backup-restore`; zero archives accepted without a matching manifest; ledger chain verifies end to end on every export; migration rollback rehearsed for every schema change before merge |
| Activation trigger | Active now as a lane-covered responsibility. Hire a human when a database holds records the company cannot regenerate from fixtures — that is, at the first deployment storing real decisions for someone other than the company. |
| Current coverage | AI-covered via agent roster: `data-persistence-engineer` lane, which has exercised the restore path against real Postgres and driven the runtime and owner role split; `proof:backup-restore` destroys the schema, restores, and re-verifies the chain on every pull request; `db:backup`, `db:restore`, `db:verify-backup`, and `db:verify-ledger` are the operator-facing tools. |
| Human / fractional / AI-supported | AI-supported, founder-accountable |
| Hiring priority | 8 |
| Required competencies | Postgres administration and recovery; logical and physical backup mechanics; hash-chain and tamper-evidence reasoning; migration safety; least-privilege grant design; capacity planning |
| Customer/security implications | The product's evidence claim is that a decision can be shown to have happened unaltered. A backup nobody has restored does not support that claim, and an archive that cannot be checked must fail rather than silently pass — "I could not verify it" and "I verified it and it is good" must never produce the same outcome. |

### Observability, performance & capacity engineer

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | COVERED |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Make the system's real behavior visible and measured, so that operability claims rest on numbers rather than impressions. |
| Responsibilities | Own metrics, health, and readiness endpoints and what they honestly report; own SLI computation inputs and the plain-language reliability summary; own load and stress coverage of the `/v1` surface with correctness gated and throughput reported; own in-process decision-core benchmarking and the documented gap between it and the HTTP numbers; own capacity headroom and the saturation knee; keep every published figure tied to a re-runnable measurement under the docs-to-proof figure guard |
| Authority | Instrumentation design; benchmark methodology and fixture selection; which measurements are gated versus reported; capacity headroom statements |
| Cannot approve alone | Turning a reported measurement into a gate on shared runners; publishing any performance figure outside the repository; changes to SLO objectives; changes to the decision path being measured |
| Inputs | The running API and decision core; `test:load` and `test:stress` runs; `bench:decision-latency` and `bench:decision-throughput`; SLI records; docs figures under guard |
| Outputs | Metrics and health surfaces; benchmark and load reports; capacity headroom statements; reliability summaries; figure-guard-clean documentation |
| KPIs | Every performance figure in `docs/` traceable to a re-runnable command, enforced by `guard:figures`; correctness assertions gated at 100 percent under load; latency and throughput reported with methodology and hardware on every run; zero flaky latency thresholds promoted to gates |
| Activation trigger | Active now as a lane-covered responsibility. Hire a human when performance becomes a commitment to someone outside the company, or when a shared runner can no longer produce numbers that reflect a real deployment. |
| Current coverage | AI-covered via agent roster: `performance-engineer` lane; `lib/reliability` computes SLIs deterministically and `proof:reliability` gates the zero-tolerance objective; `guard:figures` fails the build when documentation drifts from measurement. |
| Human / fractional / AI-supported | AI-supported, founder-accountable |
| Hiring priority | 8 |
| Required competencies | Benchmark methodology and statistical honesty; load generation and saturation analysis; metrics and tracing instrumentation; percentile reasoning; distinguishing transport cost from compute cost |
| Customer/security implications | A latency threshold on a shared runner is a flaky gate, and a flaky gate gets switched off — so correctness is gated and throughput is reported. Overstating measured performance to an operator is a truthfulness failure, and the figure guard exists to make it a build failure instead. |

### Incident management lead

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | FUTURE |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Make incident response a rehearsed procedure rather than an improvisation, and make every incident produce a durable change. |
| Responsibilities | Maintain the incident-command doctrine — Incident Commander, Operations Lead, Communications, Planning as positions assigned per incident, never as job titles; define severity levels and who may declare each; own the incident record, timeline discipline, and communication cadence; run blameless postmortems and track follow-ups to closure; rehearse incidents against the runbooks before a real one arrives; coordinate with Security on incidents that are also security incidents, and with AI Operations on incidents caused by an agent lane |
| Authority | Severity definitions; incident process and templates; declaring an exercise; requiring a postmortem; escalation paths |
| Cannot approve alone | Any external communication about an incident (owner, with Legal and Communications); severity of a security incident (joint with the CISO side); accepting a risk instead of fixing it (owner signature required) |
| Inputs | Alerts and health signals; incident declarations; postmortem drafts; follow-up backlog; lane-coordination protocol state |
| Outputs | Incident doctrine and templates; incident records and timelines; blameless postmortems; a follow-up ledger with closure dates; exercise reports |
| KPIs | 100 percent of declared incidents have a postmortem within five business days; 100 percent of postmortems produce a code change, a gate, or a signed accepted-risk record; at least one rehearsed incident exercise per quarter once active; zero incidents where the commander role was ambiguous in the timeline |
| Activation trigger | Activates at the first declared incident affecting a deployment the company operates for someone outside it, or the first security incident of any severity — whichever comes first. The doctrine above is written now so that incident does not have to invent it. |
| Current coverage | Not active: no operated deployment and no declared incident exists. The doctrine is written and lives in this catalog; today's nearest equivalent is the cross-lane coordination protocol in `docs/LANE_COORDINATION.md` and the owner escalation path, which handle collisions between agent lanes, not service outages. |
| Human / fractional / AI-supported | Human (future), assigned per incident rather than staffed |
| Hiring priority | - |
| Required competencies | Incident command practice; blameless postmortem facilitation; severity triage; clear written communication under pressure; the discipline to command instead of debug |
| Customer/security implications | How a company behaves in its first incident is the durable impression an operator forms. A truthful timeline, a stated cadence, and no speculation about cause are the requirements; a promised fix time nobody can keep costs more trust than the outage did. |

### Internal IT, endpoint & business systems administrator

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | COVERED |
| Reports to | VP Platform / Head of Infrastructure |
| Mission | Keep the company's own devices, accounts, and internal systems in a state the company would accept from a customer. |
| Responsibilities | Own company endpoint posture — disk encryption, patch currency, screen lock, backup — for every device that touches company data; own SaaS account inventory, ownership, and offboarding for every tool the company pays for or logs into; own business systems and the records that must outlive any single tool; own device enrollment and management posture, honestly labeled as to what is enforced by an MDM on a supervised device and what is merely configured; own internal help and access requests once more than one person exists |
| Authority | Endpoint baseline configuration; SaaS tool inventory and access review cadence; device enrollment method; internal support process |
| Cannot approve alone | Purchasing or committing to any tool (owner-only, cost); granting production or repository access; storing regulated or customer data in a new system; changes to records retention |
| Inputs | Device and account inventory; vendor security advisories; onboarding and offboarding events; access review results |
| Outputs | Endpoint baseline and its evidence; a current SaaS and account inventory with named owners; offboarding checklists; access review records |
| KPIs | 100 percent of devices touching company data meet the baseline, evidenced at each review; SaaS inventory reviewed at least quarterly with zero unowned accounts; offboarding completed within one business day of a departure; zero company data in a system absent from the inventory |
| Activation trigger | Hire or contract when a second person receives a company-managed device or account. Until then a single operator administers a single environment and the work is real but small. |
| Current coverage | The founder administers his own devices and accounts; the Mac lane's operational discipline is AI-covered via agent roster: `mac-lane-steward` lane, and internal records discipline via the `records-archivist` lane. There is no fleet, no directory, and no help desk, because there is one human. |
| Human / fractional / AI-supported | Human (founder today), fractional or AI-supported later |
| Hiring priority | 9 |
| Required competencies | Endpoint management on macOS, iOS, and Windows; MDM and supervision mechanics and their real limits; SaaS administration and access review; asset and records inventory; offboarding rigor |
| Customer/security implications | This is the division where platform honesty applies inward: an application cannot grant device access, restrict other applications, make itself non-removable, or self-kiosk — those are MDM and OS capabilities that require a supervised device. Internal posture is also the first thing a customer security questionnaire asks about, and the answer must describe what is actually enforced. |

### Internal security & identity administrator

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | FUTURE |
| Reports to | VP Platform / Head of Infrastructure, with a dotted line to the CISO side |
| Mission | Control who and what can reach company systems, and be able to prove it after the fact. |
| Responsibilities | Own corporate identity: directory, single sign-on, phishing-resistant multi-factor enforcement, and joiner-mover-leaver processing; own repository, cloud, and secret-store access grants including grants held by agent lanes; run periodic access reviews with evidence, not attestation by memory; own corporate network and remote-access posture; own internal logging and alerting for corporate systems, distinct from product telemetry; feed internal findings to the independent assurance layer rather than closing them privately |
| Authority | Identity provider configuration; multi-factor policy; access review cadence and revocation; internal alerting rules |
| Cannot approve alone | Granting production or customer-data access; granting an agent lane a new credential or a widened repository scope (joint with AI Operations and the owner); exceptions to multi-factor policy; any external statement about the company's internal security posture |
| Inputs | Identity directory state; access grant requests; audit logs from repository and cloud accounts; agent-lane credential inventory; offboarding events |
| Outputs | Identity and access policy; access review records with evidence; revocation logs; internal alerting configuration; a credential inventory covering humans and agents |
| KPIs | 100 percent of privileged accounts, human and agent, covered by a completed access review each quarter; phishing-resistant multi-factor on 100 percent of accounts that support it; access revoked within one business day of a role change or departure; zero long-lived credentials outside the inventory |
| Activation trigger | Activates when a second identity exists in any company system that is not the founder's — a hire, a contractor, a fractional professional, or an agent lane holding a credential the founder did not personally issue for a single task. |
| Current coverage | Not staffed. Today there is one human identity, and agent-lane repository access is bounded by the owner's grants plus the lane-coordination protocol; there is no directory, no single sign-on, and no access review cycle, because there is nothing yet to review. The product-side identity expertise that exists is AI-covered via agent roster: `iam-domain` and `secops-domain` lanes, which verify identity signals in the product, not company access. |
| Human / fractional / AI-supported | Human or fractional (future) |
| Hiring priority | 9 |
| Required competencies | Identity provider administration and federation; phishing-resistant multi-factor deployment; least-privilege grant design; access review evidence; corporate logging and detection; credential lifecycle for non-human identities |
| Customer/security implications | A company selling a trust gate is judged on its own access hygiene, and non-human identities are the part most organizations forget to review. Internal findings go to the independent assurance layer so that the group being reviewed is not the group grading itself. |

### FinOps & infrastructure cost analyst

| Field | Value |
|---|---|
| Division | Platform, SRE & internal IT |
| Status | FUTURE |
| Reports to | VP Platform / Head of Infrastructure, jointly with Finance |
| Mission | Keep infrastructure and model-provider consumption attributable, forecastable, and visible to the owner before it surprises anyone. |
| Responsibilities | Attribute consumption to environments, workloads, and agent lanes so every unit of spend has an owner; forecast consumption against planned work and flag divergence early; identify structural waste — idle environments, oversized instances, retained artifacts, redundant tooling — and propose removals; model unit economics per decision and per deployment as inputs to pricing work owned elsewhere; maintain the cost side of the agent-lane economics ledger jointly with AI Operations |
| Authority | Cost attribution model and tagging scheme; consumption reporting cadence and format; flagging a workload for review |
| Cannot approve alone | Any spend, commitment, or vendor change (owner-only); pricing decisions (Finance and the owner); publishing any figure with a currency amount; shutting down an environment another role depends on |
| Inputs | Provider consumption records; environment and workload inventory; agent-lane usage records; planned work from the backlog |
| Outputs | Attribution reports by environment, workload, and lane; forecasts with stated assumptions; waste findings with proposed removals; unit-consumption models |
| KPIs | 100 percent of consumption attributable to a named environment, workload, or lane; forecast versus actual divergence reported every month with the reason for each variance; every waste finding carries a specific proposed action and an owner; zero cost figures published outside owner-only channels |
| Activation trigger | Activates when recurring infrastructure or model-provider consumption exists across more than one provider account, or when the owner sets a monthly consumption threshold in the owner-only finance record and asks for it to be tracked. |
| Current coverage | Not staffed. Consumption is currently visible directly to the owner, who holds all spend authority; the agent-lane economics half is AI-covered via agent roster: `agent-ops-economics` lane. No owner-only billing figure (Claude spend, Apple Developer fee, GitHub plan, domain — DR-005 item 4) appears in this repository, and none may — those are owner-only by policy, and this catalog states no such amount anywhere. The product's own price points and the cost model do appear (`artifacts/signalgrid-web/src/pages/Pricing.tsx`, `docs/COST_MODEL.md`); scripts/check-cost-figures.mjs, being added this round, gates the distinction. |
| Human / fractional / AI-supported | Fractional or AI-supported (future) |
| Hiring priority | - |
| Required competencies | Cloud and model-provider consumption analysis; tagging and attribution design; forecasting with explicit assumptions; unit-economics modeling; the discipline to report consumption without publishing prices |
| Customer/security implications | Cost attribution touches usage records, so attribution data must never carry tenant or end-user identifiers out of the boundaries that hold them. Cost pressure must never be answered by weakening evidence retention or by turning off a gate. |

## AI, automation & data

**Measurable output: scale human execution without losing accountability.** Leadership row: Head of AI/Automation.

This division exists because SignalGrid is built with substantial AI assistance and therefore needs AI to be an organizational function rather than a developer tool. NIST's AI Risk Management Framework calls for explicitly defined human roles for AI oversight; that is what these roles are. The important honesty here is stated once, plainly, and repeated in the coverage fields below: **the agent lanes that would be governed by this function are the same lanes that already execute this company's work, including writing this catalog.** The function does not create that arrangement — it formalizes it, under owner oversight, the lane-coordination protocol in `docs/LANE_COORDINATION.md`, the 42-duty registry in `docs/agent/org-roster.json`, and the review-coverage ledger in `docs/agent/review-coverage.json`, which records what a named role actually read as distinct from what a gate asserts. Human accountability is not delegable to a lane, and the owner remains the accountable human for every agent action.

### Head of AI & Automation

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Own how much of this company's work is done by agents, under what boundaries, and who is accountable when an agent is wrong. |
| Responsibilities | Set agent scope: which lanes exist, which repositories and surfaces each may change, and what each must escalate; own model and provider selection criteria and the record of why each choice was made; own the review requirement for generated code and generated claims, and the ledger that records real review; own evaluation policy — what must be measured before an agent lane's output is trusted on a new surface; own AI incident definition and response jointly with Incident Management; hold the human-accountability line so no output ships as unreviewed |
| Authority | Lane creation and retirement; agent scope and escalation boundaries; model and provider selection criteria; evaluation policy; declaring an AI incident |
| Cannot approve alone | Product scope changes (owner, per DR-005); spend or provider commitments (owner-only); granting a lane new credentials or widened repository access (joint with internal security and the owner); publishing any claim about what agents did without evidence; changes to the claims gate |
| Inputs | Lane activity and produced artifacts; review-coverage ledger; gate and proof results; owner directives; provider capability and policy changes |
| Outputs | Agent scope and boundary policy; model and provider selection records; evaluation policy; the lane registry; AI incident records |
| KPIs | 100 percent of active lanes have a written scope, an escalation boundary, and a named accountable human; every model or provider change carries a decision record with a reversal path; review-coverage percentage reported on every run and trending up; zero agent-authored public claims that fail `check:false-claims` |
| Activation trigger | Active now in substance — the founder performs it. Hire or formalize as a distinct human role when more than one human directs agent lanes, or when a lane is permitted to change a surface that no gate covers. |
| Current coverage | Founder/CEO holds the accountability and the decision authority; the operating half is AI-covered via agent roster: `agent-ops-economics` lane, with `docs/agent/org-roster.json` as the enforcement registry of 42 agent duties and `docs/DECISION_RECORDS.md` as the decision trail. This is the self-referential part, stated plainly: the lanes operate under boundaries the founder set, and this function is the name for that arrangement. |
| Human / fractional / AI-supported | Human (founder today) with AI support |
| Hiring priority | 10 |
| Required competencies | Agent system design and boundary setting; model and provider evaluation; code review at volume; risk framing against NIST AI RMF; the judgment to refuse a capability that cannot be reviewed |
| Customer/security implications | Every agent action is an action the company takes. An operator's security review will ask what agents may change, what data they see, and who signs off — and the answer must be documented and current, not reconstructed after the question is asked. |

### AI/Agent operations lead

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | ACTIVE |
| Reports to | Head of AI & Automation |
| Mission | Run the agent lanes as an operated system: bounded, audited, coordinated, and answerable to a named human. |
| Responsibilities | Operate the lane registry and keep each lane's activation tied to a named artifact rather than an assertion; run the cross-lane coordination protocol so parallel lanes do not collide on shared surfaces; audit tool calls and repository changes so every change traces to a lane, a prompt, and a human boundary; control data exposure — what a lane may read, what may leave the machine, and what must never be pasted anywhere; maintain the review-coverage ledger honestly, including when the number is small; run the cloud-to-local request and message loops so cross-machine work is recorded rather than remembered |
| Authority | Lane scheduling and coordination; escalation of a lane collision; requiring a second lane's adversarial review; pausing a lane; the format and cadence of the coverage ledger |
| Cannot approve alone | Widening any lane's repository or credential scope; changing escalation boundaries; publishing agent-produced claims externally; committing or pushing when the owner has not asked; destructive git operations |
| Inputs | Lane activity, commits, and produced artifacts; `pnpm run lane:inbox` mail; `artifacts/sim-requests/` and `artifacts/sim-results/`; gate and proof results; owner directives |
| Outputs | Lane coordination records; the review-coverage ledger; tool-call and change audit trails; sim-request results with provenance; AI incident records |
| KPIs | 100 percent of lane activations name a produced artifact; zero unresolved cross-lane collisions on shared surfaces per month; every sim request closed by a recorded result or an explicitly reported pending state, never by a silent skip; review-coverage percentage published on every run |
| Activation trigger | Active now. This is the only role in this division performed continuously today. |
| Current coverage | Partially self-referential, and named as such: the agent lanes govern themselves under the founder's oversight, the lane-coordination protocol in `docs/LANE_COORDINATION.md`, the same 42-duty registry in `docs/agent/org-roster.json`, and the review-coverage ledger in `docs/agent/review-coverage.json`. Enforcement is mechanical rather than social — `check-lane-messages`, `check-sim-requests`, `check:false-claims`, and the guard registries report unresolved state and never pass silently. AI-covered via agent roster: `agent-ops-economics`, `program-manager`, and `mac-lane-steward` lanes. |
| Human / fractional / AI-supported | AI-supported with a named accountable human (the founder) |
| Hiring priority | - |
| Required competencies | Agent orchestration; change auditing; conflict resolution across parallel workers; provenance discipline; data-exposure judgment; writing down what actually happened including the parts that failed |
| Customer/security implications | Provenance is the product's argument, so provenance about the agents must hold to the same bar — a result is stamped from the tree state at launch, and a dirty tree says so. If agent governance were claimed rather than evidenced, every downstream evidence claim would inherit the weakness. |

### Agent & workflow engineer

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | ACTIVE |
| Reports to | Head of AI & Automation |
| Mission | Build the harnesses, prompts, and workflows that let agent lanes do real engineering work without inventing their own rules each time. |
| Responsibilities | Design and version lane workflows, skills, and prompts as reviewable artifacts rather than chat history; build the harnesses that gate agent output — proof scripts, guards, registries, and the preflight lane; encode repository doctrine so a lane inherits it instead of rediscovering it; build the cross-machine loops that carry work between environments with provenance attached; retire workflows that stopped earning their runtime |
| Authority | Workflow and prompt design; harness structure; which checks belong in which lane; refactoring a workflow that produces unreviewable output |
| Cannot approve alone | Adding or removing a gate from the enforcement set; changing what a lane may access; changing the decision core or any fail-closed path; any change to the claims gate |
| Inputs | Repository doctrine and decision records; lane failure modes; gate and proof results; owner directives; review findings |
| Outputs | Versioned workflows, skills, and prompts; proof and guard scripts; the preflight and breadth lanes; cross-machine request and message loops |
| KPIs | Every workflow change reviewable as a diff with no undocumented behavior; zero prompts or workflows in use that exist only in chat history; new gates joined to the enumerating harness automatically rather than by hand-edited lists; measured reduction in repeated lane errors after each doctrine change |
| Activation trigger | Active now. Formalize as a distinct hire when workflow maintenance exceeds the capacity of the lanes that also do product work, or when a workflow must be operated by someone who did not write it. |
| Current coverage | AI-covered via agent roster: `devex-tooling-engineer` and `program-manager` lanes, with `CLAUDE.md` and `docs/` carrying the doctrine a lane inherits on start. The harness enumerates every proof script so a new proof joins it automatically; the gates that are not proofs are enumerated separately and both must be run before a push. |
| Human / fractional / AI-supported | AI-supported, founder-accountable |
| Hiring priority | - |
| Required competencies | Agent and tool-use system design; prompt versioning as software; test and gate design; developer-experience instinct; knowing when a workflow is producing output nobody can review |
| Customer/security implications | A workflow that can silently skip a check is worse than no workflow, because it produces confident output with no evidence behind it. Every harness here must report a skip as a skip and fail loudly rather than pass quietly. |

### AI evaluation engineer

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | COVERED |
| Reports to | Head of AI & Automation |
| Mission | Measure whether agent output is actually correct, on the surfaces where being wrong would matter. |
| Responsibilities | Define what "correct" means per lane surface and build the evaluations that test it, including adversarial and counterexample cases; run evaluations before a lane is trusted on a new surface and after any model or provider change; measure regression across model versions so a provider update cannot silently change behavior; own the distinction between a gate that proves a property and an evaluation that samples quality; maintain the review-coverage ledger's depth semantics — read, audited, verified-live — so the ledger does not inflate |
| Authority | Evaluation design and pass criteria; declaring a lane unevaluated on a surface; requiring re-evaluation after a model change |
| Cannot approve alone | Trusting a lane on a new surface without the accountable human's sign-off; changing pass criteria to make a failing evaluation pass; model or provider changes |
| Inputs | Lane output samples; gate and proof results; model and provider version changes; review findings and the coverage ledger |
| Outputs | Evaluation suites and their results; regression reports across model versions; unevaluated-surface list; ledger depth definitions |
| KPIs | 100 percent of lane surfaces classified as evaluated or explicitly unevaluated, with no unclassified surfaces; re-evaluation completed before any model or provider change takes effect; every evaluation carries at least one adversarial case; review-coverage depth claims coherent on every run, enforced by the coverage checker |
| Activation trigger | Formalize as a distinct role when agent output reaches a surface that no deterministic gate can check — the point where "the proof passed" stops being sufficient evidence that the work is right. |
| Current coverage | Partially covered by construction rather than by a role: the product's evidence culture means most agent output lands on surfaces a proof already checks, and `check:false-claims`, `review:invariants`, and the guard registries reject a large class of wrong output mechanically. What is not covered mechanically is covered by cross-lane adversarial review and recorded in `docs/agent/review-coverage.json`, whose count is deliberately small and visible rather than flattering. AI-covered via agent roster: `qa-engineer` lane. |
| Human / fractional / AI-supported | AI-supported today, human (future) |
| Hiring priority | 8 |
| Required competencies | Evaluation design including adversarial cases; statistical literacy about sampled quality; regression testing across model versions; the discipline to report a low coverage number rather than hide it |
| Customer/security implications | An unevaluated agent surface is an unmeasured risk, and describing it as measured would be exactly the failure mode this company's product exists to prevent. Evaluation results stay internal unless the owner decides otherwise; none of them are a certification or an attestation. |

### AI safety, governance & provider management lead

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | COVERED |
| Reports to | Head of AI & Automation, with a dotted line to the CISO side and to Privacy, compliance & risk |
| Mission | Keep AI use inside stated boundaries and make those boundaries defensible to someone who did not set them. |
| Responsibilities | Maintain the AI-use policy: permitted uses, prohibited uses, required human review points, and disclosure expectations; own model and provider governance including data-handling terms, retention behavior, and what may be sent to which provider; classify data by whether it may enter an agent context at all, with regulated and customer data handled most strictly; define AI incidents and run their response with Incident Management; map controls against NIST AI RMF functions so the mapping exists before anyone asks for it; review agent-produced public claims against the truthfulness rules before publication |
| Authority | AI-use policy content; data classification for agent contexts; declaring a use prohibited; requiring human review at a named point; blocking publication of an agent-produced claim |
| Cannot approve alone | Provider selection or commitment (owner-only); any regulatory or compliance representation (human compliance review required); changes to product scope; publishing a governance claim externally |
| Inputs | Provider terms and policy changes; lane data-access inventory; incident records; regulatory guidance; owner directives |
| Outputs | AI-use policy; data classification for agent contexts; provider governance records; a NIST AI RMF control mapping; AI incident records; pre-publication claim reviews |
| KPIs | 100 percent of agent lanes mapped to a data classification with no unclassified lane; every provider change accompanied by a data-handling review recorded before the change; zero agent-produced public claims published without a truthfulness review; AI RMF control mapping reviewed at least twice a year and dated |
| Activation trigger | Formalize as a distinct role at the first of these: a second human directs agent lanes; regulated or customer data becomes reachable from an agent context; or an external party asks in writing how AI is used in building or operating the product. |
| Current coverage | Held by the founder as owner, expressed through decision records, the frozen launch scope, and the claims gate `check:false-claims`, which fails the build on prohibited claim language rather than relying on anyone's memory. Regulated-vertical work carries an explicit limitation: this company does not guarantee HIPAA or SOC 2 outcomes, and a human compliance review is required rather than optional. AI-covered via agent roster: `compliance-analyst` and `threat-modeler` lanes for the analysis half. |
| Human / fractional / AI-supported | Human (founder today), fractional specialist later |
| Hiring priority | - |
| Required competencies | AI risk frameworks, NIST AI RMF in particular; provider data-handling terms; data classification; incident definition for AI failure modes; writing policy that a non-specialist can follow |
| Customer/security implications | The question an operator will ask is not whether AI was used but what it could see and who checked its output. Both answers must be documented and true. No certification, attestation, or audit outcome is claimed anywhere in this repository, and this role's job is to keep it that way. |

### Knowledge systems & internal automation engineer

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | ACTIVE |
| Reports to | Head of AI & Automation |
| Mission | Make the company's written memory accurate and reachable, so that neither a human nor a lane has to guess what is already true. |
| Responsibilities | Own the documentation index and the doctrine surfaces a lane loads on start, so context is inherited rather than rediscovered; own the guards that keep documentation consistent with the code it describes, including cited-path and figure checks; build internal automation for recurring work — scheduled verification, dependency currency, backlog triage, status reporting; own the absence-checking discipline so that "X does not exist" is a verified verdict rather than a failed search; keep operating memory — decision records, backlog, intake ledger — current and cross-linked |
| Authority | Documentation structure and index; doctrine surface content within existing decisions; automation scheduling and cadence; retiring stale documents |
| Cannot approve alone | Changing a decision record's outcome; widening a product claim in any document; removing a guard; publishing anything externally |
| Inputs | Repository state; decision records; gate results; lane questions and repeated errors; owner directives |
| Outputs | Documentation index and doctrine surfaces; consistency guards; scheduled automation; absence verdicts; current operating-memory documents |
| KPIs | Zero cited paths in documentation that do not exist, enforced across the estate scan; zero published figures untraceable to a re-runnable command, enforced by the figure guard; every absence claim in the repository backed by a recorded `check:absence` verdict; scheduled verification runs on cadence with regressions raised as tracked items |
| Activation trigger | Active now. Formalize as a hire when documentation maintenance exceeds lane capacity or when a person outside the company must find things in it without a guide. |
| Current coverage | AI-covered via agent roster: `docs-writer`, `records-archivist`, and `devex-tooling-engineer` lanes. Enforcement is mechanical: the cited-path check spans all seven repositories via `pnpm run scan:estate`, `guard:figures` fails the build on documentation-to-measurement drift, and `pnpm run check:absence` probes four differently shaped ways before an absence claim may be written — a discipline added because two documents had already claimed a surface was absent while it sat in the tree. |
| Human / fractional / AI-supported | AI-supported, founder-accountable |
| Hiring priority | - |
| Required competencies | Technical writing to the Google developer style; information architecture; automation scripting; consistency-guard design; the habit of verifying a negative before writing it |
| Customer/security implications | Documentation is where over-claiming happens first, which is why the guards that catch it live in the same tree as the proofs they check against. A document that contradicts the code is a truthfulness defect regardless of intent. |

### Data engineer

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | FUTURE |
| Reports to | Head of AI & Automation |
| Mission | Move operating and product data into a shape people can ask questions of, without moving anything that should not travel. |
| Responsibilities | Build ingestion and modeling for product telemetry and operating records once real ones exist; enforce tenant and data-boundary rules in the pipeline itself rather than in the query layer; own retention, minimization, and deletion behavior in every pipeline stage; own data quality checks that fail loudly instead of producing quietly wrong tables; keep lineage so any figure can be traced back to its source record |
| Authority | Pipeline and model design; data quality check definitions; retention implementation within policy |
| Cannot approve alone | What data may be collected at all (Privacy and the owner); crossing a tenant boundary for any reason; retention policy; sending data to any external service |
| Inputs | Product telemetry once emitted; operating records; retention and privacy policy; analytics requirements |
| Outputs | Pipelines and data models; quality checks; lineage documentation; retention and deletion implementations |
| KPIs | 100 percent of pipeline fields mapped to a retention rule with no unmapped fields; zero cross-tenant records in any modeled table, tested rather than assumed; every published figure traceable to a source record through documented lineage; quality checks fail the pipeline rather than degrade output |
| Activation trigger | Activates when real usage data exists that the company is permitted to collect and cannot answer questions about from fixtures — concretely, at the first deployment producing decision records the company may analyze. |
| Current coverage | Not active. The decision core is deterministic and fixture-backed, there is no data warehouse, and there is no usage data because there is no deployment producing it. The persistence expertise that exists is AI-covered via agent roster: `data-persistence-engineer` lane, which works on the audit ledger and the decision store, not on analytics pipelines. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | 9 |
| Required competencies | Pipeline engineering; dimensional modeling; data quality and lineage tooling; privacy-preserving design including minimization and deletion; tenant isolation in storage and query paths |
| Customer/security implications | An analytics pipeline is the most common place a tenant boundary quietly stops being real, because aggregation looks harmless. Boundaries are enforced in the pipeline and tested, and no data leaves a boundary because a query was convenient. |

### Analytics, BI & decision analytics lead

| Field | Value |
|---|---|
| Division | AI, automation & data |
| Status | FUTURE |
| Reports to | Head of AI & Automation, with a dotted line to Product and Finance |
| Mission | Turn data into decisions the company can defend, including the decision to stop doing something. |
| Responsibilities | Build and maintain the company's operating metrics and their definitions, so a number means the same thing every time it is quoted; run decision analytics on the product's own decision records — verdict distribution, step-up rates, fail-closed frequency, signal-source reachability — as inputs to product and reliability work; produce analyses with stated assumptions, confidence, and what would change the conclusion; kill metrics that stopped driving decisions; keep every published figure reproducible from a named query against a named dataset |
| Authority | Metric definitions and their documentation; analysis methodology; retiring a metric; flagging a figure as unreproducible |
| Cannot approve alone | Publishing any figure outside the company; product or pricing decisions; any claim about customer outcomes; changing a metric definition retroactively without a recorded note |
| Inputs | Modeled data from the data engineer; product decision records; operating records; questions from Product, Finance, and the owner |
| Outputs | Metric definitions; dashboards; decision analyses with assumptions and confidence; reproducible query references for every published figure |
| KPIs | 100 percent of quoted operating metrics have a written definition and a reproducible query; zero figures published outside the company without an owner review; every analysis states its assumptions and what would falsify its conclusion; retired-metric count reported quarterly, because unused dashboards are cost |
| Activation trigger | Activates when the company holds data that can answer a question the founder cannot answer by reading the repository — practically, after the data engineer role activates and a first modeled dataset exists. |
| Current coverage | Not active. Today every operating question is answered from the repository directly: gates, proofs, decision records, and ledgers. The product-side analytical duties that exist are AI-covered via agent roster: `competitive-analyst` and `pricing-packaging-analyst` lanes, which analyze market and packaging questions, not usage data — no usage data exists to analyze. |
| Human / fractional / AI-supported | Human or fractional (future) |
| Hiring priority | 10 |
| Required competencies | Metric definition discipline; SQL and BI tooling; experimental and causal reasoning; presenting uncertainty honestly; the willingness to report a result that contradicts the plan |
| Customer/security implications | Analytics is where a number becomes a claim, and a claim about customer outcomes is exactly the category this repository's claims gate blocks until it is true and evidenced. Analysis touching decision records must respect tenant boundaries in the query path, not only in the dataset. |

## Domain & solutions engineering

**Measurable output:** make it work in the customer's environment.

This division owns the answer to "how does SignalGrid run inside an estate we do
not control." It is the deepest part of the founder's own background and the
thinnest part of the company's headcount. Nine roles, consolidating twelve
subject-matter areas: the signal-domain agent lanes in
[`docs/agent/org-roster.json`](../agent/org-roster.json) carry the wire-truth
duties today, the founder carries endpoint and UEM personally, and exactly one
role in this division sits in the owner's near-term hiring sequence.

Two constraints bind every role below. Launch scope is frozen by DR-005 — no
role here may widen the product to fit an environment; it records the gap and
the owner opens a decision record. And platform honesty holds: SignalGrid
consumes device-management evidence and cannot grant device access, restrict
other apps, make itself non-removable, or self-kiosk. Vendor products named in
these roles are evidence sources exercised in a lab. No vendor relationship,
endorsement, resale agreement, or certification exists.

### VP Solutions / Chief Solutions Architect

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Own the deployment answer for any customer environment, so that every architecture question has a cited, defensible answer or a recorded "unknown" before it is asked in a meeting. |
| Responsibilities | Own the reference architecture and the grant-order path a customer's IT team follows, per `docs/DEPLOYMENT_MODELS.md` and `docs/PARTNER_ONBOARDING.md`; hold the domain coverage map and state for each evidence domain whether it is lab-verified, documentation-verified, or unverified; scope pilots against the ratified launch profile and refuse scope items outside it; arbitrate when two evidence domains disagree about the same device; keep every deployment claim inside what the repository can evidence |
| Authority | Which reference architecture is recommended for a given estate shape; which evidence source is primary for a domain; whether a deployment question is answerable today or must be recorded as unknown; the order in which customer-side grants are requested |
| Cannot approve alone | Any change to `scripts/launch-profile.mjs` classifications, which needs a decision record and the owner; any SLA, uptime, support, or on-call commitment; any compliance, certification, or attestation statement; any statement that a relationship with a vendor or organization exists; pricing, discount, or cost commitments, which are owner-only |
| Inputs | `docs/DEPLOYMENT_MODELS.md`; `docs/PILOT_SCOPE_SKELETON.md`; `docs/PILOT_READINESS_CRITERIA.md`; SME wire-truth records; the ratified launch profile; prospect environment inventories |
| Outputs | Reference architectures per deployment model; pilot scoping documents; the domain coverage map with verification status per domain; deployment answer records that cite a repository path or state the unknown |
| KPIs | Share of deployment questions closed with a cited path or an explicit unknown, target 100 percent; pilot scope items falling outside the ratified launch profile, target zero; median days from question raised to answer recorded |
| Activation trigger | Active now as a founder-held duty. Separates into its own role when the solutions architect hire (priority 8) is in place and a second environment is in scoping at the same time, so architecture and delivery can no longer be one person. |
| Current coverage | Founder/CEO, personally. AI-covered via agent roster: `solutions-architect` lane, registered with a defined charter and never activated, plus the six signal-domain lanes for per-domain wire truth. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Multi-vendor endpoint, identity, and network architecture; reading an unfamiliar estate from an inventory and a change window; writing deployment documentation that survives an assessor's questions; knowing precisely what an application cannot do on an unsupervised device |
| Customer/security implications | This is where over-claiming starts. Every architecture it publishes must separate what SignalGrid consumes from what it controls, and must disclose the shadow-mode gap up front: at Limited GA the gate returns `step_up` and no launch route answers one, so a pilot measures whether verdicts are right, not whether they bind. |

### Solutions architect / sales engineer

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | FUTURE |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Turn a prospect's actual estate into a scoped, evidenced deployment plan and run the technical half of the evaluation. |
| Responsibilities | Run environment discovery and produce a per-prospect architecture naming the grants required, in order, and what SignalGrid can answer before each one lands; build and run demonstrations against the fixture-backed simulator rather than a mocked screen; answer technical evaluation questions with cited artifacts and escalate anything the repository cannot evidence; own the pilot scoping document and the acceptance definition; feed recurring environment gaps back as decision-record candidates, never as ad hoc product promises |
| Authority | The technical scope of a demonstration; which repository evidence answers a given evaluation question; whether a prospect environment is architecturally supportable within the frozen launch scope |
| Cannot approve alone | Commercial terms, pricing, or discounts, which are owner-only; roadmap or delivery-date commitments; product surface changes to fit a deal; security questionnaire responses that go beyond `docs/SECURITY_QUESTIONNAIRE_PACK.md`; any statement of a partnership, certification, or reference customer |
| Inputs | Prospect environment inventory; the domain coverage map; the ratified launch profile; the proof and simulator suites; `docs/PILOT_SCOPE_SKELETON.md` |
| Outputs | Per-prospect reference architecture; demonstration scripts and recorded runs; technical evaluation answers with citations; a completed pilot scope with acceptance criteria; a gap list routed to the owner |
| KPIs | Share of evaluation questions answered without a product change request; number of scope items rejected as outside launch scope, reported rather than minimized; time from first technical call to a completed pilot scope document |
| Activation trigger | The first pilot is signed and a second prospect environment enters scoping concurrently; or one prospect's technical review generates architecture questions the founder cannot close within five working days without stopping execution work. Either condition alone is sufficient. |
| Current coverage | Founder/CEO answers technical evaluation questions today, with no prospect queue behind them. AI-covered via agent roster: `solutions-architect` lane, whose next action is turning `docs/PILOT_SCOPE_SKELETON.md` into a concrete first-pilot reference architecture. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | 8 |
| Required competencies | Pre-sales engineering in endpoint or identity infrastructure; UEM and IdP administration hands-on, not slideware; reading an unfamiliar estate quickly; the discipline to say "we cannot evidence that today" in front of a buyer |
| Customer/security implications | The first role that talks to a customer's security team. Its failure mode is a scope promise the product does not hold, which is why product surface changes and questionnaire answers are both outside its authority. |

### Endpoint & UEM domain expert

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | ACTIVE |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what device-management systems actually emit on the wire, and hold the line between evidence SignalGrid consumes and enforcement only an MDM or the OS can perform. |
| Responsibilities | Verify device dimensions against live servers rather than vendor documentation, across the Intune and Microsoft Graph, Apple and Jamf, Fleet, Headwind, Omnissa, and SOTI variants; record wire-truth findings including absent and unreliable fields; own the platform-honesty boundary in every customer-facing deployment document; specify what supervision, Apple Business Manager enrollment, and APNs actually require before a claim of on-device behavior is made; advise the connector work on evidence contracts without owning the code |
| Authority | Whether a device dimension is verified, documentation-verified, or unverified; which vendor field may be treated as a wire fact; whether a proposed device claim is platform-honest |
| Cannot approve alone | Adding a connector family or device dimension to launch scope; paid vendor trials or license purchases, which are owner-only; any statement that a vendor relationship or certification exists; enforcement claims of any kind |
| Inputs | Live lab instances (Fleet, Headwind); vendor API documentation; `docs/CONFIG_PROFILE_ORCHESTRATION_STRATEGY.md`; prospect estate details |
| Outputs | Wire-shape verification records per vendor; the verified-versus-unverified device dimension table; platform-honesty review notes on customer-facing documents |
| KPIs | Device dimensions verified against a live server, as a count of the nine, reported honestly including the unverified remainder; platform-honesty defects found before publication versus after; wire-truth records that name at least one absent or unreliable field, because a check that finds nothing usually checked nothing |
| Activation trigger | Active now. |
| Current coverage | Founder/CEO, from an endpoint and infrastructure operating background, is the domain expert of record. AI-covered via agent roster: `endpoint-uem-domain` lane, hiring priority 1 in the agent sequence, with Fleet and Headwind stood up and verified and seven device dimensions still unchecked against live emission. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Intune and Microsoft Graph, Jamf and Apple device management, at least one open-source MDM; supervision and enrollment mechanics; the ability to prove a documented field is absent on the wire |
| Customer/security implications | This role prevents the most damaging class of claim in the product's market — implying SignalGrid enforces something only a supervised device can enforce. An unknown or unreachable device signal must raise assurance, never lower it, and this role checks that the evidence contract preserves that. |

### Identity & access domain SME

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what identity providers actually assert about a session, and stop inference from filling the gaps they leave. |
| Responsibilities | Verify identity dimensions against live IdPs across the Entra ID, Okta, Keycloak, Ping, and FIDO2 or passkey variants; record which assertions are wire facts and which are deployment-configured or absent; specify how a session joins to a device when the IdP carries no device field; advise on shared-account attribution on shared devices, which is the product's central identity problem; keep token lifetime and session lifetime distinct in every customer document |
| Authority | Whether an identity assertion is a wire fact for a given IdP; which fallback applies when an assertion is absent; whether a proposed identity claim is derivable from a default deployment |
| Cannot approve alone | Adding identity dimensions to launch scope; authentication design changes in the decision core; any assurance-level claim presented to an assessor; vendor spend |
| Inputs | Live IdP lab instances; `docs/IDENTITY_LIVE_SHAPE_CHECK.md`; `docs/KEYCLOAK_LIVE_INTEGRATION.md`; prospect IdP configuration |
| Outputs | Per-IdP wire-truth tables; the derivability record for each assertion; identity sections of reference architectures |
| KPIs | Identity dimensions verified against a live IdP, as a count of the fifteen, with the unverified remainder stated; number of IdPs covered, currently one; assertions reclassified from assumed to absent after live testing |
| Activation trigger | Active now via the agent lane. Converts to a human or fractional engagement when a scoped environment depends on an assertion no free or self-hostable IdP can reproduce — the Entra `amr` claim and Okta session APIs are the known cases — or when two concurrent pilots run different IdPs. |
| Current coverage | AI-covered via agent roster: `iam-domain` lane, activated 2026-08-20, which drove five of the fifteen dimensions against a live Keycloak 26.4 and found `amr` and `auth_time` absent from every channel and the session record carrying no device field at all. Ten dimensions remain unverified and only one IdP has been driven (`docs/agent/org-roster.json`, `iam-domain` `nextAction`). |
| Human / fractional / AI-supported | AI-supported today; human or fractional at trigger |
| Hiring priority | - |
| Required competencies | OIDC and SAML at the protocol level; Entra ID, Okta, and Keycloak administration; FIDO2 and passkey assurance mechanics; token introspection and session management; scepticism toward claims a console displays but a token does not carry |
| Customer/security implications | Identity is where a trust gate most easily fails open. If an assurance level cannot be derived from the customer's actual IdP, the honest outcome is an unknown that raises the bar, not a plausible default that lowers it. |

### Network, NAC & connectivity domain SME

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what the network can and cannot prove about a device, and keep admission, carriage, egress, and reachability from collapsing into one another. |
| Responsibilities | Verify connectivity dimensions against live infrastructure across the RADIUS and 802.1X, Cisco ISE, Aruba ClearPass, Zscaler and Netskope, and carrier or private-5G variants; record where a network verdict is not an authentication fact, including quarantine returned as an accept and rejections that carry no reason; specify how an egress proxy or TLS interception changes what the device can observe about itself; keep the admission and carriage ladder intact in customer architectures; state plainly which sources remain unverifiable without a paid instance |
| Authority | Whether a network signal is admission, carriage, egress, or reachability; whether a NAC field may be treated as an authentication fact; which network claims a given estate can support |
| Cannot approve alone | Adding network dimensions to launch scope; paid carrier or vendor API access, which is owner-only; any claim that network posture substitutes for identity assurance |
| Inputs | Live RADIUS and NAC lab instances; `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`; `docs/NETWORK_EGRESS_LIVE_SHAPE_CHECK.md`; prospect network topology |
| Outputs | Network wire-truth records; the admission-versus-carriage mapping per estate; network sections of reference architectures |
| KPIs | Connectivity dimensions verified live, as a count of the six, with unverifiable sources named rather than omitted; documented cases where a network verdict was demoted from authentication fact; number of console adapters still documentation-verified only, currently two |
| Activation trigger | Active now via the agent lane. Converts to a human or fractional engagement when a scoped environment requires a NAC platform no lab instance covers, or when carrier or private-5G evidence enters a signed pilot scope, since neither has a free API. |
| Current coverage | AI-covered via agent roster: `network-domain` lane, activated 2026-08-19, which established that quarantine arrives as an Access-Accept, that rejections carry no reason, and that TLS interception is independently observable from the certificate issuer. Carrier remains entirely unverified; the two NAC console adapters are documentation-verified only. |
| Human / fractional / AI-supported | AI-supported today; human or fractional at trigger |
| Hiring priority | - |
| Required competencies | 802.1X, RADIUS, and NAC policy design; Cisco ISE or Aruba ClearPass operations; SSE and secure web gateway behavior; enterprise WLAN; the ability to distinguish a policy outcome from an authentication outcome |
| Customer/security implications | A quarantined device that looks admitted is exactly the failure this domain exists to prevent. Network degradation must never be read as identity failure, and a device that cannot see the network honestly is a device whose assurance goes up. |

### Security operations & telemetry domain SME

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what a customer's SIEM, EDR, and vulnerability tooling actually export, and keep a threat finding distinct from a vulnerability finding in every decision. |
| Responsibilities | Verify threat, vulnerability, and telemetry-integrity dimensions against live tooling across the Wazuh, CrowdStrike, Defender, Splunk, and Sentinel variants; work from exports rather than console views, because the two rarely agree; hold the threat-versus-vulnerability boundary in the evidence contract; specify what telemetry silence means and refuse to let absence read as health; advise on how a customer's SOC would receive and act on a SignalGrid concern without SignalGrid claiming to be a detection product |
| Authority | Whether a SecOps signal is a threat, a vulnerability, or a telemetry-integrity fact; whether an export field is trustworthy enough to influence a verdict; the routing recommendation for a raised concern |
| Cannot approve alone | Adding SecOps dimensions to launch scope; any detection, response, or remediation claim; incident-response commitments to a customer; vendor spend |
| Inputs | Live EDR and SIEM lab instances; vendor export schemas; the incident-playbook routing model; prospect SOC tooling inventory |
| Outputs | SecOps wire-truth records; the threat-versus-vulnerability mapping; SOC integration sections of reference architectures |
| KPIs | SecOps dimensions verified against real exports, as a count of the ten, unverified remainder stated; documented conflations found and corrected; share of raised concerns with a named receiving owner |
| Activation trigger | Active now via the agent lane. Converts to a human or fractional engagement when a scoped environment requires a commercial EDR or SIEM the lab cannot stand up, or when a customer's SOC becomes a named participant in a signed pilot. |
| Current coverage | AI-covered via agent roster: `secops-domain` lane, registered at agent priority 2, with Wazuh stood up under `proof:live-edr` and nine dimensions still to check against real exports. |
| Human / fractional / AI-supported | AI-supported today; human or fractional at trigger |
| Hiring priority | - |
| Required competencies | SOC operations; EDR and SIEM data models and export formats; vulnerability management practice; alert routing and ownership design; the habit of reading the export, not the dashboard |
| Customer/security implications | SignalGrid is not a detection product and must not be scoped as one. A quiet telemetry plane and a healthy device produce the same silence, and treating that silence as a pass is how a measurement plane manufactures a grant. |

### Physical access, OT & IoT domain SME

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what physical and operational-technology systems can prove about where a device is and who holds it, and keep SignalGrid outside every safety-instrumented loop. |
| Responsibilities | Verify location, custody, and OT dimensions across the physical access control, RTLS with BLE or UWB, Traccar, CMMS, and OT historian variants; state which of these can ever be verified against a free or open instance and which are structurally documentation-only; own the safety-independence boundary, so that no safety function ever depends on a SignalGrid verdict; specify how custody transfer is evidenced on a shared device; advise on zone modeling for warehouse and industrial estates |
| Authority | Whether a location or custody signal is verifiable in a given estate; the zone model recommended for a site; whether a proposed OT signal crosses the safety-independence boundary |
| Cannot approve alone | Adding location, custody, or OT dimensions to launch scope; any claim involving safety systems or life-safety function; physical security assessments, which need a qualified professional; vendor spend |
| Inputs | Traccar and equivalent lab instances; access control and RTLS vendor documentation; site floor plans and zone definitions supplied by a prospect |
| Outputs | Location and custody wire-truth records; the verifiable-versus-documentation-only split for the five dimensions; the safety-independence statement in each site architecture |
| KPIs | Dimensions with a live source, currently one of five, with the remainder classified rather than left ambiguous; safety-boundary reviews completed before any OT scope is accepted; custody-transfer scenarios covered by a fixture |
| Activation trigger | Active now via the agent lane. Converts to a human or fractional engagement when a signed pilot includes a physical access control system, an RTLS deployment, or any device that crosses an OT zone boundary. |
| Current coverage | AI-covered via agent roster: `physical-ot-domain` lane, registered at agent priority 2, with Traccar verified and four dimensions — RTLS custody, custody beacon, PACS access, and OT posture — holding no live source. |
| Human / fractional / AI-supported | AI-supported today; human or fractional at trigger |
| Hiring priority | - |
| Required competencies | Physical access control systems and badge infrastructure; RTLS and BLE or UWB positioning; OT and ICS network segmentation practice, including Purdue-model zoning; CMMS and asset custody workflows |
| Customer/security implications | Location and custody are the most persuasive and least verifiable signals in the product. Overstating them is how a decision looks confident and is wrong; and no SignalGrid verdict may sit between a worker and a safety system. |

### ITSM, ITOM & digital-experience domain SME

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | COVERED |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Establish what a customer's systems of record say about change windows, shifts, tasks, and device experience, and keep those records as context rather than authority. |
| Responsibilities | Verify operational-context dimensions across the ServiceNow, Jira Service Management, warehouse management, osquery, and digital-experience or DEX variants; test against what a real ITSM exports for approval windows and assignment state, not what a workflow diagram implies; hold the systems-of-record boundary, so the customer's ITSM stays authoritative and SignalGrid stays a consumer; distinguish an uninstrumented endpoint from an unreachable measurement plane from a genuinely healthy device; advise on how change windows and shift context enter a decision without becoming a bypass |
| Authority | Whether an operational-context field is exported reliably; how a change window or shift boundary is represented; which DEX measurement states are distinguishable in a given estate |
| Cannot approve alone | Adding operational-context dimensions to launch scope; any claim to replace or act as a system of record; automated remediation of any kind; vendor spend |
| Inputs | Self-hosted ITSM lab instances; osquery via the Fleet lab; DEX and observability vendor documentation; prospect process documentation |
| Outputs | Operational-context wire-truth records; the systems-of-record boundary statement per estate; change-window and shift-context modeling notes |
| KPIs | Operational-context dimensions verified against a real export, as a count of the six; measurement states kept distinguishable in every DEX-derived signal, target 100 percent; documented cases where an ITSM field proved unreliable as an authority |
| Activation trigger | Active now via the agent lane. Converts to a human or fractional engagement when a signed pilot's decisions depend on the customer's ITSM approval state, or when a DEX platform becomes a named evidence source in a pilot scope. |
| Current coverage | AI-covered via agent roster: `itsm-ops-domain` lane, registered at agent priority 2, with osquery verified through the Fleet lab and change-window, shift-context, and task-exception still unchecked against a real ITSM export. |
| Human / fractional / AI-supported | AI-supported today; human or fractional at trigger |
| Hiring priority | - |
| Required competencies | ITSM and ITOM platform administration; change and approval process design; osquery; DEX and endpoint observability tooling; the ability to tell an absent measurement from a good one |
| Customer/security implications | A change window is a customer decision, not a permission SignalGrid grants itself. And an endpoint nobody instrumented, a monitoring plane that is down, and a fast healthy device must never resolve to the same answer. |

### Cloud & platform deployment engineer

| Field | Value |
|---|---|
| Division | Domain & solutions engineering |
| Status | FUTURE |
| Reports to | VP Solutions / Chief Solutions Architect |
| Mission | Make SignalGrid installable, upgradable, and verifiable inside an environment the company does not operate. |
| Responsibilities | Own the customer-hosted and hybrid deployment paths in `docs/DEPLOYMENT_MODELS.md`, including the split between a hosted control plane and a resident decision plane; produce installation, upgrade, and rollback runbooks a customer's platform team can execute unaided; define the minimum privilege posture the deployment requires, including the database role split already proven in this repository; specify how a customer verifies their own installation, since the company cannot observe it; handle data residency, egress restriction, and air-gapped constraints as deployment inputs rather than exceptions |
| Authority | The supported installation topologies; the privilege posture a deployment requires; whether a customer-imposed constraint is satisfiable without a product change |
| Cannot approve alone | Any hosted-service, uptime, or support commitment; changes to launch-profile classifications; customer-specific forks or one-off builds; infrastructure spend, which is owner-only; residency or sovereignty claims of a legal nature |
| Inputs | `docs/DEPLOYMENT_MODELS.md`; `docs/DEPLOYMENT.md`; `docs/BACKUP_AND_RESTORE.md`; the container and packaging surface; customer platform constraints |
| Outputs | Installation and upgrade runbooks per model; the privilege and network requirement matrix; a customer-runnable installation verification procedure |
| KPIs | Installation steps executed by a customer without company assistance, as a share of total steps; documented rollback paths per upgrade, target one each; verification procedures that fail correctly when seeded with a broken install |
| Activation trigger | A signed pilot requires deployment into an environment SignalGrid does not operate — customer VPC, on-premises, or air-gapped — or a prospect's security review makes customer-hosted deployment a precondition of evaluation. |
| Current coverage | No dedicated coverage. The deployment models are documented as design, not as a shipped installation path. AI-covered in part via agent roster: the `sre` lane for CI and operability and the `data-persistence-engineer` lane for the proven runtime and admin database role split. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Container and Kubernetes packaging; Postgres operations including backup, restore, and privilege design; secrets handling in customer-controlled environments; writing runbooks for an operator who cannot ask a question |
| Customer/security implications | A customer-hosted deployment moves security posture into hands the company cannot see, so the installation must be minimally privileged by default and self-verifiable. Restore and provenance paths matter as much as install: evidence that cannot be shown to be intact is evidence an assessor discounts. |

## Industry solutions

**Measurable output:** fit the product to regulated verticals.

The decision engine is vertical-agnostic — identity, device, workflow, and
context, decided at the edge. What changes per vertical is the workflow
vocabulary, the stakes, the procurement path, and the evidence a reviewer
expects. This division exists to hold that difference without letting it widen
the product.

**No customer, pilot, deployment, or design-partner relationship exists in any
vertical today.** Every role below except the divisional lead is FUTURE, and
every activation trigger is a signed or scoped pilot, not a market opportunity.
The vertical positioning that exists today is written material only, in
`docs/WHY_SIGNALGRID_VERTICALS.md`.

Three constraints bind the whole division. Launch scope is frozen by DR-005: a
vertical requirement becomes a decision-record candidate for the owner, never a
feature a vertical lead ships. The embedded UX law holds: domain safety —
patient lookup, clinical guidance, hazardous-goods rules — belongs in the host
application, and SignalGrid returns allow, step-up, restrict, or deny around it.
And Claude Code does not guarantee HIPAA or SOC 2 conformance; regulated work
requires a human compliance review, which is a requirement rather than an
option.

### Head of Industry Solutions

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Decide which verticals the company pursues and in what order, and keep vertical framing inside what the product can evidence. |
| Responsibilities | Own the vertical sequence and the written rationale for it; hold vertical positioning to the frozen launch scope and route every vertical requirement to a decision record instead of a build; maintain the workflow vocabulary per vertical so a buyer's language maps onto the gate's four verdicts; define what a first pilot must demonstrate in each vertical before the vertical is called viable; retire a vertical publicly when the evidence does not support it |
| Authority | Vertical sequencing and de-prioritization; which vertical claims may appear in public material; what constitutes a viable first pilot in a vertical |
| Cannot approve alone | Any statement that a customer, pilot, partnership, or reference exists; regulatory or certification claims of any kind; product scope changes for a vertical; pricing or vertical packaging, which is owner-only; hiring within the division |
| Inputs | `docs/WHY_SIGNALGRID_VERTICALS.md`; `docs/PILOT_READINESS_CRITERIA.md`; the ratified launch profile; inbound market signal recorded in the intake ledger |
| Outputs | The vertical sequence with rationale; per-vertical workflow vocabularies; vertical viability assessments; the public vertical narrative |
| KPIs | Vertical claims in public material that trace to a repository artifact, target 100 percent; verticals explicitly de-prioritized with a written reason, reported rather than left open; decision-record candidates raised versus vertical features shipped outside scope, where the second number must be zero |
| Activation trigger | Active now as a founder-held duty, exercised through written positioning only. Separates into its own role when two verticals hold concurrent scoped pilots. |
| Current coverage | Founder/CEO, whose lived operating background sets healthcare as the first vertical. AI-covered via agent roster: `positioning-messaging` and `icp-customer-research` lanes, both registered at agent priority 1 and neither activated. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Vertical go-to-market judgment; frontline operational workflows across at least two industries; regulatory landscape literacy without claiming compliance authority; the willingness to kill a vertical narrative that outruns the evidence |
| Customer/security implications | Vertical language is where a general product quietly acquires claims it cannot support. This role's main control is that a vertical need becomes a decision record for the owner, not a shipped surface. |

### Healthcare & clinical solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Make the Assist gate fit real clinical shared-device workflows without SignalGrid ever making a clinical decision. |
| Responsibilities | Map shared-device clinical workflows — medication administration, chart access, device handoff between shifts — onto gate verdicts, with the clinical logic staying in the host application; define what step-up means at the bedside when the host application, not SignalGrid, owns the authenticator; work with the clinical customer's own compliance and privacy review as the gating authority; specify the evidence a hospital's security review expects and the boundary where the answer is "we do not have that"; carry clinical workflow findings back as decision-record candidates |
| Authority | Clinical workflow mapping and vocabulary; which workflows are in a pilot's scope; whether a proposed clinical claim crosses into clinical decision support, which is out of bounds |
| Cannot approve alone | Any HIPAA, BAA, or compliance statement, which requires a human compliance review and the owner; any patient-data handling arrangement; clinical safety claims; product changes for a clinical requirement; pilot commercial terms |
| Inputs | `docs/WHY_SIGNALGRID_VERTICALS.md`; `docs/SECURITY_QUESTIONNAIRE_PACK.md`; `docs/EMBEDDED_UX_PRINCIPLE.md`; the host application's own workflow definitions supplied by the pilot organization |
| Outputs | Clinical workflow-to-verdict maps; the clinical pilot scope; a written list of unanswerable compliance questions routed to the owner; post-pilot verdict-accuracy findings |
| KPIs | Verdict accuracy on scoped clinical workflows, measured against clinician review rather than self-assessment; clinical workflows mapped without a product scope change; compliance questions answered with evidence versus escalated, both reported |
| Activation trigger | No relationship with any healthcare organization, clinical system vendor, or EHR vendor exists today. This role activates when a healthcare organization signs a pilot that names at least one clinical workflow, a shared-device fleet, and a start date, and their compliance review opens. |
| Current coverage | Not covered. Healthcare positioning exists as written material in `docs/WHY_SIGNALGRID_VERTICALS.md` and the founder's endpoint background in healthcare estates; there is no clinical subject-matter expert in the company and no agent lane claims clinical expertise. |
| Human / fractional / AI-supported | Human, with fractional clinical informatics advice; AI-supported |
| Hiring priority | - |
| Required competencies | Clinical informatics or hospital IT operations; shared-device and badge-tap workflows at the bedside; healthcare security review processes; the discipline to keep clinical judgment out of an infrastructure product |
| Customer/security implications | The highest-stakes vertical and the one where an over-claim is least recoverable. Domain safety stays in the host application; no BAA, HIPAA attestation, or clinical safety claim may originate from this role; and a shadow-mode pilot must be described as measuring verdict correctness, not as enforcing anything. |

### Municipal & public-sector solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Fit shared-device decisions to public-sector workflows and answer procurement on the public record without overstating what exists. |
| Responsibilities | Map municipal frontline workflows — inspections, field permits, public-safety support devices, shared counter terminals — onto gate verdicts; own responses to public-sector questionnaires and RFPs within evidenced limits, escalating everything else; track records-retention and public-records implications of decision logs as a customer requirement; work the resilience framing already drafted in `docs/SIGNALGRID_MUNICIPAL_CRITICAL_SERVICES_RESILIENCE_MODEL.md` against what the launch profile actually holds; keep procurement language free of authorization claims the company does not hold |
| Authority | Municipal workflow mapping; which RFP questions are answerable from repository evidence; whether a procurement requirement is satisfiable within frozen scope |
| Cannot approve alone | Any FedRAMP, StateRAMP, CJIS, or equivalent authorization statement, none of which exist; contractual or bid commitments; retention or records-management guarantees; pricing and public-bid terms, which are owner-only |
| Inputs | `docs/SIGNALGRID_MUNICIPAL_CRITICAL_SERVICES_RESILIENCE_MODEL.md`; `docs/SECURITY_QUESTIONNAIRE_PACK.md`; the launch profile; the issuing body's procurement documents |
| Outputs | Municipal workflow-to-verdict maps; RFP and questionnaire response drafts with citations; a written list of unmet procurement prerequisites; pilot scope for a named department |
| KPIs | RFP questions answered from cited evidence versus marked unmet, both reported; procurement prerequisites identified before bid rather than during; scoped workflows delivered without a product change request |
| Activation trigger | No relationship with any government body exists today, and the company holds no public-sector authorization. This role activates when a public-sector body issues a questionnaire or RFP naming SignalGrid's category, or a municipal pilot is scoped with a named department and device fleet. |
| Current coverage | Not covered. One drafted resilience model exists as written material; no procurement response process exists. |
| Human / fractional / AI-supported | Human, with fractional public-sector procurement advice; AI-supported |
| Hiring priority | - |
| Required competencies | Public-sector IT operations and procurement; government security frameworks, understood well enough to say plainly which ones do not apply; records retention practice; writing bid responses that survive a public-records request |
| Customer/security implications | Procurement documents become public records, so an unsupportable claim becomes permanent. The safe posture is stating the authorization the company does not hold, in the response, before someone else does. |

### Warehouse & logistics solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Fit the gate to high-turnover scanner and tablet fleets where downtime is measured in minutes and workers change hourly. |
| Responsibilities | Map warehouse workflows — pick and pack, controlled-area entry, equipment checkout, shift handover — onto gate verdicts; specify the device-checkout and custody model for rugged scanner fleets, including charging-rack transitions; define what a step-up may cost a worker in seconds before it becomes a workaround, and design against the workaround; work with the customer's warehouse management system as the system of record for task state; measure operational impact honestly, including cases where the gate slowed work down |
| Authority | Warehouse workflow mapping; the custody and checkout model recommended for a site; which controlled areas warrant a step-up rather than an allow |
| Cannot approve alone | Throughput, uptime, shrink, or safety outcome guarantees; product changes for a workflow; any WMS vendor relationship claim; pilot commercial terms |
| Inputs | `docs/WHY_SIGNALGRID_VERTICALS.md`; the site's WMS task model; zone definitions from the physical and OT domain SME; device fleet inventory |
| Outputs | Warehouse workflow-to-verdict maps; the site custody and zone model; a pilot scope naming fleet size and sites; measured operational-impact findings including negatives |
| KPIs | Median added seconds per gated workflow step, measured not estimated; observed workaround behaviors, reported rather than suppressed; verdict accuracy on controlled-area entry against site records |
| Activation trigger | No warehouse, third-party logistics, or distribution customer exists today. This role activates when a pilot is scoped naming a warehouse management system of record, a device fleet count, and at least one controlled area. |
| Current coverage | Not covered. Warehouse positioning exists as written material only. AI-covered in part via agent roster: `itsm-ops-domain` holds the WMS evidence question, unverified. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Warehouse and distribution operations; rugged device fleet management at scale; WMS platforms; time-and-motion literacy, because a gate that costs too much gets bypassed rather than complained about |
| Customer/security implications | In a high-throughput environment, a gate that is slow is a gate that is defeated. The honest measure is added seconds and observed workarounds, and both belong in the pilot report even when they are unflattering. |

### Frontline shared-device practice lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Turn what recurs across verticals into a reusable shared-device pattern library, so the second pilot in a shape costs less than the first. |
| Responsibilities | Extract recurring shared-device patterns — handover, custody transfer, shift boundary, borrowed-device, lost-and-found — from delivered pilots into reusable workflow templates; maintain the template library in `docs/APP_WORKFLOW_TEMPLATES.md` against what the launch profile supports; keep templates as configuration rather than product surface, and route anything that would require new surface to a decision record; identify which patterns fail across verticals and write down why; feed pattern evidence into the fixture suite so a template is provable rather than described |
| Authority | Which patterns enter the template library; the canonical shape of a pattern; whether a pilot-specific variation generalizes or stays local |
| Cannot approve alone | New product surfaces to support a pattern; launch-profile changes; claims that a template is validated in a vertical without a completed pilot; publication of customer-derived material |
| Inputs | Completed pilot workflow definitions; `docs/APP_WORKFLOW_TEMPLATES.md`; `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md`; the fixture and proof suites |
| Outputs | The shared-device pattern library; per-pattern fixtures; a written record of patterns that failed to generalize |
| KPIs | Patterns in the library with a backing fixture, target 100 percent; reuse rate of existing templates in a new pilot scope; scoping time for the second pilot in a pattern versus the first |
| Activation trigger | Three pilots across at least two verticals have produced written workflow definitions, and at least two of them describe the same handover or custody pattern. Until that comparison exists there is nothing to generalize from. |
| Current coverage | Not covered as a distinct role. Template material exists as written design; the underlying pattern is the product's own subject, held by the founder and the product lanes. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Frontline operations across more than one industry; workflow abstraction without over-generalizing; fixture and scenario design; the judgment to leave a one-off as a one-off |
| Customer/security implications | A template that is described but never exercised is a claim, not a capability. Every pattern needs a fixture that proves it, and none may quietly add product surface outside the frozen launch scope. |

### Industrial & OT solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Fit shared-device decisions to plant and industrial environments while keeping SignalGrid structurally outside safety and control loops. |
| Responsibilities | Map industrial workflows — maintenance rounds, permit-to-work, contractor device entry, zone-restricted tasks — onto gate verdicts; hold the safety-independence boundary as a hard architectural rule, so no safety-instrumented function ever depends on a SignalGrid verdict; work zone and segmentation models with the physical and OT domain SME; specify how contractor and temporary-worker devices are treated when they are not enrolled in the customer's UEM; state clearly which OT evidence a plant can supply and which is structurally unavailable |
| Authority | Industrial workflow mapping; the zone model applied to a plant; whether a proposed OT scope respects safety independence, with a veto if it does not |
| Cannot approve alone | Any safety, functional-safety, or IEC 62443 conformance claim; scope that places a verdict inside a control or safety loop, which is prohibited outright; product changes for an OT requirement; pilot commercial terms |
| Inputs | Plant zone and segmentation documentation; the physical and OT domain SME's dimension records; `docs/WHY_SIGNALGRID_VERTICALS.md`; the customer's permit-to-work process |
| Outputs | Industrial workflow-to-verdict maps; the written safety-independence statement per site; contractor-device handling procedure; a pilot scope naming zones and workflows |
| KPIs | Safety-independence reviews completed before scope acceptance, target 100 percent; scoped workflows that touch no control-system dependency, target all of them; verdict accuracy on zone-restricted task entry |
| Activation trigger | No industrial customer or site exists today. This role activates when a pilot scope includes a device that crosses an OT or ICS zone boundary, or a prospect asks for an OT-posture signal to influence a decision. |
| Current coverage | Not covered. AI-covered in part via agent roster: `physical-ot-domain` lane holds the OT-posture dimension, which has no live source and may be structurally documentation-only. |
| Human / fractional / AI-supported | Human, with fractional OT security advice; AI-supported |
| Hiring priority | - |
| Required competencies | Industrial operations and plant IT and OT convergence; segmentation and zone architecture; permit-to-work and contractor management processes; enough functional-safety literacy to recognize a boundary before crossing it |
| Customer/security implications | In an industrial setting the worst outcome is not a wrong verdict, it is a verdict a safety system waited on. Independence from safety and control loops is architectural, not a policy, and this role holds a veto over scope that would erode it. |

### Field services & mobile-workforce solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Make decisions hold up for workers who are alone, mobile, and frequently offline. |
| Responsibilities | Map field workflows — job start, parts and asset checkout, vehicle-mounted device use, lone-worker check-in — onto gate verdicts; specify decision behavior when connectivity is intermittent, including which evidence has gone stale and what that must do to assurance; work the resident decision-plane deployment path with the cloud and platform deployment engineer, since offline tolerance is a deployment property; define device custody for vehicle-mounted and take-home devices; keep lone-worker safety features in the host application where they belong |
| Authority | Field workflow mapping; the staleness thresholds recommended for an estate; whether a workflow is safe to gate at all under intermittent connectivity |
| Cannot approve alone | Lone-worker safety or duty-of-care claims; offline enforcement claims; changes to freshness or staleness handling in the decision core; product scope changes; pilot commercial terms |
| Inputs | `docs/DEPLOYMENT_MODELS.md` hybrid and resident decision-plane material; connectivity profiles from the network domain SME; the customer's field service management platform; vehicle and device inventory |
| Outputs | Field workflow-to-verdict maps; the staleness and offline behavior specification per estate; custody model for vehicle-mounted devices; a pilot scope naming route or region coverage |
| KPIs | Share of scoped workflows with a defined offline behavior, target 100 percent; measured decision availability during connectivity loss; cases where stale evidence lowered rather than raised assurance, which must be zero |
| Activation trigger | No field-services customer exists today. This role activates when a pilot includes vehicle-mounted or lone-worker devices operating below continuous connectivity, or a prospect requires a resident decision plane for offline operation. |
| Current coverage | Not covered. Offline tolerance is a documented design property of the hybrid deployment model, exercised in fixtures rather than in a customer estate. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Field service operations; mobile and vehicle-mounted device fleets; intermittent-connectivity system design; lone-worker duty-of-care practice, understood well enough to keep it out of the product |
| Customer/security implications | Offline is where fail-closed gets tested for real. Evidence that has aged out is unknown evidence, and unknown must raise the bar rather than quietly grant, whatever it costs the worker's convenience. |

### Regulated-enterprise solutions lead

| Field | Value |
|---|---|
| Division | Industry solutions |
| Status | FUTURE |
| Reports to | Head of Industry Solutions |
| Mission | Carry SignalGrid through the security and assurance reviews of large regulated buyers without acquiring a claim the company cannot defend. |
| Responsibilities | Own the assessor-facing narrative for regulated enterprises across the financial services, pharmaceutical, energy, and large multi-site variants; map buyer control frameworks onto executable proofs in the repository and mark honestly where no proof exists; run third-party risk and vendor security reviews, escalating every question that needs a human compliance opinion; specify tenant isolation, evidence integrity, and provenance answers a reviewer will test rather than accept; coordinate fractional assessor engagements when the owner approves one |
| Authority | Which control claims are evidenced by a named proof; the shape of assessor-facing documentation; whether a review question is answerable or must be escalated |
| Cannot approve alone | Any certification, attestation, audit, or framework-conformance statement, none of which the company holds; contractual security commitments or SLAs; assessor or auditor engagements and their cost, which are owner-only; any claim that a control is covered when the mapping is aspirational |
| Inputs | `docs/SECURITY_QUESTIONNAIRE_PACK.md`; the proof and gate estate; the threat model; the buyer's control framework and questionnaire |
| Outputs | Control-to-proof mappings with explicit gaps; questionnaire responses with citations; the escalation list of questions requiring human compliance review; assessor engagement scope proposals for the owner |
| KPIs | Control claims backed by a runnable proof, as a share of claims made; questionnaire responses citing a repository path or an explicit gap, target 100 percent; findings where a reviewer disproved a stated control, which must be zero |
| Activation trigger | No regulated-enterprise prospect, assessor engagement, or certification exists today. This role activates when a prospect's security review requires a control mapping beyond `docs/SECURITY_QUESTIONNAIRE_PACK.md`, or names an external assessor or auditor as a gate on the pilot. |
| Current coverage | AI-covered in part via agent roster: `compliance-analyst` lane, which verifies partner-facing drafts against what the tree can evidence and explicitly cannot sign off. Sign-off is the owner's, and a human compliance review is required rather than optional for regulated verticals. |
| Human / fractional / AI-supported | Human, with fractional assessor and compliance counsel; AI-supported |
| Hiring priority | - |
| Required competencies | Enterprise third-party risk and vendor security review; control framework literacy across common regimes; evidence-based questionnaire response writing; the discipline to write "no coverage" where there is none |
| Customer/security implications | This role sits closest to the line the claims gate defends. Every mapping it publishes must survive a reviewer opening the cited file and running the cited command, and the independent assurance layer — can we prove it, can this fail open, are tenant boundaries real, could evidence be stale, can provenance be manipulated — is the standard it answers to, not the buyer's patience. |

## Sales & revenue

**Leadership:** CRO. **Measurable output:** convert qualified demand to revenue.

SignalGrid has no customers, no signed pilots, and no revenue as of August 21, 2026. Every role below is written so that it can be activated without changing a single product claim: launch scope is frozen by DR-005, and no sales role may widen it. Founder-led selling stays founder-led for a long time by design — the first sales hires in this division are the ones that remove work from the founder, not the ones that add a layer above them.

### Chief Revenue Officer

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Own the path from qualified interest to a signed, deliverable deployment without ever selling something the evidence estate cannot back. |
| Responsibilities | Own the revenue plan and the definition of a qualified opportunity; run founder-led sales calls and evaluations end to end; approve which claims may appear in a sales conversation, bounded by the claims gate; decide deal shape (scope, term, success criteria) within owner-set commercial limits; keep the deal record — who asked for what, what was promised, what was proven — in the repo, not in a founder's head; escalate every scope-widening request to an owner decision instead of absorbing it |
| Authority | Deal qualification and disqualification; meeting and evaluation sequencing; which existing proofs to show and in what order; walking away from an opportunity |
| Cannot approve alone | Any dollar figure, discount, or billing term (owner-only); any product-scope widening (requires a decision record superseding DR-005); any statement of partnership, certification, attestation, SLA, or reference customer; contract signature; access to a prospect's tenant or data |
| Inputs | Inbound interest from signalgrid.app and the founder's network; ICP and positioning material from the go-to-market lanes; the launch profile (`scripts/launch-profile.mjs`) as the hard edge of what is sellable; proof and gate results as the evidence pack |
| Outputs | Qualified-opportunity list with disqualification reasons; deal records with promised-vs-proven columns; a running list of the specific capabilities prospects asked for that do not exist, ranked, handed to Product |
| KPIs | Percentage of claims made in sales conversations that map to a named proof artifact (target 100%, audited by sampling); days from first contact to a written yes/no; count of qualified evaluations in flight; count of scope-widening requests escalated rather than absorbed |
| Activation trigger | Active now — founder-covered. A hired CRO activates only after two account executives are in seat and consistently sourcing their own pipeline; not before. |
| Current coverage | Dan Fashauer (founder/CEO) performs all of it. Supporting desk work is AI-covered via agent roster: positioning-messaging, icp-customer-research, and competitive-analyst lanes. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Enterprise infrastructure selling to IT/security buyers; ability to run a technical evaluation without an SE; reading a proof/gate report well enough to know what it does and does not establish; discipline to refuse a claim that would close a deal |
| Customer/security implications | This is the role most able to damage the company by overstating. Every commitment made here becomes a truth obligation the claims gate and a future assessor will test. Under-promising costs a deal; over-promising costs the trust thesis the product is built on. |

### Enterprise account executive (including strategic accounts)

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | FUTURE |
| Reports to | CRO (founder/CEO while COVERED) |
| Mission | Carry named enterprise and strategic accounts from first conversation to signed deployment, with the same evidence discipline the founder uses. |
| Responsibilities | Own a named account list and the multi-threading inside it (IT, security, clinical or operational ownership, procurement); run evaluations against the customer's real device and signal environment; assemble the evidence pack per deal from existing proofs rather than new assertions; maintain the deal record and the promised-vs-proven column; hand implementation a written, testable success definition before signature; variant — strategic accounts: multi-site or multi-tenant buyers requiring a named executive sponsor and a longer evaluation |
| Authority | Account strategy and contact plan; evaluation design within existing product scope; qualifying an account out |
| Cannot approve alone | Pricing, discounts, and payment terms (owner-only); non-standard contract language; roadmap commitments or dates; any partnership, certification, or customer reference claim; custom engineering work |
| Inputs | Qualified pipeline; launch-profile scope; the proof estate and its published figures; the deal-desk template once it exists |
| Outputs | Signed deployments with written success criteria; account records; a field-truth report naming what buyers actually blocked on |
| KPIs | Closed deployments per period against plan; percentage of deals whose success criteria were written before signature (target 100%); evaluation-to-close conversion; count of post-signature scope disputes traced to a promise not in the deal record (target 0) |
| Activation trigger | Three or more qualified evaluations are in flight at once, **or** founder time spent on sales displaces more than one engineering-decision day per week for four consecutive weeks. Whichever comes first. |
| Current coverage | Not covered as a distinct role. The founder performs enterprise selling directly; there is no account executive, and no account list exists yet. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Enterprise IT/security sales cycles with procurement and security review; shared-device operational environments (healthcare, municipal, warehouse); technical literacy sufficient to run an evaluation unaided; comfort selling a fail-closed product whose correct answer is sometimes "deny" |
| Customer/security implications | First non-founder voice that speaks for the company to a buyer. Requires an onboarding gate on claim discipline before the first customer call, and sampled review of claims made, because a single fabricated capability statement is a public-truth failure. |

### Sales engineer / solutions consultant

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | COVERED |
| Reports to | CRO (founder/CEO while COVERED) |
| Mission | Make the decision core's behavior legible to a technical buyer, using runnable evidence rather than slides. |
| Responsibilities | Run technical evaluations, demos, and proof walkthroughs against the ratified launch surfaces; translate a buyer's device estate and signal sources into the three ratified connector families and say plainly what is not covered; answer security questionnaires from the existing evidence estate and mark unanswerable items unanswerable; reproduce a buyer's edge case as a fixture and show the resulting decision; feed every unsupported request into the Product backlog with the buyer's exact wording; variant — solutions consulting: workshop-style scoping for multi-site buyers |
| Authority | Demo and evaluation content within ratified scope; which fixtures to build for a prospect; declaring a questionnaire item unanswerable |
| Cannot approve alone | Any capability statement outside the launch profile; performance or latency numbers not produced by `bench:*` or `test:load` on a named run; compliance answers implying certification or attestation; direct changes to the decision core to satisfy a prospect |
| Inputs | Prospect environment details; launch profile; proof suite and benchmark outputs; the connector family classifications |
| Outputs | Evaluation reports; prospect-specific fixtures committed to the repo; answered questionnaires with sourced answers; a ranked list of capability gaps that cost deals |
| KPIs | Percentage of technical answers with a linked artifact (target 100%); evaluation cycle time; count of demo assertions later found unsupported (target 0); fixtures contributed per evaluation |
| Activation trigger | Active now, in the founder-plus-agent form. A dedicated hire activates when two account executives are in seat, or when evaluation support exceeds ten hours a week for a month. |
| Current coverage | Founder performs the buyer-facing half. Technical scoping is AI-covered via agent roster: solutions-architect lane, with the endpoint-uem-domain and iam-domain lanes supplying signal-source detail and the compliance-analyst lane sourcing questionnaire answers. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Endpoint/UEM, identity, and network signal literacy; ability to read the decision core and its fixtures; questionnaire and security-review experience; willingness to say "we cannot prove that yet" in front of a buyer |
| Customer/security implications | The role that most often meets the security reviewer. Sourced, reproducible answers are the difference between passing review and being asked to prove something twice. |

### Commercial lead — pricing, packaging and contract desk

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Keep the commercial shape of the product — what is a unit, what is included, what is chargeable work — consistent with what the product actually does. |
| Responsibilities | Maintain the packaging model (what a tier includes, per what unit) and keep it aligned with the ratified launch profile; define the standard commercial terms and the escalation path for non-standard ones; hold the deal-desk function: review non-standard deals before they reach the owner; keep cost-to-serve inputs current so pricing decisions have real numbers behind them; ensure no packaging tier names a capability that is deferred or demo-only |
| Authority | Packaging structure and tier boundaries; which deals are standard and which require owner review; the commercial-terms template's non-financial clauses |
| Cannot approve alone | Any dollar amount, list price, discount, or billing term — those are owner-only by DR-005 item 4 and the cost model's own rule; contract signature; capability inclusion beyond the launch profile; customer-specific dependencies priced as if they were baseline |
| Inputs | Launch-profile classifications; cost model inputs; field feedback on how buyers want to buy; commercial counsel guidance |
| Outputs | Packaging definition; deal-desk review notes; standard-terms template; the list of capabilities that would be customer-funded rather than baseline |
| KPIs | Percentage of packaged capabilities that map to a ratified launch item (target 100%); non-standard deals reviewed before owner escalation (target 100%); time from deal-desk request to answer |
| Activation trigger | Active now. A dedicated hire activates when non-standard deal reviews exceed two per week or a second sales channel (partner-sourced) starts producing deals with different economics. |
| Current coverage | Founder holds all financial decisions. Structure and analysis are AI-covered via agent roster: pricing-packaging-analyst lane, with finance-fundraising and commercial-counsel-liaison lanes on cost inputs and terms. |
| Human / fractional / AI-supported | Human (founder), AI-supported; fractional counsel for contract language |
| Hiring priority | - |
| Required competencies | Enterprise software packaging for infrastructure products; cost-to-serve modeling; contract literacy sufficient to spot a clause that creates an unprovable obligation |
| Customer/security implications | Packaging is a claim surface. A tier that lists a deferred capability is a false claim in a commercial document, which is harder to retract than a slide. |

### Pipeline development representative (SDR/BDR)

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | FUTURE |
| Reports to | CRO (founder/CEO while COVERED) |
| Mission | Create qualified first conversations with the specific buyers who own shared frontline devices, without generic outbound. |
| Responsibilities | Research and prioritize target accounts against the ICP definition; run outbound sequences that lead with a technical artifact rather than a pitch; qualify inbound from signalgrid.app and the technical blog against explicit criteria; hand over conversations with the buyer's stated problem in their own words; keep the disqualification log — who is not a fit and why |
| Authority | Sequencing, messaging variants within approved claim boundaries, and disqualification of unfit accounts |
| Cannot approve alone | Any new claim or capability statement in outbound copy; use of a customer, partner, or logo reference; pricing indications; adding a vertical outside the ICP |
| Inputs | ICP definition; approved messaging library; inbound from the site and blog; account research |
| Outputs | Qualified conversations with written context; disqualification log; message-performance data that tells Marketing which framing lands |
| KPIs | Qualified conversations per period; percentage accepted by the closing role (target above 70%); percentage of outbound copy traceable to the approved claim library (target 100%) |
| Activation trigger | Inbound qualified conversations exceed what one person can answer within two business days for four consecutive weeks, **and** at least one paid deployment has closed. Outbound before a repeatable close is premature. |
| Current coverage | Not covered as a distinct role. Outbound today is founder-run and low-volume; ICP and messaging groundwork is AI-covered via agent roster: icp-customer-research, positioning-messaging, and design-partner-outreach lanes. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Technical outbound to IT and security buyers; research discipline; ability to work from a fixed claim library without improvising capabilities |
| Customer/security implications | Highest-volume claim surface in the company. Copy must be library-bound and sampled, because outbound reaches strangers who will not check. |

### Revenue operations, deal desk and territory planning

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | FUTURE |
| Reports to | CRO |
| Mission | Make revenue data true — one pipeline, one forecast, one definition of every stage — so decisions rest on numbers nobody has to re-derive. |
| Responsibilities | Own the CRM and the stage definitions, including what evidence moves a deal forward; produce the forecast and state its confidence honestly; run deal-desk mechanics: approvals, non-standard terms routing, and the audit trail; territory and account coverage planning once more than one seller exists; instrument the funnel end to end and reconcile it with finance's record; maintain data hygiene rules that fail loudly rather than silently degrading |
| Authority | Stage definitions and data-quality rules; forecast methodology; CRM configuration and access model |
| Cannot approve alone | Forecast numbers presented externally; pricing or discount approvals; quota and compensation design (owner); exporting customer data to a new external tool |
| Inputs | Deal records; product usage and decision telemetry once accounts exist; finance's revenue record; support and success signals |
| Outputs | Forecast with stated confidence; funnel metrics; deal-desk audit trail; territory and coverage plan |
| KPIs | Forecast accuracy within a stated band; CRM data-completeness rate on required fields; deal-desk turnaround time; count of reconciliation breaks with finance (target 0) |
| Activation trigger | The earlier of ten active paying accounts or two account executives in seat. Before that, the repo deal record and a spreadsheet are sufficient and a CRM is overhead. |
| Current coverage | Not covered. No CRM, no pipeline, no forecast exists today; the deal record is a repo document the founder maintains. |
| Human / fractional / AI-supported | Human (future), AI-supported; fractional analyst possible before a full hire |
| Hiring priority | - |
| Required competencies | RevOps tooling and data modeling; funnel instrumentation; enough finance literacy to reconcile with the books; willingness to publish an unflattering forecast |
| Customer/security implications | Owns a system holding prospect and customer contact data. Access model, retention, and export controls fall under the privacy function, not sales convenience. |

### Public-sector and regulated-vertical sales lead

| Field | Value |
|---|---|
| Division | Sales & revenue |
| Status | FUTURE |
| Reports to | CRO |
| Mission | Sell into buyers whose procurement and compliance rules are part of the product requirement, without ever implying a certification the company does not hold. |
| Responsibilities | Own municipal, healthcare-system, and other regulated buyer motions and their procurement paths; map each buyer's mandatory requirements to the evidence estate and identify the gaps in writing; manage the compliance questionnaire cycle with the privacy and assurance functions; handle procurement vehicles, cooperative purchasing, and RFP responses; keep accessibility and records-retention obligations in scope from the first conversation |
| Authority | Bid/no-bid recommendation; RFP response content within existing evidence; sequencing of procurement steps |
| Cannot approve alone | Any statement of FedRAMP, StateRAMP, HIPAA, SOC 2, or similar posture — the company holds no certification or attestation and a human compliance review is required for regulated verticals; contractual security commitments; pricing on a public bid; data-residency promises |
| Inputs | RFP and questionnaire text; the evidence estate and its gaps; assurance and privacy function guidance; fractional counsel |
| Outputs | Bid/no-bid decisions with reasons; RFP responses with sourced answers; a gap register naming every requirement the company cannot currently meet |
| KPIs | Percentage of RFP answers with a linked artifact or an explicit "not held" (target 100%); bid win rate; count of overstated compliance answers found in review (target 0) |
| Activation trigger | A public-sector or regulated buyer requires a procurement vehicle, a written compliance posture statement, or a formal accessibility response (Section 508/VPAT) that the founder cannot answer from the existing evidence estate. Deferred until then per the owner's sequencing. |
| Current coverage | Not covered. No public-sector motion exists. Compliance-gap tracking is AI-covered via agent roster: compliance-analyst lane, which records what is and is not provable. |
| Human / fractional / AI-supported | Human (future), AI-supported; fractional compliance and legal support |
| Hiring priority | - |
| Required competencies | Public-sector procurement mechanics; regulated-vertical security review; RFP discipline; the reflex to answer "not held" rather than "in progress" |
| Customer/security implications | The division's highest legal exposure. A compliance claim in a bid document is a representation to a government buyer; the fail-closed answer is to state the absence. |

## Partnerships & ecosystem

**Leadership:** VP Alliances / Business Development. **Measurable output:** expand distribution and evidence ecosystems.

**SignalGrid has no partners, alliances, resellers, distributors, OEM agreements, marketplace listings, or partner-program memberships as of August 21, 2026.** No relationship exists with any vendor named in this division; vendor names appear only to describe the technical ecosystem SignalGrid reads signals from. Fleet is a self-hosted MDM the company runs for its own testing, not a partnership. Every role below is FUTURE and carries the condition that turns it on.

### VP Alliances and Business Development

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | COVERED |
| Reports to | Founder/CEO |
| Mission | Decide which ecosystems are worth entering, in what order, and refuse the ones that cost more evidence than they return. |
| Responsibilities | Maintain the ecosystem map: which platforms SignalGrid reads signals from, which could distribute it, which could displace it; set partnership sequencing and the entry criteria for each; run first-contact conversations with prospective partners; hold the rule that no relationship is described publicly before it is signed and the owner approves the wording; keep a written record of every approach, its status, and its outcome |
| Authority | Which ecosystems to research and approach; meeting sequencing; declining an approach |
| Cannot approve alone | Any agreement, memorandum, or letter of intent; any public or private description of a relationship as existing; use of a third party's marks or logos; joint roadmap or integration commitments; revenue-sharing terms (owner-only) |
| Inputs | Ecosystem research; buyer-stated integration requirements; the launch-profile connector classifications; competitive analysis |
| Outputs | Ecosystem map with sequencing rationale; approach log; the list of integrations buyers ask for that no partnership currently supports |
| KPIs | Percentage of external partnership language reviewed against the claims gate before publication (target 100%); count of relationships described as existing that are not signed (target 0); documented approaches per period |
| Activation trigger | Active now in a research-and-first-contact form only. A hired VP activates when two or more signed agreements exist and require ongoing management. **No relationship exists today.** |
| Current coverage | Founder holds all external conversations and all approval. Research is AI-covered via agent roster: partner-alliances-analyst lane, plus competitive-analyst; the lanes do desk analysis and hold no external contact. |
| Human / fractional / AI-supported | Human (founder), AI-supported |
| Hiring priority | - |
| Required competencies | Platform ecosystem strategy in endpoint/identity/security; technical depth to judge integration cost; discipline against announcing intent as achievement |
| Customer/security implications | Partnership language is the single most common source of implied endorsement. A named vendor in a deck reads as an alliance whether or not the sentence says so. |

### Microsoft alliance lead

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Turn SignalGrid's technical use of Microsoft identity and device signals into a supported, listed, jointly recognized integration — if and when that is warranted. |
| Responsibilities | Own the technical relationship with the Microsoft identity and device-management ecosystem (Entra, Intune, Graph); drive partner-program application, publisher verification, and marketplace listing mechanics; maintain the integration against Graph API and permission-model changes; run joint technical validation in tenants SignalGrid does not own; keep the permission scopes minimal and documented as a customer-facing artifact |
| Authority | Technical integration design within the ratified `graph` connector family; timing of program applications; scope-minimization decisions |
| Cannot approve alone | Any statement that SignalGrid is a Microsoft partner, certified, co-sell ready, or listed before it is; requesting broader Graph permissions than the decision core needs; marketplace commercial terms (owner-only); use of Microsoft marks |
| Inputs | Graph connector implementation and its proofs; tenant validation results; program requirements; buyer requests for marketplace transaction |
| Outputs | Program application record; permission-scope document; validation evidence from non-owned tenants; integration maintenance log |
| KPIs | Permission scopes requested versus scopes actually consumed by the decision core (target parity); integration break-to-fix time after an upstream API change; validated non-owned tenants |
| Activation trigger | **No relationship exists today; this role activates when** the `graph` connector family has passed validation in at least one tenant SignalGrid does not own **and** either a prospective customer requires transacting through the Microsoft commercial marketplace or a partner-program application is filed. |
| Current coverage | Not covered. The `graph` connector family is a ratified launch capability built against public APIs; that is a technical integration, not a relationship. Owner sequencing puts Microsoft enterprise validation after the open-source lab (DR-005 item 1). |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Entra/Intune/Graph architecture and permission models; Microsoft partner-program mechanics; multi-tenant validation experience |
| Customer/security implications | Graph permissions are the most sensitive access SignalGrid requests. Over-scoped consent is a security finding in every enterprise review, and scope creep here is invisible to the customer until an assessor reads the consent screen. |

### Endpoint and UEM alliance lead

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Make SignalGrid's device-health and management signals work across the UEM/MDM systems customers already run, through supported integrations rather than screen-scraped assumptions. |
| Responsibilities | Own technical relationships with UEM/MDM vendors whose device state SignalGrid consumes; validate each back end against the ratified `device-management-health` family with real enrolled devices; document platform-honesty boundaries per vendor — what the MDM enforces versus what SignalGrid observes; negotiate API access, rate limits, and test tenancy; maintain a per-vendor capability matrix that says plainly which signals are unavailable |
| Authority | Which UEM back ends to validate and in what order; integration architecture within the ratified family; declaring a vendor's signal unavailable |
| Cannot approve alone | Any claim of vendor endorsement, certification, or joint support; any claim that SignalGrid enforces on-device state — enforcement is an MDM/OS capability requiring a supervised device; commercial terms; roadmap commitments to a vendor |
| Inputs | `device-management-health` connector implementation and proofs; enrolled-device test results; buyer-stated UEM inventory; vendor API documentation |
| Outputs | Per-vendor capability matrix with explicit gaps; validation evidence from enrolled devices; integration maintenance log |
| KPIs | UEM back ends validated against enrolled hardware (not simulators); signal-coverage gaps documented before a buyer finds them; break-to-fix time on upstream API changes |
| Activation trigger | **No relationship exists today; this role activates when** a named deployment requires a UEM back end beyond the self-hosted Fleet instance the company runs for its own testing, **or** a UEM vendor requests a technical integration review in writing. |
| Current coverage | Not covered. Fleet Community/self-hosted is used as SignalGrid's own test MDM with no agreement of any kind; per DR-005 item 5, Fleet Premium is outside baseline economics and its team-scoped capability may be marked `deferred/unverified-premium`. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | MDM/UEM architecture across Apple Business Manager, APNs, and at least two vendors; device-enrollment and supervision mechanics; API integration maintenance |
| Customer/security implications | Directly touches the platform-honesty rule. An integration described as enforcing policy when it only observes it would misrepresent the security posture of every device in the deployment. |

### Security and IT-operations ecosystem lead

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Make SignalGrid decisions and their evidence consumable by the security and IT-operations systems a customer already runs. |
| Responsibilities | Own integration paths into customer-operated SIEM/XDR, SOAR, ITSM and ITOM systems; define the decision-event and evidence-export contract so downstream systems can verify provenance rather than trust it; validate that exported evidence stays tamper-evident outside SignalGrid's boundary; work with the assurance function on what an exported record proves; maintain per-system integration documentation and its failure modes |
| Authority | Export contract design within an owner-approved scope; which target systems to support first; declaring an export unsupported |
| Cannot approve alone | Activating any deferred connector or export family — that requires a decision record superseding DR-005; claims of vendor certification or app-store listing; commitments that an export satisfies a customer's compliance control; commercial terms |
| Inputs | Decision-event schema and audit-ledger design; buyer-stated tooling inventory; assurance-function review; sync manifest for cross-surface contracts |
| Outputs | Export contract specification; per-system integration guides; provenance-verification instructions a customer can run themselves |
| KPIs | Exported records independently verifiable by the receiving system (target 100% of supported paths); integrations shipped with a documented failure mode; count of exports whose provenance could not be verified end to end (target 0) |
| Activation trigger | **No relationship exists today; this role activates when** a deployment requires SignalGrid decisions inside a customer-operated SIEM/XDR or ITSM system **and** an owner decision record moves the corresponding export family out of deferred status. |
| Current coverage | Not covered. Evidence export beyond the ratified launch surfaces is deferred by the launch profile; the audit-ledger hash-chain work is internal, proven by `proof:audit-ledger-pg`, and is not a partner integration. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | SIEM/XDR and ITSM data models; event schema design; tamper-evident logging and provenance verification; integration security review |
| Customer/security implications | Evidence that leaves the boundary must remain verifiable, or the customer inherits a record they cannot defend to an assessor. Stale or unverifiable exports are worse than no export. |

### OEM and embedded distribution lead

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Let device makers and host-application vendors embed the Assist gate inside their own products without breaking determinism or the embedded UX law. |
| Responsibilities | Own OEM and embedded technology relationships and their technical fit assessment; define the embedding contract — what the host app owns, what SignalGrid owns, and where domain safety stays with the host; hold the parity requirement across embedded targets so a decision is identical wherever it runs; specify branding, support, and escalation boundaries for an embedded deployment; assess whether an OEM request requires product changes and route those to Product rather than absorbing them |
| Authority | Technical fit assessment; embedding contract design; declining an OEM request that would compromise determinism |
| Cannot approve alone | Any OEM agreement, exclusivity, or white-label right; product changes to accommodate a host; support obligations to an OEM's end customers; revenue share (owner-only); any claim that an embedded deployment exists |
| Inputs | Host-app requirements; decision-core parity constraints; the embedded UX law; port-parity proofs |
| Outputs | Embedding contract specification; fit assessments with reasons; boundary document naming what stays in the host app |
| KPIs | Decision parity between embedded and reference targets (target 100% on the fixture suite); fit assessments completed before technical work starts; count of embedded requests that would have moved domain safety into SignalGrid, correctly refused |
| Activation trigger | **No relationship exists today; this role activates when** a device manufacturer or host-application vendor requests, in writing, to embed the Assist gate in a product they ship under their own brand. |
| Current coverage | Not covered. No OEM conversation has occurred. The embedded architecture exists as a design rule — SignalGrid is invisible to end users and domain safety belongs to host apps — not as a shipped OEM capability. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | OEM/embedded software licensing; SDK and parity engineering; ability to hold an architectural boundary against a paying counterparty |
| Customer/security implications | An OEM can push domain logic into the gate to save their own work. Accepting that would put clinical or operational safety decisions inside a component designed never to make them. |

### Channel lead — systems integrators, MSP/MSSP and distributors

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Let qualified services firms deploy and operate SignalGrid for their own clients without diluting deployment quality or evidence discipline. |
| Responsibilities | Own systems-integrator, MSP/MSSP, and distributor relationships and the tiering between them; define partner qualification: what a firm must demonstrate before it may deploy unsupervised; run deal registration and conflict rules so channel and direct motions do not collide; hold multi-tenant boundary requirements for MSP-operated deployments; manage distributor logistics and territory scope where a distributor is used at all |
| Authority | Partner qualification decisions; deal-registration conflict rulings; recommending partner suspension for evidence or deployment failures |
| Cannot approve alone | Channel agreements, margins, or discounts (owner-only); any claim that a partner network, reseller, or distributor exists; granting a partner tenant access; partner-branded claims about SignalGrid |
| Inputs | Partner applications and capability evidence; deployment quality data; multi-tenant isolation requirements from the assurance function; direct-sales pipeline for conflict checks |
| Outputs | Partner qualification records; deal-registration ledger; multi-tenant operating requirements for partner-run deployments |
| KPIs | Partner-run deployments meeting the same implementation checklist as direct ones (target 100%); channel conflict incidents resolved within a stated window; count of partner-published claims requiring correction (target 0) |
| Activation trigger | **No relationship exists today; this role activates when** a services firm asks to deploy SignalGrid for a client whose relationship it owns, and a second request of that shape arrives — one inbound request is handled by the founder, two is a motion. |
| Current coverage | Not covered. No partner program, agreement, tier, or deal-registration process exists; nothing in the company's materials should suggest a channel. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Channel program design; MSP/MSSP operating models and multi-tenant delivery; conflict management between direct and partner motions |
| Customer/security implications | An MSP operating across clients is a multi-tenant boundary question before it is a commercial one. Tenant isolation must be provable, not asserted, before any partner touches more than one customer's data. |

### Partner technical enablement and integration validation lead

| Field | Value |
|---|---|
| Division | Partnerships & ecosystem |
| Status | FUTURE |
| Reports to | VP Alliances |
| Mission | Make a partner's integration reproducible and its evidence verifiable by someone other than SignalGrid. |
| Responsibilities | Build and maintain partner-facing technical enablement: integration guides, reference fixtures, and a runnable validation suite; define what an integration must demonstrate before it may be described as working; keep partner integrations tested against upstream changes rather than assumed stable; run the joint technical review that precedes any public description of an integration; retire integrations that stop passing validation, loudly |
| Authority | Validation criteria and pass/fail rulings; enablement content within existing scope; declaring an integration lapsed |
| Cannot approve alone | Public description of an integration as certified, supported, or endorsed; changes to the decision core for a partner's convenience; commercial terms; waiving a failed validation |
| Inputs | Partner integration submissions; connector family proofs; upstream API change notices; the sync manifest for cross-surface contracts |
| Outputs | Integration validation suite and results; partner enablement guides; a public-facing list of validated integrations that is accurate on the day it is read |
| KPIs | Integrations re-validated on a fixed cadence (target 100% within the cadence window); time from upstream break to partner notification; count of listed integrations failing validation at audit (target 0) |
| Activation trigger | **No relationship exists today; this role activates when** the first partner integration exists **and** a second party needs to reproduce its evidence run without SignalGrid staff present. |
| Current coverage | Not covered. The internal proof suite is the model for what partner validation will look like, but no partner integration exists to validate. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Integration test design; technical writing for external engineers; the judgment to fail a partner's submission and hold the line |
| Customer/security implications | A published integration list is a claim surface with a shelf life. An integration that silently stopped working is stale evidence, and stale evidence is the failure mode this company exists to prevent. |

## Customer success

**Leadership:** VP Customer Success. **Measurable output:** create measurable customer outcomes.

SignalGrid has no customers, pilots, or deployments as of August 21, 2026. The entire division is FUTURE and the owner has designated it so explicitly: customer success activates from real deployments, not in anticipation of them. What is built now is the definition of an outcome, so the first deployment is measured from day one rather than described afterward.

### VP Customer Success

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | Founder/CEO |
| Mission | Own the definition of a customer outcome and make sure every account is measured against the one it signed up for. |
| Responsibilities | Define the outcome model: what a successful SignalGrid deployment looks like in measurable terms per vertical; own the customer lifecycle from handover through renewal and the coverage model across CSM, TAM, and support; hold the escalation path and decide when an account's problem becomes a company-level problem; feed field truth into Product with evidence rather than anecdote; own the rule that a customer's reported outcome is reported as the customer states it |
| Authority | Coverage model and account assignment; escalation declarations; outcome definitions and health methodology |
| Cannot approve alone | Commercial concessions, credits, or refunds (owner-only); roadmap commitments to an account; public use of a customer's name, logo, or results; scope expansion into domain safety that belongs in host apps |
| Inputs | Signed success criteria from each deal; deployment telemetry and decision outcomes; support and escalation history; renewal calendar |
| Outputs | Outcome model and health methodology; account coverage plan; a quarterly field-truth report to Product and the owner |
| KPIs | Percentage of accounts with written, measurable success criteria (target 100%); gross retention; time from an at-risk signal to a documented intervention; count of outcomes reported without customer confirmation (target 0) |
| Activation trigger | The earlier of five paying accounts, or two customer-facing hires needing a manager. |
| Current coverage | Not covered. No customers exist. Lifecycle and activation thinking is AI-covered via agent roster: lifecycle-activation lane, which today works on product-side activation, not accounts. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Enterprise CS leadership in infrastructure/security products; outcome measurement design; escalation management; comfort reporting a bad number early |
| Customer/security implications | Owns the relationship in which a customer would first report that the gate behaved wrongly. That path must reach engineering intact and fast, without being softened on the way. |

### Customer success manager

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Keep each account moving from installed to actually relied upon, measured against its own success criteria. |
| Responsibilities | Own a portfolio of accounts and their success plans; run the regular cadence and keep the plan current as the customer's environment changes; track adoption against the criteria signed at the deal and report drift honestly; coordinate implementation, support, and product responses on the account's behalf; surface expansion signals to the closing role and risk signals to the VP; document every customer-stated problem in the customer's own words |
| Authority | Account cadence and success-plan content; internal prioritization requests on the account's behalf; declaring an account at risk |
| Cannot approve alone | Credits, discounts, or contract changes; roadmap or date commitments; public reference use; changes to decision behavior for one account |
| Inputs | Signed success criteria; adoption and decision telemetry; support history; the account's operational calendar |
| Outputs | Success plans; account health records with evidence; risk and expansion signals; customer-worded problem statements |
| KPIs | Accounts meeting their signed success criteria; adoption against plan; renewal rate in portfolio; risk signals raised before the customer raises them |
| Activation trigger | The first paying deployment has been in daily operational use for 30 days. |
| Current coverage | Not covered. No accounts exist to manage. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Enterprise CS in IT/security tooling; frontline operational environments; enough technical depth to read a decision record; plain-language reporting |
| Customer/security implications | Sees usage patterns across an account. Access to customer decision data must follow least privilege and be auditable, not granted wholesale for convenience. |

### Technical account manager

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Be the named technical counterpart for accounts whose environment is complex enough that generic support cannot serve them. |
| Responsibilities | Hold deep technical context for assigned accounts: device estate, signal sources, tenant topology, connector configuration; review configuration and policy changes before the customer applies them; run technical health reviews and pre-empt breakage from upstream platform changes; drive root-cause work with engineering on account-specific defects; maintain an account architecture record that a successor could pick up cold |
| Authority | Technical recommendations and configuration review; prioritizing account-specific investigation; escalating a defect as customer-impacting |
| Cannot approve alone | Product changes; changes to the decision core or its ports; commitments on fix dates; direct access to customer production systems beyond the agreed access model |
| Inputs | Account architecture; connector and decision telemetry; upstream platform change notices; defect and escalation history |
| Outputs | Account architecture records; technical health reviews; root-cause findings; upgrade and change plans |
| KPIs | Customer-impacting incidents pre-empted versus reacted to; time to root cause on account defects; account architecture records current within a stated window |
| Activation trigger | A single account's technical questions exceed four hours a week for a month, **or** a signed contract requires a named technical contact. |
| Current coverage | Not covered. No accounts exist. Domain depth that a TAM would need is AI-covered via agent roster: endpoint-uem-domain, iam-domain, and network-domain lanes. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Endpoint, identity, and network operations depth; incident root-cause discipline; customer-facing technical communication |
| Customer/security implications | Often the role with the deepest access into a customer environment. Access scope, session recording, and revocation on role change are security controls, not HR paperwork. |

### Customer health and adoption analytics lead

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Make account health a measured number with a known error bar, not a CSM's impression. |
| Responsibilities | Define and maintain the health model and its inputs; instrument adoption so the measure reflects reliance on the gate, not logins; validate the model against actual renewal and churn outcomes and retire indicators that do not predict; publish health with its confidence and its blind spots; keep customer analytics inside the agreed data boundary and minimize what is collected |
| Authority | Health model definition and indicator retirement; analytics instrumentation design within the data boundary |
| Cannot approve alone | Collecting a new category of customer data; sharing account-level analytics outside the account team; presenting health scores externally; retention decisions |
| Inputs | Decision and adoption telemetry; support and escalation history; renewal outcomes; privacy-function constraints |
| Outputs | Health model with validation results; adoption dashboards; a documented list of what the model cannot see |
| KPIs | Predictive accuracy of the health model against realized churn; percentage of accounts with complete health inputs; count of indicators retired for not predicting; data categories collected versus data categories used |
| Activation trigger | Three or more paying accounts exist **and** renewal risk cannot be read from the data those accounts already send. |
| Current coverage | Not covered. No customer telemetry exists. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Product analytics and model validation; privacy-aware instrumentation; the willingness to publish a model's failure rate |
| Customer/security implications | Health analytics is a data-collection function pointed at customers. Minimization and boundary discipline here are exactly the properties the product asks customers to trust. |

### Renewals and expansion lead

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Convert delivered outcomes into renewed and expanded commitments, on evidence the customer already agrees with. |
| Responsibilities | Own the renewal calendar and start each cycle from the account's signed success criteria; assemble the renewal evidence pack from real usage and outcomes; identify expansion where a second site, device class, or signal source has genuine demand; run the risk-to-save motion with the VP when an account is unlikely to renew; record churn reasons in the customer's words and route them to Product |
| Authority | Renewal cycle timing and evidence pack content; expansion qualification; escalating a save motion |
| Cannot approve alone | Pricing, discount, or term changes (owner-only); contractual commitments; presenting projected outcomes as delivered ones |
| Inputs | Renewal calendar; success criteria and their measured results; health and support history; commercial terms |
| Outputs | Renewal evidence packs; renewal and churn outcomes with reasons; qualified expansion opportunities |
| KPIs | Gross and net retention; renewals started at least 90 days ahead (target 100%); percentage of renewal claims backed by measured results; churn reasons recorded verbatim |
| Activation trigger | 90 days before the first contract's renewal date. |
| Current coverage | Not covered. No contracts exist. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Renewals in enterprise infrastructure; evidence-based commercial conversations; churn analysis |
| Customer/security implications | A renewal pack is a claims document handed to a customer who can check it. Every number in it must be reproducible from the customer's own data. |

### Executive business review and customer advocacy lead

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Run the executive conversation about outcomes, and turn willing customers into references only with their explicit written permission. |
| Responsibilities | Design and run executive business reviews built on measured results and open issues, not slideware; maintain the reference program: who has agreed, in writing, to what use of their name and results; produce case studies that a customer has reviewed and approved before publication; manage the advocacy pipeline so no logo, quote, or metric is used beyond its permission; keep an auditable permission record per customer |
| Authority | EBR structure and content within measured results; reference program mechanics; refusing a reference request that exceeds permission |
| Cannot approve alone | Any external use of a customer name, logo, quote, or metric without written customer approval; publication of any case study (the owner sends); implying a customer relationship that has not been confirmed by the customer |
| Inputs | Measured account outcomes; customer permissions; marketing's content needs; the claims gate |
| Outputs | EBR records with agreed actions; a permission register; approved case studies and reference materials |
| KPIs | Percentage of external customer mentions covered by a current written permission (target 100%); EBRs held on schedule; references sourced without escalation; count of permission-scope breaches (target 0) |
| Activation trigger | A customer agrees, in writing, to be named or quoted publicly — that written agreement is the trigger, not the intention to seek one. |
| Current coverage | Not covered. No customers, no references, no case studies, and no permissions exist. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Executive-level facilitation; reference program management; rigorous permission tracking |
| Customer/security implications | The highest-risk public-claim surface in the division. A customer named without current permission is both a truth failure and a confidentiality failure. |

### Escalation manager

| Field | Value |
|---|---|
| Division | Customer success |
| Status | FUTURE |
| Reports to | VP Customer Success |
| Mission | Run customer-visible escalations so the customer always knows what is true, what is unknown, and what happens next. |
| Responsibilities | Own the escalation process from customer report to closure, including who is called and when; run customer communications during incidents against the incident doctrine's operational roles; ensure a disputed decision is reproduced from fixtures before any explanation is offered; drive post-incident review with engineering and deliver the customer-facing account of it; track escalation causes and force the recurring ones into the backlog |
| Authority | Declaring a customer escalation; convening engineering during an escalation; the content and timing of customer status updates within the truthfulness rules |
| Cannot approve alone | Credits, refunds, or contractual remedies (owner-only); root-cause statements not backed by reproduction; public incident disclosure (owner); changes to decision behavior as an escalation remedy |
| Inputs | Customer reports; decision records and fixtures for reproduction; incident timeline; engineering findings |
| Outputs | Escalation records; customer-facing status updates and post-incident accounts; recurring-cause register routed to Product |
| KPIs | Time from customer report to first substantive update; percentage of disputed decisions reproduced from fixtures before explanation (target 100%); recurring escalation causes closed per period; count of customer updates later corrected for inaccuracy (target 0) |
| Activation trigger | The first customer-visible incident in which the Assist gate returned a decision the customer disputes, **or** the first Sev-1 declared under the incident doctrine. |
| Current coverage | Not covered. No customers and no customer-visible incidents exist. Incident operating roles are defined in ORG_STRUCTURE.md so the first incident does not have to invent them. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Incident communications; technical reproduction literacy; the discipline to say "we do not know yet" on a call with an angry customer |
| Customer/security implications | A disputed decision on a fail-closed gate is a trust event. Reproducing it from fixtures before explaining it is what separates an answer from a guess. |

## Implementation, support & services

**Leadership:** VP Services (initially the customer success leader). **Measurable output:** working deployments and answered customers.

This division holds the earliest non-founder hire in the customer-facing half of the company: the implementation/success engineer, hiring priority 9, triggered by the first pilot. Everything else here waits for volume that does not exist yet.

### VP Services

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | Founder/CEO |
| Mission | Make deployment and support repeatable, so the quality of a customer's experience does not depend on which person they got. |
| Responsibilities | Own the implementation methodology and the support model, including internal response targets; decide what is standard delivery versus scoped, chargeable work; hold capacity planning across implementation, support, and services; own the services quality bar and the checklist every deployment passes; keep services work from becoming unowned product debt by routing repeated custom work to Product |
| Authority | Delivery methodology and quality bar; internal response targets; work classification as standard or scoped |
| Cannot approve alone | Services pricing or rates (owner-only); any external SLA or contractual response-time commitment; scope beyond ratified product capabilities; staffing budget |
| Inputs | Signed success criteria; deployment and support volume; product change notices; customer environment data |
| Outputs | Implementation methodology and checklist; support model and internal targets; capacity plan; the register of repeated custom work needing productization |
| KPIs | Deployments passing the checklist without exception (target 100%); time to first productive use per deployment; support backlog age; repeated custom work converted to product |
| Activation trigger | Implementation and support together exceed two full-time people. Until then the CS leader holds it, and before that the founder does. |
| Current coverage | Not covered. No deployments and no support volume exist. |
| Human / fractional / AI-supported | Human (future) |
| Hiring priority | - |
| Required competencies | Services leadership in enterprise infrastructure; delivery methodology design; capacity planning; resisting bespoke work that cannot be repeated |
| Customer/security implications | Sets whether deployments are consistent. Inconsistent deployment is a security problem: a misconfigured connector or tenant boundary is invisible until it matters. |

### Implementation / customer success engineer

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | VP Services (founder/CEO until then) |
| Mission | Get a customer from signed to a working, evidenced deployment in their own environment, and stay with it until it is genuinely relied upon. |
| Responsibilities | Run deployments end to end: tenant setup, connector configuration against the ratified launch families, device and signal validation, and gate behavior review with the customer; convert the customer's real environment into fixtures and prove the resulting decisions before go-live; train the customer's operators on the Assist gate's four outcomes and where domain safety stays in their host apps; own the first 90 days of an account technically, then hand context to CSM/TAM when those exist; feed every environment surprise back as a fixture or a backlog item; variant — the success-engineering half: adoption support and technical reviews after go-live |
| Authority | Deployment sequencing and configuration within ratified scope; go/no-go on go-live against the implementation checklist; fixture creation from customer environments |
| Cannot approve alone | Product changes or new connector families (DR-005 scope is fixed); claims about what the deployment enforces on devices — enforcement requires MDM/OS capability on a supervised device; contractual commitments or dates; access to customer data beyond the agreed model |
| Inputs | Signed success criteria; customer environment inventory; launch profile and connector proofs; the implementation checklist |
| Outputs | Working deployments with an evidence record; customer-derived fixtures committed to the repo; operator training delivered; environment-surprise reports |
| KPIs | Time from signature to first productive use; deployments with a complete pre-go-live evidence record (target 100%); post-go-live defects traceable to a skipped checklist item (target 0); fixtures contributed per deployment |
| Activation trigger | **The first pilot deployment.** This is hiring priority 9 in the owner's sequence — the first customer-facing hire, made when a real deployment exists to run, not before. |
| Current coverage | Not covered as a hire. The founder would run the first pilot personally, with technical support AI-covered via agent roster: solutions-architect, endpoint-uem-domain, and mac-lane-steward lanes for environment and verification work. |
| Human / fractional / AI-supported | Human (future, priority 9), AI-supported |
| Hiring priority | 9 |
| Required competencies | Hands-on endpoint/UEM, identity, and network deployment; shared-device operational environments; ability to write fixtures and read proof output; operator-level training delivery; plain speech with non-technical frontline staff |
| Customer/security implications | The role that determines whether a deployment is correct on day one. Every misconfiguration it prevents is a fail-open risk avoided; every fixture it contributes makes the next deployment provable rather than hopeful. |

### Support engineer

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | VP Services |
| Mission | Answer customers correctly and quickly, and turn every answer into something the next customer can find without asking. |
| Responsibilities | Own inbound customer issues from intake to resolution across tiers; reproduce reported behavior against fixtures before diagnosing it; escalate to engineering with a reproduction, not a description; maintain the knowledge base so recurring questions stop recurring; hold on-call coverage within the agreed hours; flag any issue with fail-open potential immediately, regardless of reported severity |
| Authority | Issue triage and severity assignment; escalation to engineering; knowledge-base content |
| Cannot approve alone | Configuration changes in a customer's environment without customer authorization; workarounds that weaken the gate; commitments on fix timing; statements about root cause before reproduction |
| Inputs | Customer issue reports; decision records and logs; fixture suite; product change notices |
| Outputs | Resolved issues with recorded causes; reproductions attached to escalations; knowledge-base articles; a recurring-issue report |
| KPIs | Time to first response and to resolution against internal targets; percentage of escalations carrying a reproduction (target 100%); deflection rate through knowledge base; reopened-issue rate |
| Activation trigger | Inbound customer issues exceed five per week, **or** coverage is needed outside the founder's working hours. |
| Current coverage | Not covered. No customers and no support queue exist; there is no ticketing system and no published response commitment. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Enterprise support for infrastructure software; reproduction discipline; technical writing; calm handling of a customer whose device access is being denied |
| Customer/security implications | Support is a social-engineering target and a data-access surface. Identity verification before acting on a request, and least-privilege access to customer data, are non-negotiable controls here. |

### Solutions architect

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | COVERED |
| Reports to | VP Services (founder/CEO while COVERED) |
| Mission | Design deployments that fit a customer's real device, identity, and network estate before anyone starts configuring. |
| Responsibilities | Produce the deployment architecture per environment: tenant model, connector selection, signal sources, and failure behavior; identify where a customer's estate cannot supply a signal and design the fail-closed consequence explicitly; hold the boundary between SignalGrid's gate and the host application's domain safety in every design; review architectures for tenant isolation and provenance integrity with the assurance function; maintain reference architectures per vertical — healthcare, municipal, warehouse |
| Authority | Deployment architecture within ratified scope; declaring an environment unsupported; reference architecture content |
| Cannot approve alone | New connector families or product scope (DR-005); on-device enforcement claims; security or compliance assurances; customer data-handling terms |
| Inputs | Customer environment inventory; connector family classifications and proofs; assurance-function requirements; field results from deployments |
| Outputs | Deployment architectures with explicit failure behavior; reference architectures per vertical; unsupported-environment findings |
| KPIs | Architectures reviewed for tenant isolation before implementation (target 100%); deployments whose failure behavior was documented pre-go-live (target 100%); reference architectures kept current with the launch profile |
| Activation trigger | Active now, in agent-lane form. A dedicated hire activates at the third concurrent deployment or the first multi-site architecture the founder cannot design alongside their other work. |
| Current coverage | AI-covered via agent roster: solutions-architect lane, with endpoint-uem-domain, iam-domain, network-domain, and physical-ot-domain lanes supplying signal-source detail; the founder holds endpoint/infrastructure domain expertise and reviews the output. |
| Human / fractional / AI-supported | AI-supported, founder-reviewed |
| Hiring priority | - |
| Required competencies | Enterprise architecture across identity, endpoint management, and network; fail-closed system design; the judgment to declare an environment unsupported rather than force a fit |
| Customer/security implications | Architecture decisions determine whether an unknown signal raises assurance or quietly lowers it in practice. A design that assumes a signal will always be available is the most likely path to a fail-open deployment. |

### Professional services and integration services lead

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | VP Services |
| Mission | Deliver scoped, funded work that a customer's environment genuinely requires, without turning bespoke work into unowned product debt. |
| Responsibilities | Scope and deliver funded integration and migration work outside standard implementation; define acceptance criteria per engagement before work starts; keep a strict boundary between customer-funded work and baseline product; route any custom work requested twice to Product as a productization candidate; maintain delivery documentation a support engineer can operate from afterwards |
| Authority | Engagement scoping and acceptance criteria; delivery approach; refusing work that cannot be maintained |
| Cannot approve alone | Services rates or fixed-fee amounts (owner-only); commitments that customer-funded work becomes baseline product; product-scope changes; work requiring a deferred connector family without an owner decision record |
| Inputs | Customer requirements beyond standard scope; architecture assessments; engineering capacity; the launch profile |
| Outputs | Scoped statements of work with acceptance criteria; delivered integrations with maintenance documentation; productization candidates |
| KPIs | Engagements accepted against written criteria (target 100%); delivered work with maintenance documentation (target 100%); custom work productized after a second request; engagements delivered within scope |
| Activation trigger | A customer requires an integration outside the three ratified launch connector families **and** funds it as scoped work — the funding, not the request, is the trigger. |
| Current coverage | Not covered. No services engagements exist and no services offering is published. |
| Human / fractional / AI-supported | Human (future); fractional contractors possible per engagement |
| Hiring priority | - |
| Required competencies | Services scoping and delivery; integration engineering; the discipline to write acceptance criteria the customer signs before work begins |
| Customer/security implications | Custom integrations are the most likely place for a non-deterministic path to enter a deterministic system. Every engagement needs the same fixture and proof treatment as baseline work. |

### Support operations and knowledge lead

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | VP Services |
| Mission | Run the machinery of support — intake, routing, measurement, knowledge — so answer quality does not depend on who is on shift. |
| Responsibilities | Own the support tooling, intake channels, and routing rules; define severity taxonomy and internal response targets, and measure against them honestly; maintain the knowledge base's structure, currency, and retirement rules; produce support analytics that name recurring product causes rather than agent performance; administer customer-data access controls in support tooling |
| Authority | Support tooling configuration and routing rules; severity taxonomy; knowledge-base structure and retirement |
| Cannot approve alone | Any external or contractual response-time commitment — internal targets are not an SLA and must not be published as one; new customer-data collection in support tooling; staffing decisions |
| Inputs | Support volume and outcomes; product change notices; privacy-function constraints; escalation records |
| Outputs | Support tooling configuration and access model; severity taxonomy; support analytics with product-cause attribution; a current knowledge base |
| KPIs | Attainment against internal response targets, published internally with misses shown; knowledge-base article currency; percentage of tickets routed correctly on first pass; access reviews completed on schedule |
| Activation trigger | The third support engineer, **or** the first written response-time commitment in a signed contract — whichever comes first. |
| Current coverage | Not covered. There is no ticketing system, no severity taxonomy, and no response-time commitment of any kind, internal or external. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Support operations tooling and analytics; taxonomy design; access administration; reporting misses without softening them |
| Customer/security implications | Support tooling holds customer contact data and diagnostic content. Access control and retention here are customer-security matters, and an internal target published as an SLA would be a false commercial claim. |

### Training, education and certification lead

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | FUTURE |
| Reports to | VP Services |
| Mission | Let a customer's or partner's own staff operate SignalGrid correctly without a SignalGrid engineer present. |
| Responsibilities | Build operator, administrator, and implementer training aligned to what the product actually does; define competency assessment: what a person must demonstrate, not attend; maintain a certification scheme where partner delivery requires one, with expiry tied to product change; keep training material versioned against product releases and retire outdated modules; measure whether trained operators produce fewer misconfigurations |
| Authority | Curriculum content and assessment design; certification criteria and revocation; retiring outdated material |
| Cannot approve alone | Describing certification as an industry or third-party accreditation — it is a vendor scheme; training claims about capabilities outside ratified scope; partner delivery rights (channel lead and owner); certification fees (owner-only) |
| Inputs | Product releases and change notices; implementation and support failure patterns; partner enablement needs; documentation |
| Outputs | Training curriculum and assessments; certification records with expiry; a training-to-outcome analysis |
| KPIs | Assessment pass rates and their correlation with deployment defects; material currency against the latest release; certified individuals with unexpired status; misconfiguration rate for trained versus untrained operators |
| Activation trigger | A partner or customer asks to operate or deploy SignalGrid without SignalGrid staff present. |
| Current coverage | Not covered. No training program, curriculum, or certification exists, and no certification is offered or implied anywhere. |
| Human / fractional / AI-supported | Human (future), AI-supported |
| Hiring priority | - |
| Required competencies | Technical curriculum design; competency assessment; version control of learning material against a moving product |
| Customer/security implications | A certification scheme is a claim about a person's competence made by this company. It must be assessed and revocable, or it becomes a badge that implies assurance nobody verified. |

### Deployment documentation lead

| Field | Value |
|---|---|
| Division | Implementation, support & services |
| Status | COVERED |
| Reports to | VP Services (founder/CEO while COVERED) |
| Mission | Keep the operator- and administrator-facing documentation accurate enough that reading it is faster than asking. |
| Responsibilities | Maintain deployment, configuration, and operator documentation against the ratified launch surfaces; keep every documented figure and capability traceable to a proof or a launch-profile classification; document failure behavior and the four Assist outcomes in operator language; retire or correct documentation the moment the underlying behavior changes; turn support's recurring questions into documentation rather than repeated answers |
| Authority | Documentation structure and content within verified behavior; retiring inaccurate pages; requesting clarification before documenting a behavior |
| Cannot approve alone | Documenting a capability outside the ratified launch profile; publishing figures not produced by a named run; compliance or certification language; external publication (the owner sends) |
| Inputs | Product changes and proof output; the launch profile; support's recurring questions; implementation field notes |
| Outputs | Deployment and operator documentation; a documentation-to-proof traceability record; correction log |
| KPIs | Documented figures traceable to a named proof run (target 100%, enforced by the docs-to-proof figure guard); time from behavior change to documentation correction; support questions closed by an existing page |
| Activation trigger | Active now. A dedicated hire activates when documentation maintenance exceeds one day a week or a second product surface ships to customers. |
| Current coverage | AI-covered via agent roster: docs-writer lane, with the docs↔proof figure guard in preflight enforcing that published figures match real runs. The founder reviews external-facing wording. |
| Human / fractional / AI-supported | AI-supported, founder-reviewed |
| Hiring priority | - |
| Required competencies | Technical writing for administrators and operators; ability to read proof output and verify a figure; Google developer style; the habit of deleting a page rather than leaving it stale |
| Customer/security implications | Documentation is a claim surface subject to the same gate as marketing. A stale page describing behavior that changed can cause a customer to misconfigure a trust decision. |

## Marketing

**Output: create qualified market attention.** Today the founder sets positioning and the agent lanes produce the artifacts. No marketing headcount exists. The division is designed so that when the first market-facing hire happens, the boundary between "what we can prove" and "what we say" is already a role with an owner, not a judgment call made under deadline.

### Head of Marketing (CMO / VP Marketing)

| Field | Value |
|---|---|
| Division | Marketing |
| Status | FUTURE |
| Reports to | Founder/CEO |
| Mission | Own the market narrative and the marketing budget so that attention arrives qualified and every public claim is one SignalGrid can prove. |
| Responsibilities | Set positioning, category language, and the message hierarchy; own the marketing plan and its spend allocation; approve the public claim set jointly with the claims steward; manage the marketing roles below and their sequencing; run the quarterly narrative review against shipped evidence; represent marketing in launch decisions |
| Authority | Message hierarchy and campaign priority; channel mix; allocation within an approved marketing budget; which marketing roles activate first |
| Cannot approve alone | Product claims that widen launch scope (owner decision DR-005); any statement of partnership, customer, certification, or SLA; total marketing budget; pricing; press statements during an incident |
| Inputs | Product roadmap and launch profile; proof-suite results; ICP research; competitive intel; sales conversation notes when a sales role exists |
| Outputs | Positioning document; message hierarchy; marketing plan; approved claim set; campaign briefs |
| KPIs | Qualified conversations per month sourced by marketing; percentage of published claims linked to a named proof artifact (target 100%); claims-gate violations shipped to the public repo (target 0); cycle time from proof landing to published explanation |
| Activation trigger | Two or more marketing roles below are filled by humans and require coordinated sequencing, or marketing spend requires ongoing allocation decisions the founder no longer wants to make weekly. Until then the founder holds this role directly. |
| Current coverage | Founder/CEO, working from the positioning artifacts produced by the AI-covered lanes: `positioning-messaging` and `icp-customer-research` in the agent roster. |
| Human / fractional / AI-supported | Human (AI-supported) |
| Hiring priority | - |
| Required competencies | B2B technical-infrastructure positioning; evidence-led marketing in a regulated buying environment; message discipline under a claims gate; budget ownership; managing product marketing and demand generation as distinct disciplines |
| Customer/security implications | This role is the largest single source of overclaim risk in the company. Every message it approves is read by security reviewers at prospective buyers; a claim that outruns the proof estate is a trust failure in a product whose output is a trust decision. |

### Product Marketing Manager

| Field | Value |
|---|---|
| Division | Marketing |
| Status | FUTURE |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Translate what SignalGrid actually does into the language of the buyer who has the problem, without widening what SignalGrid claims. |
| Responsibilities | Own positioning and messaging per segment (healthcare, municipal, warehouse) and per persona (security, endpoint/IT, clinical or operations leadership); write and maintain the launch and release narrative; build the objection-handling and security-questionnaire response library; produce the evidence-backed collateral set (one-pagers, decision-flow explainers, deployment models); run win/loss and message-testing interviews; maintain the claim-to-proof map |
| Authority | Segment message variants within the approved hierarchy; collateral structure and priority; which objections get a written answer first |
| Cannot approve alone | New product claims; naming a customer, partner, or reference; competitive assertions about a named vendor; pricing and packaging language; anything describing enforcement behavior that requires a supervised device |
| Inputs | Proof artifacts and simulator results; product launch profile; competitive intel; buyer conversations; deployment documentation |
| Outputs | Segment messaging docs; launch narrative; objection library; security-questionnaire answer bank; claim-to-proof map |
| KPIs | Percentage of collateral claims mapped to a named proof artifact (target 100%); objection-library coverage of objections raised in real conversations; time to answer an inbound security questionnaire; message-test agreement rate with target-persona interviewees |
| Activation trigger | A named organization has run SignalGrid against its own devices and has agreed in writing that the result may be described publicly. Proof of a real buyer, not interest in one, turns this role on. This is hiring priority 10 in the owner's sequence — deliberately late, because product marketing without a real customer produces fiction. |
| Current coverage | AI-covered via agent roster: the `positioning-messaging` lane drafts segment messaging and the `icp-customer-research` lane holds buyer research; the founder approves every claim. No human product marketer is engaged. |
| Human / fractional / AI-supported | Human (AI-supported) |
| Hiring priority | 10 |
| Required competencies | Technical B2B product marketing for security or endpoint-management buyers; interview-driven research; writing that survives a security review; comfort saying "we cannot claim that yet"; familiarity with MDM/UEM and identity vocabulary |
| Customer/security implications | Buyers in healthcare and public-sector procurement treat marketing language as a representation. Precise scope wording here prevents a deployment expectation SignalGrid cannot meet — particularly around what an app can enforce without supervised-device management. |

### Technical Marketing Engineer

| Field | Value |
|---|---|
| Division | Marketing |
| Status | COVERED |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Turn the proof estate into material a technical evaluator can read, reproduce, and check. |
| Responsibilities | Build and maintain reproducible demos and evaluation environments; write technical explainers, architecture notes, and decision-flow walkthroughs; publish reproduction instructions alongside claimed results; validate every technical assertion against a runnable gate before publication; support evaluator questions with test artifacts rather than assurances; keep published figures synchronized with the docs-to-proof figure guard |
| Authority | How a demo is constructed and what it shows; the technical depth of an explainer; refusal to publish a figure that no gate reproduces |
| Cannot approve alone | Publishing a benchmark as a customer-facing performance commitment; claims of on-device enforcement from a simulator; scope-widening statements; anything implying an attestation or certification |
| Inputs | Proof harness output; `validate-sim-macos.sh` and breadth-verification results; benchmark and load-test reports; product documentation |
| Outputs | Reproducible demo scripts; technical explainers; published figure set with provenance; evaluator reproduction guides |
| KPIs | Percentage of published technical figures reproducible by a documented command (target 100%); demo setup time for a new evaluator; count of corrections issued after publication (target 0) |
| Activation trigger | Active now as a responsibility. It becomes a human hire when an external evaluator must reproduce results on their own hardware more than twice a month, or when demo maintenance exceeds what the founder can carry alongside engineering. |
| Current coverage | AI-covered via agent roster: `proof-led-content` and `docs-writer` lanes, with the docs-to-proof figure guard and the preflight gates enforcing that published numbers match a run. Founder reviews before publication. |
| Human / fractional / AI-supported | AI-supported today; human later |
| Hiring priority | - |
| Required competencies | Reading and running a TypeScript/Node proof harness; endpoint and identity signal literacy; technical writing; benchmark hygiene (knowing what a number does not mean); reproducibility discipline |
| Customer/security implications | This role is how technical trust is earned. A demo that quietly does something the product cannot do in a customer environment is the most damaging artifact marketing can produce for a fail-closed trust gate. |

### Content and Editorial Lead

| Field | Value |
|---|---|
| Division | Marketing |
| Status | COVERED |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Publish material that teaches the problem honestly and earns attention because it is useful, not because it is loud. |
| Responsibilities | Own the editorial calendar and content standards; write and edit long-form explanations of shared-device trust problems; enforce the house style (plain, factual, no aspiration-speak) across every published surface; route every factual assertion through the claims check before publication; maintain the content archive and its correction log; commission subject-matter interviews when the lanes cannot source the material |
| Authority | Editorial calendar; headline and structure; rejecting a draft that cannot be sourced |
| Cannot approve alone | First publication of a new product claim; anything naming a customer, partner, or analyst; competitive claims about a named vendor; incident-related posts |
| Inputs | Technical marketing explainers; product and domain documentation; competitive intel; founder domain expertise in endpoint and infrastructure |
| Outputs | Published articles and explainers; editorial standards doc; correction log; content archive |
| KPIs | Published pieces per month against plan; corrections per hundred published assertions; percentage of pieces citing a repository artifact or named source; reader-to-conversation conversion where measurable |
| Activation trigger | Active now as a responsibility. Human hire when published output must exceed four substantive pieces a month for two consecutive months, or when a piece requires interviews with practitioners that agent lanes cannot conduct. |
| Current coverage | AI-covered via agent roster: `proof-led-content` lane drafts, `positioning-messaging` lane checks message fit, founder edits and approves. |
| Human / fractional / AI-supported | AI-supported today; human or fractional editor later |
| Hiring priority | - |
| Required competencies | Technical B2B editorial; interviewing practitioners; Google developer style discipline; fact-checking against primary sources; managing freelance writers |
| Customer/security implications | Content is the first thing a security-minded buyer reads. Sloppy or inflated writing invites the assumption that the engineering is equally loose. |

### Demand Generation, Field and Events Manager

| Field | Value |
|---|---|
| Division | Marketing |
| Status | FUTURE |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Create a repeatable path from stranger to qualified technical conversation. |
| Responsibilities | Design and run demand programs (search, targeted outbound support, community and industry venues); own the qualification definition jointly with sales when that role exists; plan and staff field events, workshops, and conference presence; measure source-to-conversation conversion and retire programs that do not convert; manage event logistics, budget, and follow-up; maintain the do-not-overclaim rules for booth and stage material |
| Authority | Program mix and campaign scheduling within an approved budget; event selection within budget; pausing an underperforming program |
| Cannot approve alone | Total demand budget; sponsorships that imply an alliance or endorsement; any event material stating a partnership, customer, or certification; contact-data purchases involving personal data |
| Inputs | ICP definition; segment messaging; website analytics; event calendars; sales capacity |
| Outputs | Campaign plans; event calendar and post-event reports; qualified-conversation pipeline; program performance reviews |
| KPIs | Qualified conversations per month by source; cost per qualified conversation as a trend (figures owner-reported); percentage of programs meeting their conversion threshold; event follow-up completion rate |
| Activation trigger | Inbound interest exceeds five qualified technical conversations in a month, or the company commits to a booth or speaking presence at an industry event that requires staffing and follow-up beyond the founder. |
| Current coverage | Not covered. The founder handles the small number of inbound conversations directly; the `design-partner-outreach` and `launch-manager` agent lanes prepare outreach material, but no demand program is running. |
| Human / fractional / AI-supported | Human, possibly fractional at first |
| Hiring priority | - |
| Required competencies | B2B demand generation for technical buyers; event operations; conversion measurement; outbound compliance rules for personal data; working with sales on shared qualification criteria |
| Customer/security implications | Demand programs touch contact data and consent obligations. Sponsorship language is a common accidental source of implied endorsement, which the claims rules forbid. |

### Website and Search Lead

| Field | Value |
|---|---|
| Division | Marketing |
| Status | COVERED |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Keep the public website accurate, fast, accessible, and findable by the people with the problem. |
| Responsibilities | Own the website's information architecture and page inventory; keep every page's claims synchronized with the current launch scope; run technical SEO (structure, metadata, performance, indexability); maintain accessibility conformance on public pages; run the publication-boundary and claims checks before deploying site changes; own analytics instrumentation and its privacy posture |
| Authority | Site structure and navigation; technical SEO changes; blocking a deployment that fails a claims or publication-boundary check |
| Cannot approve alone | New claims or scope language on any page; adding third-party trackers or scripts that collect personal data; publishing logos or names of other organizations |
| Inputs | Segment messaging; product scope decisions; proof artifacts; search performance data; accessibility audits |
| Outputs | Public website; page-level claim inventory; search performance reports; accessibility audit results |
| KPIs | Percentage of live pages whose claims map to a current proof artifact (target 100%); Core Web Vitals pass rate; accessibility violations on public pages (target 0); non-brand qualified search entries per month |
| Activation trigger | Active now as a responsibility. Human hire when the site exceeds roughly fifty maintained pages, or when a marketing tool stack requires ongoing instrumentation work. |
| Current coverage | Founder plus AI-covered lanes: `brand-design` for surface design and `proof-led-content` for page copy; the repository's publication-boundary and cited-path gates check what ships. |
| Human / fractional / AI-supported | AI-supported today; human or fractional later |
| Hiring priority | - |
| Required competencies | Technical SEO; web performance; WCAG conformance; static site tooling; privacy-aware analytics configuration |
| Customer/security implications | The website is a public attack surface and a public claim surface at once. Third-party scripts introduce both privacy obligations and supply-chain risk on the page a buyer's security team will inspect first. |

### Lifecycle and Customer Marketing Manager

| Field | Value |
|---|---|
| Division | Marketing |
| Status | FUTURE |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Move an account from first deployment to confident, expanding use, and keep existing users informed truthfully. |
| Responsibilities | Own onboarding and activation communications for operator and administrator personas; run release and change communications that state behavior changes precisely; build the reference and advocacy program under explicit written consent; run adoption and expansion campaigns within existing accounts; measure activation milestones and where accounts stall; maintain the customer-communication archive for audit |
| Authority | Lifecycle message sequences and timing; activation milestone definitions; segmentation of existing accounts for campaigns |
| Cannot approve alone | Publishing any customer name, logo, quote, or case study; commitments about future functionality; anything describing security posture beyond documented behavior; contacting users outside agreed communication channels |
| Inputs | Product release notes; deployment and support data; activation telemetry where consented; customer success signals |
| Outputs | Onboarding sequences; release communications; consented reference program; activation and adoption reports |
| KPIs | Activation-milestone completion rate by cohort; percentage of releases with a communication shipped on time; opt-out rate on lifecycle communications; documented consent on file for every published reference (target 100%) |
| Activation trigger | Ten or more distinct operator or administrator accounts exist in a non-simulated deployment, or a release changes decision-affecting behavior for existing users and requires a coordinated notice. |
| Current coverage | Partly AI-covered via the `lifecycle-activation` agent lane, which holds the sequence design; no real user cohort exists yet, so nothing is being sent. Founder owns any direct communication. |
| Human / fractional / AI-supported | Human (AI-supported) |
| Hiring priority | - |
| Required competencies | Lifecycle marketing for technical administrators; consent and permission management; release communication under change-control expectations; cohort analysis |
| Customer/security implications | Release communications about a fail-closed gate are operationally significant: an administrator who misreads a behavior change can misconfigure access. Reference programs must carry documented consent, since naming an organization without it is both a legal and a trust failure. |

### Marketing Operations Analyst

| Field | Value |
|---|---|
| Division | Marketing |
| Status | FUTURE |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Keep marketing systems, data, and reporting accurate enough that decisions made from them are defensible. |
| Responsibilities | Own the marketing tool stack, integrations, and access control; define and maintain the funnel data model and attribution rules; run data hygiene, deduplication, and retention schedules; produce the recurring marketing performance report; enforce personal-data handling rules across marketing systems; manage vendor evaluations for marketing tooling |
| Authority | Tool configuration and integration design; attribution methodology; access levels within marketing systems |
| Cannot approve alone | Purchasing new marketing systems; processing personal data in a new jurisdiction or for a new purpose; data-sharing with any third party; retention-period changes |
| Inputs | Campaign and website data; qualification definitions; privacy requirements; finance's spend records |
| Outputs | Funnel and attribution model; marketing performance reports; data-retention configuration; system access register |
| KPIs | Reporting accuracy checks passed per period; duplicate and stale record rate in the contact database; time to produce the monthly performance report; personal-data records past retention (target 0) |
| Activation trigger | Marketing systems hold personal data for more than one hundred contacts, or two or more paid marketing systems require reconciliation against each other and against finance's records. |
| Current coverage | Not covered. No marketing automation system is in use; there is no contact database to operate. |
| Human / fractional / AI-supported | Human or fractional |
| Hiring priority | - |
| Required competencies | Marketing automation and CRM administration; data modeling and attribution; privacy-by-default configuration; SQL and reporting; vendor evaluation |
| Customer/security implications | Marketing systems are the most common location of unmanaged personal data in an early company, and a common lateral path into other systems through integration credentials. |

### Competitive and Market Intelligence Analyst

| Field | Value |
|---|---|
| Division | Marketing |
| Status | COVERED |
| Reports to | Head of Marketing (Founder/CEO until that role activates) |
| Mission | Keep an accurate, sourced picture of adjacent products and buying patterns so positioning responds to reality rather than assumption. |
| Responsibilities | Maintain the competitive and adjacency landscape with a source citation per assertion; track category and buying-pattern shifts in shared-device, endpoint, and access-decision tooling; produce battlecards that state only verifiable comparisons; monitor public documentation of adjacent products for capability changes; brief product on gaps that recur in evaluations; flag when SignalGrid's own language drifts toward a comparison it cannot support |
| Authority | Landscape structure and refresh cadence; which comparisons are supportable; source standards |
| Cannot approve alone | Publishing any comparative claim about a named vendor; using non-public information about another company; positioning changes derived from intel |
| Inputs | Public vendor documentation; standards and regulator publications; buyer conversations; analyst-firm public material |
| Outputs | Landscape map; sourced battlecards; category-shift briefs; comparison-claim register |
| KPIs | Percentage of competitive assertions carrying a dated public source (target 100%); landscape refresh completed per quarter; comparative claims withdrawn after challenge (target 0) |
| Activation trigger | Active now as a responsibility. Human hire when comparative evaluations against named products occur regularly enough that a wrong answer costs a deal, typically alongside the first sales hire. |
| Current coverage | AI-covered via agent roster: the `competitive-analyst` lane, with the founder's endpoint and infrastructure domain knowledge as the correction layer. |
| Human / fractional / AI-supported | AI-supported today; human later |
| Hiring priority | - |
| Required competencies | Primary-source research discipline; endpoint management, identity, and access-control market literacy; comparison ethics and legal limits; concise briefing writing |
| Customer/security implications | An unsupportable comparative claim is both a legal exposure and a credibility loss with the exact technical audience most able to check it. |

## Developer relations and community

**Output: developers who build on and vouch for the product.** SignalGrid is embedded — a host application calls the Assist gate and acts on allow, step_up, restrict, or deny — so the people who integrate it are developers inside customer organizations and partner-built host apps. Nothing in this division is staffed today, and no external developer community exists yet.

### Head of Developer Relations

| Field | Value |
|---|---|
| Division | Developer relations and community |
| Status | FUTURE |
| Reports to | Head of Marketing (Founder/CEO until that role activates); dotted line to Product |
| Mission | Make integrating SignalGrid a well-supported, well-documented experience and represent integrator reality back into the product. |
| Responsibilities | Own the developer experience end to end (documentation, samples, SDK ergonomics, error messages); set the DevRel program and its measurement; represent developer feedback in product planning with evidence; own the public developer communication channels and their moderation policy; run the developer content and talk program; define what SignalGrid supports publicly versus what remains internal |
| Authority | Developer program priorities; documentation structure; which integration paths get first-class support |
| Cannot approve alone | API contract changes or deprecations; public support commitments or response-time promises; describing any external developer or organization as a partner or user; roadmap statements |
| Inputs | API contract and versioning policy; integration support questions; product roadmap; sample application feedback |
| Outputs | Developer program plan; developer experience report; prioritized integration friction list; public developer channels |
| KPIs | Time from first documentation visit to a working integration in a test environment; unresolved integration questions older than one week; documented integration friction items closed per quarter |
| Activation trigger | Ten or more distinct external installations of the `/v1` client or a connector integration exist outside SignalGrid's own repositories, or two or more organizations are concurrently building host-app integrations. |
| Current coverage | Not covered as a program. The `/v1` contract, versioning policy, and integration documentation are maintained by engineering and the `docs-writer` and `api-contract-architect` agent lanes; no developer-facing program exists. |
| Human / fractional / AI-supported | Human (AI-supported) |
| Hiring priority | - |
| Required competencies | Developer relations for API and security products; ability to build a working integration personally; documentation architecture; public communication; translating developer complaints into product requirements |
| Customer/security implications | Integration mistakes in a trust gate can cause a host application to act on a decision it misread. Clear developer guidance is a safety control, not a courtesy. |

### Developer Advocate

| Field | Value |
|---|---|
| Division | Developer relations and community |
| Status | FUTURE |
| Reports to | Head of Developer Relations (Founder/CEO until that role activates) |
| Mission | Help developers succeed with a real integration, in public, and bring back what broke. |
| Responsibilities | Build and maintain reference integrations and sample host applications; answer public technical questions with reproducible answers; write integration tutorials and troubleshooting guides; speak at technical venues about shared-device trust problems; file issues from real integration friction with reproduction steps; run office hours or equivalent direct developer support |
| Authority | Content and talk topics within the approved claim set; sample application design; issue priority recommendations |
| Cannot approve alone | Support or availability commitments; unreleased functionality disclosure; claims about integrations at named organizations; API behavior changes |
| Inputs | Product documentation; developer questions; proof artifacts; release notes |
| Outputs | Reference integrations; tutorials; conference and meetup talks; reproduced issue reports |
| KPIs | Median time to first public answer on a developer question; reference integrations kept green against the current API version; issues filed with complete reproduction steps |
| Activation trigger | The first external developer opens a pull request or integration issue that documentation alone cannot answer, and a second follows within the same quarter. |
| Current coverage | Not covered. Integration questions would reach the founder directly today. |
| Human / fractional / AI-supported | Human |
| Hiring priority | - |
| Required competencies | Hands-on engineering in the integration languages; public technical communication; patience with unfamiliar environments; issue triage discipline |
| Customer/security implications | Public answers about a security product become de facto guidance. An imprecise answer about failure modes can propagate a fail-open integration pattern. |

### Developer Documentation and Samples Lead

| Field | Value |
|---|---|
| Division | Developer relations and community |
| Status | COVERED |
| Reports to | Head of Developer Relations (Founder/CEO until that role activates) |
| Mission | Keep the integration documentation and sample code correct against the shipping API, always. |
| Responsibilities | Own the API reference, integration guides, and error-message catalog; keep samples building and passing against the current contract; document decision semantics (allow, step_up, restrict, deny) and failure behavior precisely; maintain the versioning and deprecation notes; run documentation reviews against the API contract gate; keep cited paths and figures valid |
| Authority | Documentation structure and terminology; blocking a release note that misstates behavior; sample repository layout |
| Cannot approve alone | API contract or deprecation decisions; support-level language; publishing sample code with third-party licensed material |
| Inputs | API contract audit output; release notes; proof and gate results; developer questions |
| Outputs | API reference; integration guides; maintained sample projects; deprecation notices |
| KPIs | Documentation examples verified against the current contract (target 100%); sample build pass rate in continuous integration; documentation defects reported by developers per release |
| Activation trigger | Active now as a responsibility. Human hire when the public API surface has more than one supported major version, or when documentation defects reach a recurring weekly rate. |
| Current coverage | AI-covered via agent roster: `docs-writer` and `api-contract-architect` lanes, backed by the repository's API contract audit and cited-path gates. |
| Human / fractional / AI-supported | AI-supported today; human later |
| Hiring priority | - |
| Required competencies | API documentation; reading TypeScript and Swift well enough to verify examples; versioning and deprecation practice; docs-as-code tooling |
| Customer/security implications | Wrong documentation about a fail-closed gate is a security defect with a documentation root cause. Sample code gets copied into production paths unchanged. |

### Community Manager

| Field | Value |
|---|---|
| Division | Developer relations and community |
| Status | FUTURE |
| Reports to | Head of Developer Relations (Founder/CEO until that role activates) |
| Mission | Run public spaces where integrators help each other, under rules that are stated and enforced. |
| Responsibilities | Own the code of conduct, moderation policy, and enforcement record; triage and route public issues and discussions; recognize and support contributors; report community-sourced product signals; manage disclosure routing so security reports leave public channels immediately; maintain the contributor licensing process with legal |
| Authority | Moderation actions within policy; discussion structure and categories; contributor recognition |
| Cannot approve alone | Bans that involve a customer's employee; public statements about security reports; contributor licence terms; commitments about issue response times |
| Inputs | Public channel activity; security disclosure policy; contributor agreements; product release cadence |
| Outputs | Moderated public channels; enforcement log; community signal reports; contributor register |
| KPIs | Median first-response time on public threads; moderation actions resolved within policy timelines; security reports routed off public channels within one hour of detection (target 100%) |
| Activation trigger | Public issue and discussion volume exceeds twenty threads a month, or the first moderation or public security-disclosure incident occurs in a SignalGrid channel. |
| Current coverage | Not covered. The repository is public but has no community program; the security disclosure path is documented in `SECURITY.md` and reaches the founder. |
| Human / fractional / AI-supported | Human or fractional |
| Hiring priority | - |
| Required competencies | Open-source community management; moderation under a written policy; incident-aware communication; contributor licensing mechanics |
| Customer/security implications | Public channels attract vulnerability reports posted in the open. Fast, rehearsed routing is the difference between a coordinated fix and a public zero-day for a trust gate. |

## Brand, communications and analyst relations

**Output: a truthful public voice.** The company has one public voice today — the founder — and a repository whose gates refuse claims that no artifact supports. That gate is the reason this division can stay small: truthfulness is currently mechanical, not merely intended.

### VP Communications

| Field | Value |
|---|---|
| Division | Brand, communications and analyst relations |
| Status | FUTURE |
| Reports to | Founder/CEO |
| Mission | Own how SignalGrid speaks publicly — brand, press, analysts, and crisis — so the public voice is one voice and it is accurate. |
| Responsibilities | Own brand identity and voice standards; run press, analyst, and public-statement processes; own the crisis and incident communications plan and its rehearsal schedule; approve external speaking and publication by employees; coordinate disclosure communications with security and legal; maintain the public statement archive |
| Authority | Spokesperson designation; press process; brand standards; timing of routine announcements |
| Cannot approve alone | Incident disclosure content or timing (joint with security and legal, owner-approved); any claim of partnership, customer, certification, or attestation; regulatory statements; financial disclosures |
| Inputs | Product and company milestones; incident reports; legal and security review; analyst and press inquiries |
| Outputs | Brand and voice standards; crisis communication plan; press materials; public statement archive |
| KPIs | Public statements requiring later correction (target 0); crisis plan rehearsed per year; median time from inquiry to accurate response; percentage of external statements passing the claims check before release (target 100%) |
| Activation trigger | Two or more people besides the founder speak publicly for SignalGrid, or the first press or analyst inquiry arrives that requires a same-week coordinated response. |
| Current coverage | Founder/CEO, with the `brand-design` agent lane holding visual standards and the repository claims registry constraining wording. |
| Human / fractional / AI-supported | Human or fractional |
| Hiring priority | - |
| Required competencies | B2B security communications; crisis and breach communication; analyst and press relations; brand stewardship; working within legal and disclosure constraints |
| Customer/security implications | Incident communication is a security control. A company selling a trust gate is judged more on how it describes its own failures than on how it describes its successes. |

### Brand and Design Lead

| Field | Value |
|---|---|
| Division | Brand, communications and analyst relations |
| Status | COVERED |
| Reports to | VP Communications (Founder/CEO until that role activates) |
| Mission | Keep SignalGrid's visual and verbal identity consistent, accessible, and unmistakably its own across every surface. |
| Responsibilities | Own the design system tokens, typography, and decision-state palette across web and native surfaces; enforce contrast and accessibility floors on safety-critical states; keep brand assets synchronized between platforms so they do not fork; maintain the voice-and-tone guide alongside the editorial standard; review public surfaces for brand and accessibility conformance; document every palette change with measured contrast values |
| Authority | Brand asset standards; token values within accessibility floors; rejecting a surface that fails contrast requirements |
| Cannot approve alone | Changes to decision-state colors without re-running contrast measurement and owner approval; use of third-party marks; brand changes that alter product semantics |
| Inputs | Design system source; accessibility audits; contrast measurements; product surface inventory |
| Outputs | Design tokens and brand assets; voice and tone guide; contrast measurement records; brand conformance reviews |
| KPIs | Decision-state color pairs meeting WCAG AA against both background and card surfaces in both appearances (target 100%); platform token drift incidents (target 0); accessibility findings on branded surfaces per audit |
| Activation trigger | Active now as a responsibility. Human hire when more than two product surfaces are under simultaneous active design by different people. |
| Current coverage | AI-covered via agent roster: the `brand-design` lane, with the repository's contrast findings record and accessibility checks as enforcement; founder approves palette changes. |
| Human / fractional / AI-supported | AI-supported today; fractional or human later |
| Hiring priority | - |
| Required competencies | Design systems across web and native; WCAG contrast mathematics; token architecture; typography that scales with platform accessibility settings |
| Customer/security implications | Decision states are safety-critical UI. Insufficient contrast on a deny state, or color used as the sole signal, can cause a worker to misread an access decision. |

### Corporate Communications and Public Relations Manager

| Field | Value |
|---|---|
| Division | Brand, communications and analyst relations |
| Status | FUTURE |
| Reports to | VP Communications (Founder/CEO until that role activates) |
| Mission | Handle press and public inquiries with accurate, timely, pre-checked answers. |
| Responsibilities | Manage press inquiries and the media contact list; draft announcements and hold statements for foreseeable events; prepare and rehearse spokespeople; maintain the corporate fact sheet with only verifiable facts; coordinate publication timing with product and legal; log every public statement with its approval trail |
| Authority | Media list management; drafting and scheduling within approved messaging; declining an inquiry |
| Cannot approve alone | Any statement during a security incident; forward-looking statements; comments about other companies; use of the word partner, customer, certified, or attested in any form |
| Inputs | Company milestones; approved claim set; legal review; incident status from security |
| Outputs | Press materials; hold statements; spokesperson briefs; public statement log |
| KPIs | Inquiries answered within the stated response window; statements requiring correction (target 0); percentage of statements with a recorded approval trail (target 100%) |
| Activation trigger | The company receives press inquiries at a rate above one a month, or a public announcement is planned that requires coordinated media handling. |
| Current coverage | Not covered. Inquiries reach the founder, who answers directly. |
| Human / fractional / AI-supported | Fractional or human |
| Hiring priority | - |
| Required competencies | B2B technology press relations; writing under legal constraint; incident communications; message discipline |
| Customer/security implications | A press statement is a representation to prospective buyers. Precision about scope prevents a claim being quoted back during a procurement review. |

### Analyst Relations Manager

| Field | Value |
|---|---|
| Division | Brand, communications and analyst relations |
| Status | FUTURE |
| Reports to | VP Communications (Founder/CEO until that role activates) |
| Mission | Give industry analysts an accurate, evidence-backed understanding of what SignalGrid does and where it fits. |
| Responsibilities | Manage the briefing calendar and briefing content; prepare evidence packs that match every claim to an artifact; correct inaccurate third-party descriptions promptly and in writing; track category definitions and where SignalGrid does and does not fit them; manage inquiry access for the company; maintain the record of what was said in each briefing |
| Authority | Briefing scheduling and content within the approved claim set; which analysts to engage first |
| Cannot approve alone | Participation in any paid evaluation or ranking; describing an analyst relationship publicly; sharing non-public roadmap or customer information; category positioning changes |
| Inputs | Approved claim set; product scope; proof artifacts; competitive landscape |
| Outputs | Briefing decks and evidence packs; briefing records; correction requests; category fit assessment |
| KPIs | Factual corrections needed in third-party write-ups after a briefing (target 0); briefings delivered against plan; percentage of briefing claims backed by a named artifact (target 100%) |
| Activation trigger | **No analyst relationship of any kind exists today; this role activates when an industry analyst firm is engaged under a briefing or paid inquiry arrangement and a first briefing is scheduled.** |
| Current coverage | Not covered, and no engagement exists to cover. The `competitive-analyst` agent lane tracks publicly available analyst material only, as a research input. |
| Human / fractional / AI-supported | Fractional or human |
| Hiring priority | - |
| Required competencies | Analyst relations practice; category and market framing; evidence-pack preparation; strict separation between paid and unpaid analyst interactions |
| Customer/security implications | Analyst write-ups are cited in procurement. An unchallenged inaccuracy becomes a claim SignalGrid appears to have made about its own security behavior. |

### Public Claims Steward

| Field | Value |
|---|---|
| Division | Brand, communications and analyst relations |
| Status | ACTIVE |
| Reports to | Founder/CEO |
| Mission | Ensure that nothing SignalGrid publishes states or implies something it cannot currently prove. |
| Responsibilities | Maintain the registry of forbidden and retired claims and the artifact each permitted claim maps to; review public-facing changes against the claims and publication-boundary gates before they ship; keep the vocabulary rules current (no partnership, customer, certification, attestation, SLA, or availability language without a named basis); investigate and log every claim that reached the public surface in error; keep the launch-scope boundary enforced in org and marketing documents; report claim-gate status honestly, including failures |
| Authority | Blocking publication of any claim lacking a named artifact; wording corrections; opening a claim investigation |
| Cannot approve alone | Widening launch scope (owner decision, per DR-005); approving a new claim category; retiring a claim rule |
| Inputs | Proposed public content; proof and gate results; product scope decisions; the false-claims registry |
| Outputs | Claim-to-artifact map; claims review verdicts; corrections log; gate status reports |
| KPIs | Claims-gate violations reaching the public repository (target 0); percentage of public claims with a named backing artifact (target 100%); median time to correct a published inaccuracy |
| Activation trigger | Active now. |
| Current coverage | Founder/CEO, enforced mechanically by the repository's claims registry (`docs/agent/FALSE_CLAIMS.json`), the publication-boundary check, and the docs-to-proof figure guard. Agent lanes draft; the gates and the founder decide. |
| Human / fractional / AI-supported | Human, AI-supported, gate-enforced |
| Hiring priority | - |
| Required competencies | Claim analysis; familiarity with the proof estate and what each gate actually proves; regulatory marketing constraints; willingness to block a launch over a sentence |
| Customer/security implications | This is the company's primary defense against selling trust it has not earned. In a fail-closed product, an unprovable public claim is the same class of defect as a gate that fails open. |

## Finance

**Output: preserve economic truth.** There is no finance staff. The founder holds the company's financial facts, and the four recurring billing figures — monthly model spend, developer-program status and fee, source-control plan and repository visibility, and total domain spend — are owner-only by decision DR-005 and are never estimated by anyone else, human or agent. Every role below inherits that rule.

### Chief Financial Officer

| Field | Value |
|---|---|
| Division | Finance |
| Status | FRACTIONAL |
| Reports to | Founder/CEO |
| Mission | Hold the company's financial model, controls, and capital plan to a standard an outside party could audit. |
| Responsibilities | Own the financial model and its assumptions register; design the control environment (approval limits, segregation of duties, expense policy); lead capital planning and any fundraising process; own reporting to the founder and any future board; approve the accounting policy set; own the relationship with the outside accountant and, later, auditors |
| Authority | Financial model structure and assumption documentation; control thresholds within owner-set limits; close calendar and reporting format |
| Cannot approve alone | Fundraising terms; equity issuance; the four owner-only billing figures; entering credit facilities; changing the fiscal year or accounting basis; any spend above the owner's threshold |
| Inputs | Bank and payment records; owner-supplied cost figures; pricing model; hiring plan; contractual obligations |
| Outputs | Financial model; monthly financial summary; control policy; capital plan |
| KPIs | Close completed within the target number of business days; variance between forecast and actual by category; audit or review findings on controls (target 0); estimated figures published where owner-only data was required (target 0) |
| Activation trigger | **No CFO is engaged today, fractional or otherwise.** A fractional CFO is engaged when the company raises external capital, takes on recurring revenue requiring formal reporting, or is asked for financial statements by a counterparty. A full-time CFO is not contemplated at this stage. |
| Current coverage | Founder/CEO holds all financial facts and decisions. The `finance-fundraising` agent lane maintains model structure and scenario scaffolding only, with owner-only figures left as explicit unknowns rather than estimates. |
| Human / fractional / AI-supported | Fractional (not yet engaged) |
| Hiring priority | - |
| Required competencies | Early-stage SaaS finance; control design at small headcount; fundraising process management; working with a founder who holds the source data |
| Customer/security implications | Financial statements shared during procurement or diligence are representations. Overstating financial stability to a buyer evaluating a security dependency is a trust failure with contractual consequences. |

### Controller and Accounting Manager

| Field | Value |
|---|---|
| Division | Finance |
| Status | FUTURE |
| Reports to | CFO (Founder/CEO until engaged) |
| Mission | Produce accurate books on a predictable schedule, with every entry traceable to a document. |
| Responsibilities | Own the general ledger, chart of accounts, and monthly close; apply revenue recognition policy to signed contracts; maintain supporting documentation for every material entry; reconcile bank, payment processor, and expense accounts; prepare schedules for tax and any review or audit; maintain the fixed-asset and prepaid registers |
| Authority | Journal entries within policy; close calendar mechanics; chart of accounts structure |
| Cannot approve alone | Accounting policy changes; revenue recognition treatment for a novel contract; write-offs above the owner's threshold; the four owner-only billing figures |
| Inputs | Bank and card feeds; vendor invoices; signed contracts; payroll records; owner-supplied cost figures |
| Outputs | Monthly financial statements; reconciliation records; audit-ready schedules; close checklist results |
| KPIs | Close completed within target days each month; unreconciled items at close (target 0); entries lacking supporting documentation (target 0) |
| Activation trigger | Recurring third-party invoices plus payroll exist and monthly close can no longer be completed reliably by the founder plus a bookkeeper, or a signed customer contract requires a stated revenue recognition treatment. |
| Current coverage | Not covered internally. Transaction volume is low enough that the founder holds it directly; an outside bookkeeper or accountant would be engaged before this becomes a role. |
| Human / fractional / AI-supported | Fractional first, human later |
| Hiring priority | - |
| Required competencies | GAAP for software companies; SaaS revenue recognition; reconciliation discipline; accounting system administration |
| Customer/security implications | Accounting systems hold banking credentials and vendor payment details — a high-value target and a common business-email-compromise entry point. |

### Financial Planning and Analysis Analyst

| Field | Value |
|---|---|
| Division | Finance |
| Status | COVERED |
| Reports to | CFO (Founder/CEO until engaged) |
| Mission | Keep an honest forward view of runway, spend, and the economics of each decision the company is considering. |
| Responsibilities | Maintain the operating model, runway calculation, and scenario set; produce budget-versus-actual analysis with named variance causes; model the cost of hiring, infrastructure, and agent operation as separate lines; support pricing and packaging decisions with margin analysis; flag when a scenario depends on a figure the model does not have; keep every assumption sourced or marked unknown |
| Authority | Model structure and scenario definitions; variance explanations; flagging an unfunded plan |
| Cannot approve alone | Publishing any dollar figure sourced from estimate rather than record; budget approval; headcount plans; the four owner-only billing figures, which stay marked unknown until the owner supplies them |
| Inputs | Owner-supplied cost figures; infrastructure and platform usage data; hiring sequence; pricing model |
| Outputs | Operating model and runway view; scenario analyses; variance reports; assumption register with unknowns marked |
| KPIs | Percentage of model assumptions carrying a source or an explicit unknown marker (target 100%); forecast-to-actual variance by category; estimated values substituted for owner-only figures (target 0) |
| Activation trigger | Active now as a responsibility, at low volume. Human hire when the company has recurring revenue and more than one spending team whose plans must be reconciled. |
| Current coverage | AI-covered via agent roster: the `finance-fundraising` lane maintains model structure and scenarios; the `agent-ops-economics` lane holds agent-operation cost structure. Both leave the four owner-only billing figures as unknowns. The founder supplies every real number. |
| Human / fractional / AI-supported | AI-supported today; human or fractional later |
| Hiring priority | - |
| Required competencies | SaaS operating models; scenario and sensitivity analysis; cost attribution for cloud and model spend; disciplined refusal to fill a gap with a guess |
| Customer/security implications | Runway figures shared in diligence are representations about the company's ability to keep operating a dependency in a customer's access path. |

### Accounts Payable, Receivable and Payroll Finance Operations

| Field | Value |
|---|---|
| Division | Finance |
| Status | FUTURE |
| Reports to | Controller (Founder/CEO until engaged) |
| Mission | Move money correctly, on time, and only to verified counterparties. |
| Responsibilities | Process vendor invoices against purchase approvals and verified bank details; issue customer invoices and manage collections; execute payroll funding and reconcile it to the payroll register; enforce dual verification on any bank-detail change; maintain the vendor and customer master records; produce aging reports |
| Authority | Payment scheduling within approved terms; invoice disputes with vendors; collection sequence |
| Cannot approve alone | Any payment above the owner's threshold; new vendor bank details (requires out-of-band verification by a second person); write-off of receivables; payroll amounts |
| Inputs | Approved purchase orders; signed contracts; payroll register; bank access controls |
| Outputs | Paid invoices; issued customer invoices; aging reports; vendor master with verification records |
| KPIs | Payments made to unverified bank details (target 0); invoices paid within terms; days sales outstanding; payroll funding errors (target 0) |
| Activation trigger | The first non-founder person is paid — employee or contractor on recurring terms — or the first customer invoice is issued. |
| Current coverage | Not covered. No payroll exists and no customer invoices have been issued. |
| Human / fractional / AI-supported | Fractional or outsourced first |
| Hiring priority | - |
| Required competencies | Payables and receivables operations; payment fraud controls; payroll funding mechanics; vendor verification procedure |
| Customer/security implications | Payment-instruction fraud is the most likely direct financial attack on a company this size. Out-of-band verification of bank-detail changes is the control that stops it. |

### Treasury and Banking Manager

| Field | Value |
|---|---|
| Division | Finance |
| Status | FUTURE |
| Reports to | CFO (Founder/CEO until engaged) |
| Mission | Keep the company's cash safe, available when needed, and held under controls that survive a compromised account. |
| Responsibilities | Manage bank and payment-processor relationships and account structure; set cash placement policy within owner-approved risk limits; maintain banking access controls, approval limits, and multi-person authorization; manage foreign-currency exposure if it arises; forecast short-term cash needs; run periodic access reviews on all financial systems |
| Authority | Account structure and payment rails within policy; short-term cash placement within approved limits; revoking financial system access |
| Cannot approve alone | Opening or closing accounts; changing signatories or approval limits; any credit facility; investment policy; foreign-currency hedging |
| Inputs | Cash forecast; bank statements; access review results; upcoming obligations |
| Outputs | Cash position and forecast; banking access register; treasury policy; access review records |
| KPIs | Financial system accounts with unreviewed access older than one quarter (target 0); forecast accuracy on short-horizon cash needs; single-signature payments above the threshold (target 0) |
| Activation trigger | Cash is held at more than one institution, a foreign-currency obligation exists, or payment volume requires more than one authorized signer. |
| Current coverage | Not covered as a role. The founder holds banking directly at minimal complexity. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Treasury operations at small scale; banking access control design; cash forecasting; payment fraud prevention |
| Customer/security implications | Financial system access is a privileged path with no product gate in front of it. Access reviews and multi-person authorization are the same discipline SignalGrid sells, applied internally. |

### Tax and Statutory Filings

| Field | Value |
|---|---|
| Division | Finance |
| Status | FRACTIONAL |
| Reports to | CFO (Founder/CEO until engaged) |
| Mission | Meet every tax and statutory filing obligation on time and on a defensible basis. |
| Responsibilities | Prepare and file corporate income tax returns; determine sales and use or VAT obligations as the company sells into new jurisdictions; handle payroll tax registration and filings once payroll exists; maintain the filing calendar with owners and due dates; advise on entity and nexus questions before they become obligations; retain filing documentation |
| Authority | Filing positions within professional standards; the filing calendar; requesting extensions |
| Cannot approve alone | Aggressive or novel tax positions; entity structure changes; jurisdiction entry decisions; anything requiring a founder representation |
| Inputs | Financial statements; payroll records; sales locations and contract terms; entity registrations |
| Outputs | Filed returns; filing calendar; nexus assessment; retained documentation |
| KPIs | Filings submitted by the statutory deadline (target 100%); penalties or interest assessed (target 0); jurisdictions with unassessed nexus (target 0) |
| Activation trigger | Engaged for the first fiscal year in which the entity has reportable activity, or immediately upon the first sale into a jurisdiction with a sales-tax or VAT registration threshold. Not engaged today. |
| Current coverage | Not covered. This is an outside professional engagement by design; no accountant is retained for tax at present. |
| Human / fractional / AI-supported | Fractional (outside professional, not yet engaged) |
| Hiring priority | - |
| Required competencies | Corporate and multi-jurisdiction software tax; SaaS sales-tax nexus; payroll tax registration; documentation retention standards |
| Customer/security implications | Tax filings require sharing financial and, at payroll stage, personal data with an outside firm — a data-processing relationship that needs its own agreement and access limits. |

### Pricing and SaaS Economics Analyst

| Field | Value |
|---|---|
| Division | Finance |
| Status | COVERED |
| Reports to | CFO (Founder/CEO until engaged); dotted line to Product |
| Mission | Make pricing and packaging decisions that reflect real delivery cost and hold up when a buyer asks how the number was reached. |
| Responsibilities | Maintain the pricing and packaging model with its cost basis; analyze unit economics per deployment shape (self-hosted, managed, per-device, per-decision); model discount and term structures and their margin impact; keep licensing dependencies of third-party components priced as customer-specific where they apply; test packaging changes against segment willingness signals; document why each price exists |
| Authority | Model structure and scenario definitions; margin analysis methodology; flagging a packaging change as margin-negative |
| Cannot approve alone | Published prices; discounts beyond approved bands; contract terms with pricing implications; any public statement of price; the four owner-only billing figures |
| Inputs | Delivery cost data; infrastructure and agent operation costs; segment research; competitive packaging (public sources only) |
| Outputs | Pricing model and rationale; unit economics by deployment shape; discount policy analysis; packaging proposals |
| KPIs | Percentage of price points with a documented cost basis (target 100%); gross margin by deployment shape; discount band exceptions per period |
| Activation trigger | Active now as a responsibility. Human hire when list pricing is published and real deals require ongoing discount governance. |
| Current coverage | AI-covered via agent roster: the `pricing-packaging-analyst` lane maintains model structure; the `agent-ops-economics` lane supplies operating cost structure. Owner-only billing figures stay unknown in the model until the owner supplies them, and no dollar figure is estimated. |
| Human / fractional / AI-supported | AI-supported today; human or fractional later |
| Hiring priority | - |
| Required competencies | SaaS pricing and packaging; unit economics for infrastructure-heavy delivery; discount governance; segment research interpretation |
| Customer/security implications | Pricing that ignores true delivery cost creates pressure to under-resource operations for a component sitting in a customer's access path. Premium-only dependencies must be priced as customer-specific rather than assumed into the baseline. |

### Cost Modeling and Agent Operations Economics

| Field | Value |
|---|---|
| Division | Finance |
| Status | COVERED |
| Reports to | CFO (Founder/CEO until engaged); dotted line to AI/Agent Operations |
| Mission | Know what it costs to run the company's compute, infrastructure, and agent lanes, and make that cost visible before it becomes a surprise. |
| Responsibilities | Maintain the cost model for infrastructure, model usage, and third-party services; attribute cost to the work that caused it (product group, lane, environment); track cost per unit of delivered work as a trend; identify structural cost drivers and propose changes; keep every figure sourced to a record or explicitly marked owner-only; alert when a usage pattern changes materially |
| Authority | Cost model structure and attribution rules; usage reporting cadence; raising a cost anomaly |
| Cannot approve alone | Publishing or estimating the four owner-only billing figures; committing to service tiers; provider or model selection (AI/Agent Operations decides, with owner approval); shutting down a service |
| Inputs | Provider usage records supplied by the owner; infrastructure telemetry; agent lane activity records; service inventory |
| Outputs | Cost model; attribution reports; usage trend alerts; structural cost recommendations |
| KPIs | Percentage of cost lines traced to a usage record or marked owner-only (target 100%); cost anomalies detected before the billing period closes; unattributed spend as a share of total |
| Activation trigger | Active now as a responsibility. Human ownership when monthly spend crosses the owner's review threshold or when more than one team can incur infrastructure cost independently. |
| Current coverage | AI-covered via agent roster: the `agent-ops-economics` lane. The four owner-only billing figures — model spend, developer-program fee, source-control plan, and domain spend — are supplied by the owner and never estimated; the model carries them as explicit unknowns. |
| Human / fractional / AI-supported | AI-supported, owner-fed |
| Hiring priority | - |
| Required competencies | Cloud and model cost attribution; usage telemetry analysis; unit-cost modeling; strict source discipline on figures |
| Customer/security implications | Cost visibility is an availability control: undetected cost growth in a component a customer depends on becomes an unplanned service change. Usage records can also reveal customer activity patterns and need the same access limits as product data. |

### Procurement, Vendor and Insurance Manager

| Field | Value |
|---|---|
| Division | Finance |
| Status | FUTURE |
| Reports to | CFO (Founder/CEO until engaged); dotted line to Security |
| Mission | Bring third-party services into the company deliberately, with the security, contractual, and insurance questions answered first. |
| Responsibilities | Run vendor intake with a security and data-processing review before purchase; maintain the vendor register with data classification, access scope, and renewal dates; negotiate commercial terms within approved limits; manage insurance placement and renewals (general liability, professional and cyber lines) with a broker; track subprocessor status for anything touching customer data; run periodic vendor access reviews and offboard promptly |
| Authority | Vendor selection within approved budget and completed security review; renewal or termination recommendations; blocking a purchase pending review |
| Cannot approve alone | Any vendor processing customer or personal data (requires security and legal review); insurance coverage levels; spend above the owner's threshold; contract terms creating liability exposure |
| Inputs | Purchase requests; security review results; data-processing requirements; insurance requirements from contracts |
| Outputs | Vendor register with data classification; completed security reviews; insurance policies and certificates; renewal calendar |
| KPIs | Vendors in production use without a completed security review (target 0); renewals reviewed before auto-renewal date (target 100%); vendor access removed within the target window after offboarding |
| Activation trigger | A counterparty contractually requires evidence of insurance, or the company's recurring third-party services exceed what the founder tracks in a single document with confidence. |
| Current coverage | Not covered as a role. The founder selects services directly; the repository's third-party asset and licence checks catch software-supply-chain intake, not commercial vendor risk. No insurance is placed today. |
| Human / fractional / AI-supported | Fractional (broker for insurance); human later |
| Hiring priority | - |
| Required competencies | Vendor risk assessment; SaaS contract negotiation; insurance placement for technology companies; subprocessor management |
| Customer/security implications | Every vendor touching customer data becomes a subprocessor a buyer's security team will ask about. An unreviewed vendor with production access is an unmanaged path into a trust-decision system. |

## Legal and corporate affairs

**Output: preserve corporate and contractual truth.** No lawyer is engaged today. Two duties in this division are nonetheless live and performed now: open-source and third-party licensing review, because the repository is public and third-party material intake already happens, and corporate record-keeping, because decisions are recorded as they are made.

### General Counsel / Chief Legal Officer

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FRACTIONAL |
| Reports to | Founder/CEO |
| Mission | Keep the company's legal position accurate and defensible, and keep legal risk visible before it is taken. |
| Responsibilities | Own the legal risk register and escalation thresholds; approve contract templates and the fallback position set; oversee corporate governance and entity compliance; direct and manage outside counsel across specialties; own the legal side of incident and breach response; review public claims that create legal exposure |
| Authority | Legal positions within owner-set risk limits; template and fallback language; selecting and directing outside counsel |
| Cannot approve alone | Litigation initiation or settlement; equity and financing documents; indemnity or liability caps beyond owner limits; regulatory commitments; anything that changes company ownership |
| Inputs | Contracts presented for signature; regulatory developments; incident reports; corporate records; product scope decisions |
| Outputs | Contract templates and playbooks; legal risk register; governance records; outside counsel engagement records |
| KPIs | Contracts signed without legal review (target 0); template fallback coverage of terms actually negotiated; time from contract receipt to reviewed position; statutory filing deadlines met (target 100%) |
| Activation trigger | **No general counsel is engaged today, fractional or otherwise.** Fractional counsel is engaged at the first of: a non-standard customer agreement presented for signature, an employment offer, a financing process, or a regulatory or litigation contact. A full-time general counsel is not contemplated at this stage. |
| Current coverage | Founder/CEO makes legal decisions, informed by the `commercial-counsel` agent lane, which drafts and flags issues and is explicitly not a source of legal advice. Nothing here substitutes for a licensed lawyer, and the founder does not treat it as such. |
| Human / fractional / AI-supported | Fractional (not yet engaged) |
| Hiring priority | - |
| Required competencies | Technology and SaaS commercial law; privacy and data protection; regulated-sector contracting (healthcare and public sector); managing outside counsel efficiently; risk communication to a non-lawyer founder |
| Customer/security implications | Contractual commitments about security behavior become obligations SignalGrid must be able to prove. This role is the boundary between what engineering can demonstrate and what the company promises in writing. |

### Commercial Counsel and Contract Management

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FRACTIONAL |
| Reports to | General Counsel (Founder/CEO until engaged) |
| Mission | Turn commercial agreements into terms the company can actually perform, and keep every signed obligation findable. |
| Responsibilities | Draft and negotiate customer agreements, order forms, data processing agreements, and mutual non-disclosure agreements; maintain the fallback position playbook so negotiation does not restart each time; run the contract repository with obligation, renewal, and notice-date tracking; extract security and uptime obligations and route them to the owning function for feasibility confirmation before signature; manage the vendor-side paper; keep the signature and approval trail complete |
| Authority | Negotiating within the approved fallback ranges; contract repository structure; flagging an unperformable obligation |
| Cannot approve alone | Liability caps, indemnities, and warranty language outside approved ranges; any uptime, response-time, or security commitment not confirmed as achievable by the owning function; naming the counterparty publicly; unusual termination or audit rights |
| Inputs | Deal terms; product capability confirmations; security posture documentation; insurance coverage; pricing approvals |
| Outputs | Executed agreements; contract repository with obligation calendar; fallback playbook; obligation summaries for delivery teams |
| KPIs | Signed obligations recorded in the repository (target 100%); commitments signed without a feasibility confirmation (target 0); renewal and notice dates missed (target 0); median review turnaround |
| Activation trigger | The first agreement beyond a mutual non-disclosure agreement is presented for signature — a customer order form, a master services agreement, or a data processing agreement. |
| Current coverage | Partly AI-covered via the `commercial-counsel` agent lane for drafting, issue-spotting, and obligation extraction; the founder reviews and decides. No licensed lawyer is engaged, and the lane's output is not legal advice. |
| Human / fractional / AI-supported | Fractional (AI-supported drafting) |
| Hiring priority | - |
| Required competencies | SaaS commercial contracting; data processing agreement drafting; obligation management practice; translating technical capability into contract language accurately |
| Customer/security implications | A signed security commitment the product cannot demonstrate is the most direct route from a sales conversation to a breach-of-contract claim. Every such term must trace to something the proof estate can show. |

### Privacy and Data Protection Counsel

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FUTURE |
| Reports to | General Counsel (Founder/CEO until engaged); dotted line to CISO |
| Mission | Make sure personal data is handled lawfully everywhere the company operates, and that the paperwork matches the system's actual behavior. |
| Responsibilities | Maintain the data inventory and lawful basis for each processing activity; draft and negotiate data processing agreements and subprocessor terms; run privacy impact assessments before new processing; own breach notification analysis and timelines with security; advise on cross-border transfer mechanisms; verify that privacy notices describe what the system actually does |
| Authority | Lawful basis determinations; privacy assessment conclusions; requiring an assessment before a launch |
| Cannot approve alone | Accepting a regulated-sector data obligation (healthcare or public sector) without a human compliance review; breach notification decisions; new jurisdiction entry; product changes that expand data collection |
| Inputs | Data flow documentation; product architecture; customer contractual requirements; regulatory developments; incident reports |
| Outputs | Data inventory; privacy impact assessments; data processing agreements; breach analysis records; privacy notices |
| KPIs | Processing activities with a documented lawful basis (target 100%); privacy assessments completed before launch of new processing (target 100%); notification analyses completed within the statutory clock |
| Activation trigger | SignalGrid processes personal data belonging to another organization outside fixtures and simulation, or a counterparty requires a data processing agreement, or the company enters a jurisdiction with a distinct data protection regime. |
| Current coverage | Not covered. The decision core is fixture-backed and no external personal data is processed today. The product's own data-minimization posture is engineering-owned; the legal analysis has no live subject matter yet. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Data protection law across relevant jurisdictions; healthcare and public-sector data rules; breach notification practice; reading system architecture well enough to verify a privacy notice |
| Customer/security implications | Regulated-vertical deployments require a human compliance review; no automated process and no tooling claim substitutes for it. Privacy documentation that misdescribes system behavior is worse than none, because it is relied upon. |

### Open-Source Licensing and Intellectual Property Steward

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | ACTIVE |
| Reports to | General Counsel (Founder/CEO until engaged); dotted line to Engineering |
| Mission | Keep every third-party component and asset in this public repository on a stated, permissible licence basis, and keep SignalGrid's own intellectual property clean. |
| Responsibilities | Review the licence of every incoming third-party dependency, skill, document, and binary asset before it enters the tree, and record the basis; block republication of material with no licence, an unread custom licence, or scraped third-party content; maintain the attribution and notice files; run outbound licence review on what SignalGrid publishes; manage trademark and copyright registrations when they are filed; keep contributor licensing arrangements ready before the first external contribution |
| Authority | Blocking intake of any asset lacking a stated licence basis; attribution requirements; requiring a human read of a custom licence before use |
| Cannot approve alone | Adopting a copyleft-licensed component into distributed code; SignalGrid's own outbound licence choice; trademark filings; settling an infringement claim; publishing owner-supplied material of external origin |
| Inputs | Dependency manifests; owner-supplied intake material; upstream repository licence files; publication-boundary gate output |
| Outputs | Licence basis register per third-party asset; attribution and notice files; intake verdicts; blocked-asset records |
| KPIs | Third-party assets in the public repository without a recorded licence basis (target 0); custom or absent-licence material used before a human read (target 0); attribution completeness at each release |
| Activation trigger | Active now. This duty is live: third-party material intake already occurs, the repository is public, and the publication-boundary gate fails the build when an asset of external origin lacks a stated licence basis. |
| Current coverage | Founder/CEO, enforced mechanically by `scripts/publication-boundary.mjs` and the intake survey record, which has already rejected collections carrying no licence and held an unread custom licence unused. The `records-archivist` agent lane keeps the register. |
| Human / fractional / AI-supported | Human, AI-supported, gate-enforced |
| Hiring priority | - |
| Required competencies | Open-source licence families and their obligations; republication versus use distinctions; dependency scanning; attribution mechanics; knowing when a licence question needs a lawyer |
| Customer/security implications | Buyers request a bill of materials with licences. Unlicensed third-party content in a public repository is both a legal exposure and a supply-chain integrity question about what else entered unreviewed. |

### Employment Counsel

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FUTURE |
| Reports to | General Counsel (Founder/CEO until engaged); dotted line to People |
| Mission | Make hiring, employing, and separating people lawful and consistent in every jurisdiction the company employs in. |
| Responsibilities | Draft offer letters, employment and contractor agreements, and confidentiality and invention-assignment terms; advise on worker classification before an engagement starts; review policies for statutory compliance in each employment jurisdiction; advise on termination and separation processes; support equity documentation with corporate counsel; advise on cross-border employment and contractor arrangements |
| Authority | Template employment documents; classification advice; requiring a policy change for statutory compliance |
| Cannot approve alone | Termination decisions; equity grant terms; settlement of an employment claim; entering a new employment jurisdiction |
| Inputs | Hiring plans; jurisdiction of each role; compensation structure; policy drafts; incident or complaint reports |
| Outputs | Employment document templates; classification determinations; compliant policy set; separation process guidance |
| KPIs | Engagements started without a signed agreement (target 0); classification determinations documented before start date (target 100%); statutory policy requirements met per jurisdiction |
| Activation trigger | The first offer letter or recurring contractor agreement is drafted, or the first engagement in a jurisdiction where the company has not previously engaged anyone. |
| Current coverage | Not covered. The company has no employees or recurring contractors, so no employment documents exist. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Employment law in the relevant jurisdictions; contractor classification; invention assignment and confidentiality drafting; separation practice |
| Customer/security implications | Invention-assignment and confidentiality terms protect the codebase and the customer data employees can reach. Misclassification creates liability and gaps in confidentiality coverage. |

### Corporate Governance and Entity Administration

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | COVERED |
| Reports to | General Counsel (Founder/CEO until engaged) |
| Mission | Keep the corporate record complete, current, and consistent with what the company actually decided. |
| Responsibilities | Maintain the entity registrations, registered agent, and annual filings calendar; keep the capitalization record accurate and reconciled to signed documents; record material decisions with date, decider, verbatim basis, and reversal conditions; maintain board and consent records once a board exists; keep the policy register and its version history; retain records per the retention schedule |
| Authority | Record format and retention mechanics; decision-record structure; requiring a decision be recorded before it is acted on |
| Cannot approve alone | Entity formation, dissolution, or jurisdiction changes; equity issuance or cap table changes; board composition; document destruction outside schedule |
| Inputs | Owner decisions with their verbatim wording; signed documents; statutory filing deadlines; policy changes |
| Outputs | Decision records; cap table; entity filings; policy register; retention records |
| KPIs | Material decisions recorded with a dated verbatim basis (target 100%); statutory filings submitted on time (target 100%); cap table reconciled to source documents each period |
| Activation trigger | Active now as a responsibility. It becomes a distinct human role when a board or outside investors exist and consents and minutes must be produced on a schedule. |
| Current coverage | Founder/CEO, supported by the repository's decision record practice — each owner decision recorded with its date, its quoted wording, and its reversal conditions — and the `records-archivist` agent lane. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Corporate secretarial practice; cap table administration; records retention; disciplined decision documentation |
| Customer/security implications | Diligence and enterprise procurement both request corporate records. An incomplete record slows a deal and raises questions about operational discipline in a company selling operational discipline. |

### Regulatory Affairs

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FUTURE |
| Reports to | General Counsel (Founder/CEO until engaged); dotted line to Privacy, compliance and risk |
| Mission | Understand what regulators and assessors require of a trust-decision component in each target sector, and keep the company's answers accurate. |
| Responsibilities | Track sector regulations applicable to shared-device access decisions in healthcare, public sector, and industrial settings; map product behavior to control frameworks buyers cite, marking each mapping as evidenced or not; respond to regulator or assessor inquiries with counsel; advise product on regulatory consequences of scope changes; maintain the register of what SignalGrid does and does not attest to; keep sector claims inside what a human compliance review has confirmed |
| Authority | Control mapping methodology; marking a mapping unevidenced; requiring counsel involvement in a regulator contact |
| Cannot approve alone | Any statement that SignalGrid is certified, attested, compliant, or assessed; regulatory submissions; sector claims without a human compliance review; scope changes |
| Inputs | Applicable regulations and framework texts; product behavior documentation; proof and evidence artifacts; buyer questionnaires |
| Outputs | Control mapping with evidence status; regulatory response records; sector requirement briefs; attestation register (currently empty) |
| KPIs | Control mappings citing a named evidence artifact (target 100%); unevidenced mappings presented as evidenced (target 0); regulator or assessor inquiries answered within the requested window |
| Activation trigger | A buyer's assessor or a regulator requests a written control mapping, or the company pursues an external assessment for the first time. |
| Current coverage | Not covered as a role. Compliance analysis capability exists in the agent roster as an engineering-side lane that maps behavior to controls; nothing has been assessed or attested by any external party, and the company holds no certifications. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Sector regulation in healthcare and public sector; control framework literacy; evidence-based mapping discipline; precision about the difference between mapped, evidenced, and attested |
| Customer/security implications | The gap between "we map to this control" and "an assessor confirmed it" is exactly where trust is lost. This role exists to keep that distinction visible in every document a buyer reads. |

### Corporate Development and Transaction Support

| Field | Value |
|---|---|
| Division | Legal and corporate affairs |
| Status | FUTURE |
| Reports to | General Counsel (Founder/CEO until engaged); dotted line to CFO |
| Mission | Run financing or transaction processes without losing control of the record or over-representing the company. |
| Responsibilities | Prepare and maintain the diligence data room with accurate, current documents; coordinate diligence responses across legal, finance, security, and engineering; ensure representations match verifiable records; manage transaction counsel and process timelines; track disclosure schedules and their supporting evidence; handle post-transaction integration obligations if any arise |
| Authority | Data room structure and access control; diligence response coordination; flagging a representation that records do not support |
| Cannot approve alone | Any transaction term; representations and warranties; valuation; disclosure of customer or employee data into a data room; letters of intent |
| Inputs | Corporate records; financial statements; security documentation; contract repository; cap table |
| Outputs | Data room; diligence response log; disclosure schedules with evidence references; transaction timeline |
| KPIs | Diligence items answered with a source document (target 100%); representations lacking supporting evidence (target 0); data room access reviewed and revoked on schedule |
| Activation trigger | A term sheet or letter of intent is received or issued in either direction, or a financing process formally begins. |
| Current coverage | Not covered. No transaction or financing process exists. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Transaction process management; diligence preparation; disclosure schedule discipline; data room access control |
| Customer/security implications | Data rooms concentrate the company's most sensitive documents behind a third-party tool. Access control and revocation there are a security matter, and customer data must never enter one without contractual authority. |

## People

**Output: build and sustain the organization.** There is one person. Everything below except organizational design and working agreements is FUTURE, and deliberately so: the purpose of writing these roles now is that the first hire arrives into a company that has already decided how it treats people, rather than one improvising under time pressure.

### Head of People (Chief People Officer)

| Field | Value |
|---|---|
| Division | People |
| Status | FUTURE |
| Reports to | Founder/CEO |
| Mission | Own how SignalGrid hires, pays, develops, and separates from people, so that the organization stays coherent as it grows. |
| Responsibilities | Own the people strategy, policies, and the employee handbook; oversee hiring, compensation, performance, and development programs; advise the founder on organizational design and manager capability; own people data governance and its access limits; handle escalated employee relations matters with counsel; keep culture explicit and enforced rather than assumed |
| Authority | People policies within legal limits; performance and development program design; hiring process standards |
| Cannot approve alone | Compensation bands and equity structure; termination decisions; headcount budget; policies with statutory implications (requires employment counsel); anything altering worker classification |
| Inputs | Hiring sequence; workforce plan; compensation benchmarks; employee feedback; legal requirements |
| Outputs | People policies and handbook; hiring process standards; performance and development programs; people data governance rules |
| KPIs | Time from role approval to signed offer; voluntary regretted attrition; percentage of managers trained before their first direct report; policy items out of statutory compliance (target 0) |
| Activation trigger | Headcount reaches ten people, or a second manager exists and people practices must be consistent between them. Before that, the founder holds this role with fractional support. |
| Current coverage | Founder/CEO. No people practices are in operation because there are no employees; the working agreements that govern the agent lanes are documented in the repository. |
| Human / fractional / AI-supported | Fractional first, human later |
| Hiring priority | - |
| Required competencies | People leadership in early-stage technical companies; policy design across jurisdictions; manager coaching; people data governance; handling sensitive matters discreetly |
| Customer/security implications | People systems hold the most sensitive personal data the company will ever process, and access decisions here determine who can reach customer environments. |

### People Operations Manager

| Field | Value |
|---|---|
| Division | People |
| Status | FUTURE |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Run the mechanics of employment correctly — records, payroll administration, benefits, and onboarding — on time and without data leakage. |
| Responsibilities | Administer the people information system and keep records accurate and access-limited; run payroll administration and reconcile it with finance; administer benefits enrollment and changes; execute onboarding and offboarding including account provisioning and revocation with security; maintain required employment records and their retention schedule; answer routine employee questions on policy and process |
| Authority | Process mechanics and calendars; system configuration within policy; access levels within people systems |
| Cannot approve alone | Compensation changes; benefits plan selection; policy exceptions; sharing people data with any third party; retention schedule changes |
| Inputs | Signed employment documents; payroll inputs; benefits elections; onboarding and offboarding triggers |
| Outputs | Accurate people records; processed payroll; completed onboarding and offboarding checklists; retention-compliant record archive |
| KPIs | Payroll runs completed accurately and on time (target 100%); access revoked within the target window of a departure (target 100%); onboarding checklist completion before day one; people records past retention (target 0) |
| Activation trigger | The first employee is onboarded — meaning payroll, benefits enrollment, and a personnel record now exist and must be maintained on a recurring cycle. |
| Current coverage | Not covered. No payroll, no benefits, no personnel records exist. |
| Human / fractional / AI-supported | Fractional or outsourced first |
| Hiring priority | - |
| Required competencies | People operations and HRIS administration; payroll and benefits administration; offboarding security coordination; records retention |
| Customer/security implications | Offboarding is a security control. Revoking repository, cloud, and customer-environment access on the day someone leaves is this role's most security-critical duty. |

### Talent Acquisition Lead

| Field | Value |
|---|---|
| Division | People |
| Status | FRACTIONAL |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Fill approved roles with people who can do the work, through a process that is consistent and evidence-based. |
| Responsibilities | Write role scorecards from the catalog entry rather than a generic template; source candidates and manage the pipeline; design structured interviews with defined evaluation criteria; run reference and background checks within legal limits; manage offer processes and candidate communication; measure process quality and fairness |
| Authority | Sourcing strategy and channels; interview process design; candidate communication and scheduling |
| Cannot approve alone | Hiring decisions; compensation offers; opening a role that is not funded and triggered; background check scope beyond legal limits |
| Inputs | Approved and triggered roles from the hiring sequence; role scorecards; compensation bands; interview panel availability |
| Outputs | Role scorecards; candidate pipeline; structured interview kits; offer packages; process quality reports |
| KPIs | Time from approved requisition to signed offer; offer acceptance rate; interview panel adherence to structured criteria; first-year retention of hires |
| Activation trigger | A role in the hiring sequence has met its activation trigger and is funded and open. Engagement is per search — a contingent or embedded recruiter — not a retained internal role until multiple concurrent searches exist. |
| Current coverage | Not covered. No role is open. When one opens, the catalog entry itself is the scorecard source, and the founder runs the search with fractional recruiting support. |
| Human / fractional / AI-supported | Fractional (per search) |
| Hiring priority | - |
| Required competencies | Technical recruiting for security and infrastructure roles; structured interview design; candidate assessment against a written scorecard; legal limits on screening |
| Customer/security implications | Hires reach customer environments and production credentials. Identity verification and reference rigor are security controls, not administrative steps. |

### Compensation and Benefits Analyst

| Field | Value |
|---|---|
| Division | People |
| Status | FUTURE |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Pay people consistently and defensibly against a documented structure. |
| Responsibilities | Build and maintain job levels, bands, and benchmark sources; run the compensation review cycle and document each decision; model equity grants and their dilution effect with finance; select and administer benefits programs; run pay-equity analysis at each cycle; keep compensation data access strictly limited |
| Authority | Benchmark source selection; leveling recommendations; analysis methodology |
| Cannot approve alone | Band values; individual compensation changes; equity pool sizing or grants; benefits plan changes; the total compensation budget |
| Inputs | Benchmark data; role levels; performance outcomes; finance's plan; jurisdiction requirements |
| Outputs | Job architecture and bands; compensation review outcomes; equity models; pay-equity analysis; benefits program |
| KPIs | Offers within band (target 100%); unexplained pay gaps at each analysis (target 0); compensation review completed on schedule; benchmark data refreshed per year |
| Activation trigger | A second person is hired into the same job family, or the first equity grant is issued — the point at which consistency between people becomes checkable. |
| Current coverage | Not covered. No compensation structure exists because no one is paid a salary. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Compensation design and benchmarking; equity mechanics; pay-equity analysis; benefits administration; confidentiality |
| Customer/security implications | Compensation data is among the most sensitive internal data the company holds; unauthorized access causes lasting internal trust damage and may carry statutory consequences. |

### Employee Relations and Workplace Compliance Partner

| Field | Value |
|---|---|
| Division | People |
| Status | FUTURE |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Handle workplace concerns and statutory obligations properly, quickly, and on the record. |
| Responsibilities | Receive and investigate workplace complaints under a documented process; maintain the reporting channels including an anonymous route; keep statutory workplace requirements met per jurisdiction (training, notices, leave administration); advise managers on performance and conduct matters; coordinate with employment counsel on escalations; maintain investigation records under restricted access |
| Authority | Investigation process and findings; interim measures within policy; requiring manager corrective action |
| Cannot approve alone | Termination decisions; settlements; policy changes with legal implications; disclosure of investigation records |
| Inputs | Complaints and reports; policy set; jurisdiction requirements; manager escalations |
| Outputs | Investigation records and findings; workplace compliance calendar; manager guidance; anonymous reporting channel |
| KPIs | Complaints acknowledged within the policy window (target 100%); investigations closed within target days; statutory training and notice requirements met (target 100%) |
| Activation trigger | The first employee is hired in a jurisdiction with statutory employment obligations, or the first formal workplace concern is raised by anyone working with the company. |
| Current coverage | Not covered. There are no employees. Conduct expectations for anyone working with the company are documented in the repository's working agreements. |
| Human / fractional / AI-supported | Fractional |
| Hiring priority | - |
| Required competencies | Workplace investigation practice; employment compliance by jurisdiction; manager coaching on conduct and performance; documentation discipline under legal privilege considerations |
| Customer/security implications | Investigation records are highly sensitive and often relevant to insider-risk assessment; their handling must be tightly access-controlled and coordinated with security without becoming surveillance. |

### Learning, Development and Performance Lead

| Field | Value |
|---|---|
| Division | People |
| Status | FUTURE |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Make sure people know what good performance is here, get told the truth about theirs, and can grow into the next role. |
| Responsibilities | Design the performance review cycle and its calibration process; build role-based development paths tied to the catalog's competencies; run manager training before anyone gets a direct report; own required training including security and privacy awareness with completion tracking; run onboarding-to-productivity ramps per function; measure whether development actually changes capability |
| Authority | Review cycle mechanics and calibration process; training content and cadence; development path structure |
| Cannot approve alone | Performance ratings; promotion decisions; compensation outcomes; performance-based termination |
| Inputs | Role competencies from this catalog; manager feedback; security and compliance training requirements; skills gaps from workforce planning |
| Outputs | Performance cycle and calibration records; development paths; manager training program; training completion records |
| KPIs | Review cycles completed on schedule (target 100%); required security training completion (target 100%); managers trained before first direct report (target 100%); internal fill rate for opened roles |
| Activation trigger | A manager has two or more direct reports, or a review cycle is due for anyone who has been with the company long enough that informal feedback is no longer sufficient. |
| Current coverage | Not covered. The founder has no reports. Required security awareness training becomes mandatory the moment there is anyone to train. |
| Human / fractional / AI-supported | Fractional first |
| Hiring priority | - |
| Required competencies | Performance system design; calibration facilitation; manager development; security awareness program administration; measuring capability change rather than attendance |
| Customer/security implications | Security awareness training completion is routinely audited by enterprise buyers and is a control most frameworks require. It becomes a customer-visible obligation with the first employee. |

### Workforce Planning and Organizational Design Partner

| Field | Value |
|---|---|
| Division | People |
| Status | COVERED |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Keep the gap between the designed organization and the current one deliberate, visible, and correctly sequenced. |
| Responsibilities | Maintain this role catalog and the activation matrix so every role has a status, a trigger, and honest current coverage; keep the hiring sequence ordered by risk and workload rather than by title; review each activation trigger for whether it has actually been met; maintain the responsibility and decision-rights matrix as roles activate; identify capability gaps that no role currently covers; keep the boundary between agent-covered and human-required work explicit |
| Authority | Catalog and matrix structure; trigger wording; declaring a trigger met or not met |
| Cannot approve alone | Opening a role; hiring sequence order (owner decision); budget; changing a role's status without evidence the trigger condition changed |
| Inputs | Workload signals; product and customer milestones; agent roster coverage; owner decisions |
| Outputs | Role catalog; role activation matrix; hiring sequence; responsibility and decision-rights matrix; capability gap list |
| KPIs | Roles carrying a concrete, testable activation trigger (target 100%); roles whose stated coverage matches reality at each review (target 100%); triggers reviewed per quarter |
| Activation trigger | Active now. |
| Current coverage | Founder/CEO, with agent lanes drafting and maintaining the documents. The agent roster is the record of what the lanes actually do; this catalog is the company design above it, and each role states honestly whether a lane covers it today. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Organizational design; workload-to-role analysis; writing testable trigger conditions; resisting the impulse to hire an org chart |
| Customer/security implications | Buyers ask who is accountable for security and support. An honest map of what is covered by whom — including what is agent-covered — is a more defensible answer than an org chart implying staff who do not exist. |

### Culture, Onboarding and Working Agreements Steward

| Field | Value |
|---|---|
| Division | People |
| Status | ACTIVE |
| Reports to | Head of People (Founder/CEO until that role activates) |
| Mission | Keep the company's operating norms written down, current, and actually followed by everyone and everything working in the repository. |
| Responsibilities | Maintain the working agreements that govern how work enters, is reviewed, and is reported — including the lane coordination protocol and the rule that a failing gate is reported as failing; keep onboarding material sufficient for a new participant to be productive without a person available to ask; document the escalation path and what requires owner approval; review whether norms are being followed and name it when they are not; keep the norms consistent between human and agent participants; retire agreements that no longer describe reality |
| Authority | Working agreement content and structure; onboarding material; declaring a norm violated |
| Cannot approve alone | Norms that carry legal or employment consequences; approval boundaries and escalation thresholds (owner-set); changes to what agents may do without AI/Agent Operations |
| Inputs | Observed practice; lane coordination records; incident and review outcomes; owner decisions |
| Outputs | Working agreements; onboarding documentation; escalation path; norm adherence observations |
| KPIs | Onboarding material sufficient for a new participant to complete first productive work without live assistance; documented norms contradicted by observed practice (target 0); working agreements reviewed per quarter |
| Activation trigger | Active now. |
| Current coverage | Founder/CEO, with the repository's contributor guidance, lane coordination protocol, and review-coverage records serving as the written norms. They govern the agent lanes today and are written to apply unchanged to the first human hire. |
| Human / fractional / AI-supported | Human, AI-supported |
| Hiring priority | - |
| Required competencies | Writing operating norms people actually read; onboarding design; observing practice against stated norms; keeping documentation honest when it stops matching reality |
| Customer/security implications | The norm that a failing gate is reported as failing is the cultural root of the product's truthfulness. Culture that tolerates a rounded-up status report produces a product that rounds up a trust decision. |
