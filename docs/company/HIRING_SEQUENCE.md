# SignalGrid — hiring sequence

Ratified by the founder, August 21, 2026.

This document is the company-level order in which SignalGrid hires people. It is
not a plan to hire ten people. It is the order the roles unlock in, so that when
a trigger fires there is no argument about what comes next.

Today the company is one person: Dan Fashauer, founder and CEO. There are no
employees, no contractors on recurring terms, and no fractional professionals
engaged. Position 1 below is filled. Positions 2 through 10 are unfilled, and no
offer, budget, compensation structure, or start date exists for any of them.
[ROLE_ACTIVATION_MATRIX.md](ROLE_ACTIVATION_MATRIX.md) states what covers each
responsibility in the meantime — the founder, a named AI agent lane, a gate in
this repository, or nothing.

## The rule every hire obeys

A hire is justified by one of three things, and the trigger has to be observable
from outside the founder's head:

- **Workload** — a queue that a reviewed agent lane plus the founder can no
  longer clear, measured over a stated window rather than felt in a bad week.
- **Customer requirement** — something an outside party requires in writing
  before it will proceed: a named contact, a response commitment, a report, a
  review the founder cannot answer from the existing evidence estate.
- **Risk** — a decision that is irreversible, or reaches a person, a fleet, or
  data outside this repository with no second competent human able to review it.

"We are busy" is not a trigger. "We should probably have someone for that" is
not a trigger. A role whose trigger has not fired is correctly unfilled, and the
matrix says so on the record.

## The sequence

| # | Hire | Primarily replaces | Trigger type |
| --- | --- | --- | --- |
| 1 | Founder/CEO, and domain and product lead | — (filled) | — |
| 2 | Founding principal engineer / technical architect | Founder review of irreversible technical decisions | Risk |
| 3 | Product designer (enterprise workflow) | brand-design and web-engineer lanes, founder review | Workload, then customer requirement |
| 4 | Product security and backend engineer | principal-engineer, data-persistence-engineer, security-engineer lanes | Risk, then workload |
| 5 | Integration engineer | The six signal-domain lanes | Customer requirement |
| 6 | Full-stack / operator-console engineer | web-engineer lane, ad hoc native work | Workload |
| 7 | Platform / SRE engineer | sre, release-engineer, devex-tooling-engineer lanes | Customer requirement |
| 8 | Solutions architect / sales engineer | Founder, solutions-architect lane | Workload against founder execution time |
| 9 | Customer implementation and success engineer | Founder running the first deployment personally | Customer requirement |
| 10 | Product marketing / technical content | positioning-messaging, proof-led-content, docs-writer lanes | Customer requirement (proof of a real buyer) |

The per-role hiring priority numbers in the role catalog are priorities *within a
division*. This table is the company-level order across all divisions, and it
wins where the two are read together.

---

## 1. Founder/CEO, and domain and product lead — filled

**Held by:** Dan Fashauer.

**What the role holds today:** direction and final ratification for everything —
product scope, engineering sequencing, security accountability, every outbound
claim, every financial and legal decision, and the endpoint and device-management
domain expertise the product is built on. Software execution is AI-covered
through the 41-duty agent roster, which the founder ratifies rather than writes.

**What it does not hold:** independence. The founder is the sole approver on most
decision classes in
[RESPONSIBILITY_AND_DRI_MATRIX.md](RESPONSIBILITY_AND_DRI_MATRIX.md), reviews
compliance-shaped output without being a compliance professional, and has no
succession or access-recovery plan. That concentration is the reason position 2
is a technical peer rather than a manager.

---

## 2. Founding principal engineer / technical architect

**Takes over:** architecture ownership of the decision core, the `/v1` contract,
and the persistence layer — currently AI-covered via the principal-engineer,
api-contract-architect, and data-persistence-engineer lanes, with the founder as
the only human reviewer of every decision record. After this hire, the founder
stops being the last technical reader of an irreversible change.

**Trigger — risk.** The first of:

- A decision that is irreversible in tenant data or in a customer device fleet
  reaches the founder with no technical peer able to review it.
- A deployment is operated by anyone outside this repository.
- The founder commits the hire in writing.

**Stays where it is:** product scope and ranking authority stay with the founder.
This is a peer for technical judgment, not a VP of Engineering — see *What does
not get hired early*.

---

## 3. Product designer (enterprise workflow)

**Takes over:** the operator console and administrative surfaces as usable
workflow, not as screens that pass review. Design is AI-covered today via the
brand-design lane (activated 2026-08-20) and the web-engineer lane, with the
founder reviewing. Those lanes maintain a real design system and have shipped
accessibility work, and no human designer has ever worked on the product.

This hire is deliberately specified as **enterprise workflow design, not consumer
aesthetics**. The work is dense administrative state, permission and grant
sequencing, decision explanation, and error and denial paths under time pressure
on a shared device. A portfolio of marketing sites is the wrong evidence.

**Trigger — workload, then customer requirement.** The first of:

- A console surface is used by a non-founder operator in their own work rather
  than in a demo.
- A second designer — human or a second dedicated agent lane — contributes to
  the same surface, at which point review stops holding drift.
- A procurement process requires an accessibility conformance report, or a
  surface ships that automated checks cannot evaluate.

**Stays where it is:** brand and visual standards stay with the brand-design lane
under founder approval. Design operations does not activate with this hire; one
designer needs no design operations.

---

## 4. Product security and backend engineer

**Takes over:** the decision core, platform services, and the auth and trust
seams as one job. The catalog carries these as two roles — Decision Core
Engineer and Product Security Engineer (embedded) — at the same priority, and
the first hire is one person who holds both. Today the work is AI-covered via
the principal-engineer, data-persistence-engineer, api-contract-architect, and
security-engineer lanes; the threat-modeler lane is declared and not yet
activated.

**Trigger — risk, then workload.** The first of:

- The product processes a real tenant's data outside the founder's direct
  control.
- An external security questionnaire is answered for the first time.
- Decision-core and API queue depth exceeds what one reviewed lane lands in a
  week, for two consecutive weeks.

**Stays where it is:** penetration testing and external assessment do not move
here. They are fractional by design and stay fractional — an engineer who builds
the surface is not independent of it.

---

## 5. Integration engineer

**Takes over:** connector families and device evidence — the endpoint and UEM,
identity, network, security-operations, physical and OT, and ITSM domains that
are AI-covered today by six signal-domain lanes. Those lanes have driven real
lab instances and record their unverified dimensions honestly; the
firmware-hardware-engineer lane is declared and never activated, so the firmware
and edge variant is uncovered.

**Trigger — customer requirement.** The first of:

- A deployment where a customer's own system must be connected by someone other
  than the founder.
- A fourth launch-scope connector family is ratified by decision record.
- A scoped environment requires a platform no lab instance can reproduce — a
  commercial EDR or SIEM, a NAC platform with no free tier, or an identity
  assertion no self-hostable IdP produces.

**Stays where it is:** which families are in launch scope stays a founder
decision recorded in a decision record. An integration engineer connects what has
been ratified; the engineer does not widen the launch profile.

---

## 6. Full-stack / operator-console engineer

**Takes over:** day-to-day feature work across the operator console and the
native shells. AI-covered today via the web-engineer lane (activated 2026-08-19),
with the mobile-native-engineer, desktop-engineer, and accessibility-specialist
lanes declared and not yet activated — native and desktop work is assigned ad
hoc, which the matrix records as a gap.

**Trigger — workload.** The first of:

- An operator console is used daily by someone outside the company.
- Two client platforms need feature work in the same week, for two consecutive
  weeks.

**Stays where it is:** design authority stays with position 3 and the brand-design
lane. This hire implements against the design system rather than extending it.

---

## 7. Platform / SRE engineer

**Takes over:** operating something. Today there is no operated production
service, so this is an engineering responsibility rather than an operations job:
the sre, release-engineer, and devex-tooling-engineer lanes cover CI estate
health, `lib/reliability` computes service-level indicators deterministically,
and `proof:backup-restore` destroys the schema, restores it, and re-verifies the
hash chain on every pull request.

**Trigger — customer requirement.** The first of:

- SignalGrid operates a deployment that someone outside the company depends on
  and that carries an on-call expectation.
- More than one long-lived environment exists that a gate cannot recreate from
  the repository.
- A database holds records the company cannot regenerate from fixtures.

**Stays where it is:** on-call is not created before there is a service to be
called about. Incident management roles are operating assignments made during an
incident — incident commander, operations lead, communications, planning — not a
title that gets hired.

---

## 8. Solutions architect / sales engineer

**Takes over:** buyer-facing technical evaluation and first-deployment reference
architecture. The founder answers evaluation questions today; the
solutions-architect lane is registered and its next action is turning the pilot
scope skeleton into a reference architecture naming which grants a customer's IT
team must issue and in what order.

**Trigger — workload measured against founder execution time.** The first of:

- A first pilot is signed and a second prospect environment is in scoping
  concurrently.
- One prospect's technical review generates architecture questions the founder
  cannot close within five working days without stopping execution work.

**Stays where it is:** commercial ownership. This is the first customer-facing
hire and it is a technical one — the founder still runs the sale.

---

## 9. Customer implementation and success engineer

**Takes over:** making the first deployments work and keeping them working. The
founder runs the first pilot personally by design; this hire exists for the ones
after it.

**Trigger — customer requirement.** The first of:

- A second deployment is scoped while the first is still being stood up.
- The first paying deployment has been in daily operational use for 30 days.
- A signed agreement requires a named technical contact or a stated response
  time.

**Stays where it is:** support tooling, severity taxonomies, and published
response commitments do not arrive with this hire. No ticketing system, severity
taxonomy, or response-time commitment exists today, and each has its own trigger
in the catalog.

---

## 10. Product marketing / technical content

**Takes over:** segment messaging, evaluator-facing material, and the reproducible
technical content that lets someone else run the proofs on their own hardware.
AI-covered today via the positioning-messaging, proof-led-content, and docs-writer
lanes, with the docs-to-proof figure guard failing the build when a published
number drifts from a real run, and the founder approving every outbound claim.

**Trigger — customer requirement, specifically proof of a real buyer.** A named
organization has run SignalGrid against its own devices and has agreed in writing
that the result may be described publicly. Interest in a buyer is not the
trigger; evidence of one is.

**Stays where it is:** the founder remains the public claims steward. The claims
registry, the publication-boundary check, and the figure guard keep deciding what
may be published, regardless of who drafts it.

---

## What stays fractional

These are outside professional engagements, engaged for a need and released after
it. None is engaged today, and none becomes an employee at any position in the
sequence above.

| Function | Engaged when |
| --- | --- |
| Commercial and general counsel | The first agreement beyond a mutual non-disclosure agreement is presented for signature — an order form, a master services agreement, a data processing agreement — or an employment offer, financing process, or regulatory contact occurs. |
| Bookkeeping and accounting | Recurring third-party invoices plus payroll exist and monthly close stops being reliable. A bookkeeper is engaged before a controller is hired. |
| Payroll administration | The first non-founder person is paid — employee or contractor on recurring terms. |
| Tax and statutory filings | The first fiscal year with reportable activity, or the first sale into a jurisdiction with a sales-tax or VAT registration threshold. |
| Privacy and data protection advice | Personal data belonging to another organization is processed outside fixtures and simulation, or a counterparty requires a data processing agreement. |
| Penetration testing and red team | A named tester or firm is engaged under a signed scope and rules-of-engagement document, itself triggered by the first deployment handling real customer data. No penetration test, red-team exercise, or external security assessment has been performed. |
| External audit, assessment, and compliance counsel | A customer contract requires an audit report or attestation. SignalGrid holds no certification, attestation, or audit report, and Claude Code does not guarantee HIPAA or SOC 2 outcomes — qualified human compliance review is required before external reliance and has not been performed. |
| Fractional CFO | External capital is raised, recurring revenue requires formal reporting, or a counterparty asks for financial statements. |
| Recruiting support | A role above has met its trigger and is funded and open. Engagement is per search, not retained. |

The pattern is the same in every row: buy judgment that has to be independent, or
that is needed a few times a year, and do not put it on payroll to have it
nearby.

## What does not get hired early

**Executives.** No COO, VP Engineering, CRO, CMO, VP Customer Success, or VP
Services appears in the sequence. Their triggers are all headcount-shaped —
paid humans working at the same time reach three; a product group reaches four
people; two account executives are in seat; five paying accounts exist — and none
of those conditions can be reached by hiring the executive first. Hiring a
manager before there is work to manage creates coordination overhead and calls it
progress.

**Sales.** Founder-led sales stays founder-led far longer than engineering stays
founder-only, and that asymmetry is deliberate. Engineering leaves founder-only
at position 2 because the risk is technical and irreversible. Selling stays with
the founder through position 8 — which is a *sales engineer*, technical support
for a sale the founder still runs — and no account executive, pipeline
development representative, or revenue operations role appears in the sequence at
all. Their triggers require paid deployments and inbound volume that do not
exist. A salesperson hired before the founder can reliably close cannot be
evaluated: nobody knows whether a loss was the seller or the story.

**Everything with a customer-shaped trigger and no customers.** Customer success
management, renewals, support engineering, training and certification, analyst
relations, demand generation, marketing operations, alliance and channel roles,
and a data or analytics function are all designed in the catalog and all
correctly unfilled. No customer, pilot, design-partner, partner, OEM, reseller,
investor, advisor, or analyst relationship exists today.

**People and finance infrastructure.** People operations, compensation, employee
relations, learning and development, and accounts payable and receivable activate
off the first employee, not before. The first hire creates them; anticipating
them does not.

## What would reorder this list

The sequence is ratified, not frozen. Three things reorder it, and each is
recorded as a decision record when it happens:

1. **A customer requirement arrives out of order.** A signed scope that names a
   deployment SignalGrid does not operate can pull positions 5, 7, or 9 forward
   ahead of 3 or 4.
2. **A gate stops holding.** If a responsibility currently held by a mechanical
   gate starts failing in ways review cannot catch, the role that owns it moves
   up regardless of position.
3. **The founder commits a hire in writing.** The owner may pull any position
   forward. The commitment is the trigger, and it goes in the decision record
   with the reasoning, so the exception stays visible instead of becoming the new
   rule.

Nothing reorders this list because a candidate became available.

## The three separations

Everything above rests on three distinctions, and losing any one of them turns
this document into a headcount plan it is not:

- **Role ≠ employee.** A role in the catalog is a defined body of work with an
  owner and a trigger. Nine of the ten positions here have no person attached and
  most of them should stay that way for a long time.
- **Capability ≠ headcount.** SignalGrid performs work across every division
  today through the founder, AI agent lanes under his ratification, and gates
  that fail the build. Capability existing is not evidence that a person is
  needed; it is often evidence that one is not, yet.
- **Future organization ≠ current payroll.** The organization design is written
  now so that hiring is a decision against a trigger rather than an improvisation
  under pressure. Current payroll is one person. No row in this document changes
  that, and none commits the company to changing it.
