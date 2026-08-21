# Responsibility and DRI matrix

**Ratified by the founder, August 21, 2026.**

A DRI is the *directly responsible individual*: the one role accountable for a
class of decision. One role, not a committee. If a decision in this matrix goes
wrong, the DRI row is where you look first.

[ROLE_CATALOG.md](ROLE_CATALOG.md) says what every role is for.
[ORG_STRUCTURE.md](ORG_STRUCTURE.md) says how the roles group. This document
binds both to the decisions the company actually makes — the recurring work
classes SignalGrid faces today as a one-person company with agent lanes, and
the ones it will face at first-pilot stage. It answers a narrower question than
either: *this thing needs deciding right now — who decides, who must be asked,
and who can stop it?*

## How to read a row

- **DRI role** is a role from the catalog, not a person. Role ≠ employee. Most
  DRI roles today resolve to the founder, an agent lane, or both.
- **Consulted** means input is required before the decision, not that the
  consulted party can veto it. Skipping consultation is a process defect even
  when the outcome is right.
- **Must approve** is a veto gate. The DRI cannot execute the decision alone.
  Two kinds of approver appear:
  - **Mechanical** — a gate, proof, or check. It approves by passing. It cannot
    be persuaded, and nothing in this repository waives one.
  - **Human** — today, in every case, the founder.
- **Today that means** maps the row onto the real company: one human (Dan
  Fashauer), the AI agent lanes registered in `docs/agent/org-roster.json`, and
  fractional professionals — of which **none is engaged**.

Accountability does not delegate to an agent lane. A lane produces work; the
founder or a named role remains accountable for it. Where a row names a lane as
the DRI's execution path, the lane is the *how*, never the *who*.

The **Must approve** column takes its owner-only entries from the standing
never-list in `docs/VIRTUAL_TEAM.md`: anything reaching a person outside the
company, anything that binds legally or in compliance, anything irreversible,
anything needing credentials the team does not hold, and any genuine matter of
taste, appetite, or strategy. Those five categories are the founder's alone and
are marked **Founder alone** below.

---

## Building the product

| Decision class | DRI role | Consulted | Must approve (DRI cannot act alone) | Today that means |
| --- | --- | --- | --- | --- |
| **Product scope change** — what the product will and will not do; adding, cutting, or resizing a surface | Chief Product Officer / VP Product | Head of Product; Principal Engineer; Release governance lead; the affected domain SME | **Founder alone**, recorded as a decision record with its reversal condition | Dan Fashauer decides directly. The product-manager and principal-engineer lanes prepare options and draft the record; DR-005 (2026-08-20) is the most recent exercise. No lane widens scope on its own. |
| **Decision-core behavior change** — allow / step_up / restrict / deny logic, thresholds, fail-closed posture | Decision Core Engineer | Principal Engineer; Quality/test/performance engineer; Security architect; Decision Platform PM | **Mechanical**: `review:invariants`, the `proof:*` suite, and preflight, all green. **Founder** for any change to fail-closed posture | The principal-engineer, api-contract-architect, and data-persistence-engineer lanes propose and land; the gates are the approver that cannot be argued with. Golden rule 1 forbids changing the ported Swift engines for behavior — new logic goes around them. |
| **Deferred connector family activation** — moving a signal family out of deferred status | Integrations PM | The six signal-domain lanes; security engineer (connector trust tier); Release governance lead | **Founder alone**, by decision record plus a `LAUNCH_PROFILE_VERSION` bump; the launch-profile gate then enforces it | DR-001 defers five families and states the reversal condition: the launch wedge shipping, not appetite. Lanes recommend; only the founder lifts the freeze. |
| **Release: merge to main** | Change management & merge governance lead | QA engineer; product security engineer; DevEx/release engineer | **Mechanical**: the merge policy, per-push CI, preflight, the pre-push lockfile hook, and the independent automated review bot. No human waiver exists | Fully mechanical and deliberately not a founder bottleneck — merging work that is green is on the do-not-escalate list. Held by the principal-engineer, security-engineer, and devex-tooling-engineer lanes; no human release engineer exists. |
| **Launch-surface classification** — adding or reclassifying anything in the launch profile | Release governance lead | Chief Product Officer; compliance analyst; Public Claims Steward | **Founder alone** for the classification; **mechanical** enforcement by the launch-profile gate, which fails on silent omission | Scope is frozen by DR-005. The release-engineer and launch-manager lanes are declared and have never been activated, so the gate plus the founder are the whole control today. |
| **Brand, design-system, and accessibility ratification** — tokens, palette, decision colors, Dynamic Type | Head of Design / Brand and Design Lead | Mobile-native and web engineers; Accessibility Specialist; Content Designer | **Founder alone** for palette and taste; **mechanical** for the rest — WCAG AA (4.5:1) on `allow`/`review`/`deny` against both surfaces in both appearances, and the design-system rules in `CLAUDE.md` | The brand-design lane executes; its recorded output is the DR-005 deny re-tone applied across `index.css` and `DesignSystem.swift` in one commit. 18 raw font calls remain outside `DesignSystem.swift` as of 2026-08-21 — a known, tracked gap, not a passing state. |
| **Cross-lane shared-surface change** — gates, guard registries, sync manifest, proof registration | Business operations & program management lead | The other lane, through `lane:inbox` / `lane:send`; Principal Engineer | **Mechanical + protocol**: `docs/LANE_COORDINATION.md` must be followed before the surface is touched; the sync manifest is generated, never hand-edited | The program-manager and mac-lane-steward lanes hold this. `check-lane-messages` and `check-sim-requests` report owed work on every run and never pass silently. The founder is not a message bus and is not asked to relay. |
| **AI-agent permission widening** — a lane gains a credential, a surface, or an action it did not have | AI risk & governance officer | AI/Agent operations lead; product security engineer; Internal security & identity administrator | **Founder alone.** No lane grants authority to itself or to another lane | The founder issues every credential personally and holds every owner-only account. Lane authority is bounded by the roster's activation gating, the review-coverage ledger, and the never-list: no live credentials, no customer data, no outreach, no autonomous remediation. The arrangement is partly self-referential, and the founder's approval is the only external check today. |

## Keeping claims true

| Decision class | DRI role | Consulted | Must approve (DRI cannot act alone) | Today that means |
| --- | --- | --- | --- | --- |
| **Security counterexample found** — a proof, invariant, or trust claim is defeated | Product Security Engineer (embedded) | Principal Engineer; QA engineer; Independent trust assurance engineer | **Nobody.** A counterexample is recorded, not approved. The *fix* follows the decision-core row; *saying anything about it outside the company* is **Founder alone** | The security-engineer and threat-modeler lanes find them; cross-lane adversarial review confirms or refutes each one before anything is acted on, and a refuted finding is recorded as refuted rather than dropped. A failing gate is reported failing. The disclosure path in `SECURITY.md` reaches the founder. |
| **Incident on a lab or internal system** — CI estate, lab connector instance, Mac lane, the repository | Service management lead | SRE lane; DevEx engineer; product security engineer if any credential or exposure is involved | **Nobody** for acting on a system the company owns. **Founder alone** for any security incident of any severity, and for anything that reaches a person outside the company | No incident register exists — this is the honest state, not a simplification. Causes are written into `CLAUDE.md` and decision records; scheduled verification opens a regression issue. There is no operated production service, so there is no on-call and no customer-visible incident is possible today. |
| **Compliance claim or control mapping** — a questionnaire answer, control matrix row, or regulated-vertical statement | Compliance engineering lead | Security architect; commercial-counsel lane; Regulatory intelligence lead | **Founder alone signs.** The compliance-analyst lane explicitly cannot sign off | No auditor, assessor, certification body, or compliance counsel is engaged, and the company holds no certification, attestation, or audit report. Claude Code does not guarantee HIPAA or SOC 2 outcomes; qualified human compliance review is required before any external party relies on this material and has not been performed. Lane output is research, not advice. The founder is not a compliance professional — the largest stated gap in this matrix. |
| **Customer or tenant data handling** — any decision that would place data belonging to another party in the company's hands | Chief Risk & Compliance Officer | Privacy Officer (FUTURE); Platform/cloud/identity security engineer; Database reliability engineer | **Founder alone**, in writing | No such data exists. The decision core is deterministic and fixture-backed, and no deployment holds anyone else's records. The first one that does fires four FUTURE triggers at once: business continuity, privacy officer, security operations, and third-party/vendor risk. Treat this row as a precondition list, not a procedure. |
| **Third-party licence intake** — external code, data, fonts, fixtures, or images entering the repository | Open-Source Licensing and IP Steward | Records archivist lane; product security engineer for supply-chain shape | **Mechanical**: `scripts/publication-boundary.mjs` fails the build when material of external origin has no stated licence basis. **Founder** for anything ambiguous | ACTIVE and already enforcing. The intake survey record has rejected collections carrying no licence and has held an unread custom licence unused rather than assuming it. |
| **Publication of public content** — a site page, article, README claim, or any published figure | Public Claims Steward | proof-led-content and docs-writer lanes; positioning-messaging lane; Technical Marketing Engineer | **Founder alone** approves every outbound claim, and **three mechanical gates** that can only subtract: the claims registry (`docs/agent/FALSE_CLAIMS.json`), the publication-boundary check, and the docs-to-proof figure guard | Agent lanes draft; gates and the founder decide. A published number must match a real run — `guard:figures` fails the build on drift between documentation and measurement. Before writing that something does not exist, `pnpm run check:absence` must corroborate it. |

## Money, commitments, and outside parties

Every row in this section is **Founder alone**. That is not a formality: these
are signatures, sends, and matters of appetite, and no gate and no lane can
substitute for any of them.

| Decision class | DRI role | Consulted | Must approve (DRI cannot act alone) | Today that means |
| --- | --- | --- | --- | --- |
| **Spending money** — any recurring or one-off cost | Chief Executive Officer (founder) | Cost modeling and agent-operations economics duty, for structure only | **Founder alone** | The founder holds all spend authority and the four owner-only billing figures: model spend, developer-program fee, source-control plan, and domain spend. No cost or dollar figure appears in this repository, and no lane estimates one — the figures stay explicit unknowns. |
| **Pricing and packaging** | Commercial lead — pricing, packaging, and contract desk | pricing-packaging-analyst, competitive-analyst, and agent-ops-economics lanes | **Founder alone.** Pricing posture is named on the never-list as a matter of taste and strategy | Lanes maintain model *structure* and scenarios. No list price is published and no discount governance exists, because no deal exists. |
| **Engaging a fractional professional** — CFO, counsel, tax, recruiter, penetration tester, assessor | Chief Executive Officer (founder) | The engaging division's lead duty; commercial-counsel lane for engagement terms | **Founder alone** — an engagement is a signature | Seven catalog roles are marked FRACTIONAL and **none is engaged**: CFO, tax and statutory filings, general counsel, commercial counsel, talent acquisition, offensive security testing, and external audit/assessment/advisory. Each carries its own written trigger; none has fired. |
| **Signing anything** — customer agreement, order form, DPA, engagement letter, offer letter, non-standard NDA | General Counsel / Chief Legal Officer (FRACTIONAL, not engaged) | commercial-counsel lane for drafting, issue-spotting, and obligation extraction | **Founder alone signs** | The commercial-counsel lane drafts and flags; it is explicitly not a source of legal advice. The first agreement beyond a mutual NDA presented for signature is itself the trigger to engage fractional counsel — the signature and the engagement land together. |
| **External contact** — design-partner outreach, partner reply, prospect conversation, press or analyst inquiry | Chief Executive Officer (founder), exercising the CRO and VP Alliances duties | design-partner-outreach, icp-customer-research, positioning-messaging, and partner-alliances-analyst lanes — desk analysis only, no external contact | **Founder alone.** The team drafts; the owner sends | No customer, pilot, design-partner, advisory, OEM, reseller, or channel relationship exists, and no lane may open one. Every partnership row in the catalog reads that no relationship exists today; partner documents catalog candidate categories only. |

## The company itself

| Decision class | DRI role | Consulted | Must approve (DRI cannot act alone) | Today that means |
| --- | --- | --- | --- | --- |
| **Hiring: opening a role** | Chief Executive Officer (founder), exercising the Head of People duty | The hiring division's lead duty; Workforce planning partner; Talent Acquisition Lead (FRACTIONAL, per search) | **Founder alone** — funding and the offer are both signatures. The role's own activation trigger must have fired first; a trigger is a precondition, not an approval | No role is open. There are no employees and no recurring contractors, so no offer letter, payroll, benefits, or personnel record exists. The catalog's hiring sequence is an ordering for when triggers fire, not a plan to hire now. |
| **Org-chart or role-catalog change** — adding a role, changing a trigger, changing a status or coverage line | Workforce Planning and Organizational Design Partner | Division lead duties; records-archivist lane; program-manager lane | **Founder alone** — this is company design | The founder holds it; agent lanes draft and maintain the documents. `docs/agent/org-roster.json` (41 duties) records what the lanes actually do; this catalog is the company design above it. Moving a role from FUTURE to COVERED is a claim about reality and is checked like any other claim. |
| **Strategy and positioning** — what company to become, what posture to take, what to call the product | Corporate strategy lead | competitive-analyst, positioning-messaging, and pricing-packaging-analyst lanes | **Founder alone.** A lane may recommend and must say plainly that it is recommending | The founder holds this directly. The positioning lane records multiple incompatible product labels still in circulation; the launch-claims gate is the mechanical containment, not the decision. |
| **Owner-only records and access** — billing figures, credentials, owner accounts, repository settings, the Mac | Chief Executive Officer (founder) | Chief of Staff duty; Internal IT and business systems administrator duty | **Founder alone** — capability, not policy: no lane holds the credentials | One human identity. No directory, no SSO, no access review cycle, no fleet, no help desk. A second identity in any company system activates the internal security and identity administrator role. |

---

## What changes a row

A row changes for exactly two reasons, and both are written down:

1. **A role's activation trigger fires.** The DRI or approver moves from the
   founder to a named person, and the catalog entry is the record.
2. **A gate is added or removed.** Mechanical approvers change by commit, and
   the change goes through the release row above like any other.

Nothing in this matrix changes because a decision was inconvenient to route.

## Where this matrix is weakest

Stating this is part of the design, not a caveat added to it:

- **One approver.** The founder is the sole human approver on 12 of the 23
  classes here. That is correct for a one-person company and is also single-point
  concentration with no succession or access-recovery plan. Business continuity
  is a FUTURE role and its trigger has not fired.
- **Compliance review is unsigned.** The founder approves compliance-shaped
  output and is not a compliance professional. No external assessor exists to
  check it.
- **AI governance is partly self-referential.** The lanes that build the company
  also document the governance of the lanes. The founder's approval and the
  mechanical gates are the only checks outside that loop.
- **Assurance is not independent.** The gate estate tests controls continuously
  but was built by the same lanes it tests. Cross-lane adversarial review
  supplies judgment; it is not independence.
- **Two DRI roles have no register.** Incidents and company-level indicators are
  practiced without a register, so nothing counts open corrective actions.

Each of these has a role in the catalog with a trigger attached. None is
resolved by writing this document.
