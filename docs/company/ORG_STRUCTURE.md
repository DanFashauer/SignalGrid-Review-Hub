# SignalGrid — the eventual organization

Ratified by the founder, August 21, 2026. This is the 100% company — every
division SignalGrid will eventually need — designed now, hired never-before-
its-trigger. Three separations govern everything in this directory:

- **Role ≠ employee.**
- **Capability ≠ headcount.**
- **Future organization ≠ current payroll.**

The model follows how mature software companies organize (Fleet separates
Engineering, Product Design, IT, Customer Success, Sales, Marketing, Finance,
and People; GitLab structures executive functions across Product, Engineering,
Security, Revenue, Marketing, Legal, Finance, and People and describes each
function by its output). SignalGrid adopts the same discipline at design time,
while the actual early organization stays extremely lean: today the company is
one human — the founder — plus AI agent lanes and, when engaged, fractional
professionals.

## The divisions

| Division | Leadership | Measurable output |
| --- | --- | --- |
| Executive & corporate governance | Founder/CEO; eventual President/COO | Direction and accountability |
| Product | CPO / VP Product | Choose the right product |
| Product design & research | VP/Head of Design | Make the product understandable and usable |
| Engineering | CTO / VP Engineering | Build the product correctly |
| Security, trust & assurance | CISO | Make trust claims defensible |
| Privacy, compliance & risk | Chief Risk/Compliance Officer (initially CISO/CLO) | Keep promises provable to assessors |
| Platform, SRE & internal IT | VP Platform / Head of Infrastructure | Keep the product operable |
| AI, automation & data | Head of AI/Automation | Scale human execution without losing accountability |
| Domain & solutions engineering | VP Solutions / Chief Solutions Architect | Make it work in the customer's environment |
| Industry solutions | Head of Industry Solutions | Fit the product to regulated verticals |
| Sales & revenue | CRO | Convert qualified demand to revenue |
| Partnerships & ecosystem | VP Alliances / Business Development | Expand distribution and evidence ecosystems |
| Customer success | VP Customer Success | Create measurable customer outcomes |
| Implementation, support & services | VP Services (initially CS leader) | Working deployments and answered customers |
| Marketing | CMO / VP Marketing | Create qualified market attention |
| Developer relations & community | Head of DevRel (within Marketing/Product) | Developers who build on and vouch for the product |
| Brand, communications & analyst relations | VP Communications or Marketing | A truthful public voice |
| Finance | CFO | Preserve economic truth |
| Legal & corporate affairs | General Counsel / CLO | Preserve corporate and contractual truth |
| People | Chief People Officer / Head of People | Build and sustain the organization |
| Quality & operational governance | COO/CTO depending on stage | Processes that fail loudly and improve |

The full role inventory per division — with mission, authority, activation
trigger, and honest current coverage for every role — is
[ROLE_CATALOG.md](ROLE_CATALOG.md). The gap between this design and today's
payroll is [ROLE_ACTIVATION_MATRIX.md](ROLE_ACTIVATION_MATRIX.md).

## Product development: cross-functional groups, not departmental handoffs

SignalGrid does not ship through Product → Engineering → QA → Security →
Operations handoffs. Once there are enough people, work happens in **stable
product groups** (the Fleet/GitLab pattern: a product group holds product,
design, engineering, QA, and security counterparts to reduce handoffs):

| Product group | Composition |
| --- | --- |
| Decision Core | Product + Design + Backend + QA + Product Security |
| Device Evidence & Connectors | Product + Integration Engineering + Endpoint SME + QA + Security |
| Operator Experience | Product + Design + Frontend + Accessibility + QA |
| Platform & Trust | Platform + SRE + Security + Persistence + Assurance |

Security participates **in** the groups rather than appearing at the end —
NIST's Secure Software Development Framework recommends integrating security
roles into development teams, and SignalGrid's output *is* a trust decision,
which makes that non-optional here.

## Security has two layers

1. **Product-group security** — the embedded engineer who helps the group
   build safely, inside the loop.
2. **Independent company security/assurance** — the CISO side, outside the
   loop, that independently asks: *Can we prove it? Can this fail open? Are
   tenant boundaries real? Could our evidence be stale? Can an attacker
   manipulate provenance? Would an assessor believe this?*

CISA's Secure by Design guidance calls for organizational structure and
executive accountability around security as a product concern. For a company
whose product is a trust gate, both layers are load-bearing. Today, the
independent layer is exercised by the proof-and-gate estate (every claim in
the repo carries an executable counterexample) and cross-lane adversarial
review; the catalog records what it becomes with headcount.

## AI is an organizational function, not a developer tool

Because this company is built with substantial AI assistance, **AI/Agent
Operations** is a real function. It governs: which agents may do what; which
repositories they may change; approval boundaries; model/provider selection;
costs; generated-code review; evaluations; prompt/workflow versioning; data
exposure; tool-call auditing; human accountability; and AI incident handling —
per NIST's AI RMF, which calls for explicitly defined human roles for AI
oversight. Initially these are roles, not three employees; today they are
partially self-referential, because the agent lanes that run the company also
operate under the lane-coordination protocol, the review-coverage ledger, and
owner-only escalation boundaries this function formalizes.

## Reliability becomes a separate discipline later

Early engineering owns deployment and operations. Once a real production
service has customers, SRE becomes a genuine organizational requirement
(Google's model: engineering applied to operations, operational toil held
below half of capacity). Incident response uses **operational roles assigned
during an incident** — Incident Commander, Operations Lead, Communications,
Planning — not permanent titles. That becomes operating doctrine at first
production incident, and is written into the catalog now so the first
incident does not invent it.

## Do not hire the org chart

Every role in the catalog carries one of four statuses:

- **ACTIVE** — performed now.
- **COVERED** — the responsibility exists; another person or agent covers it.
- **FRACTIONAL** — lawyer, accountant, assessor, recruiter, and similar.
- **FUTURE** — the activation trigger has not been reached.

Hiring follows [HIRING_SEQUENCE.md](HIRING_SEQUENCE.md) — engineering leaves
founder-only long before sales does, executives are not first hires, and
every hire has a trigger of workload, customer requirement, or risk. Decision
rights are bound to roles in
[RESPONSIBILITY_AND_DRI_MATRIX.md](RESPONSIBILITY_AND_DRI_MATRIX.md).

## Relationship to the agent roster

[`docs/agent/org-roster.json`](../agent/org-roster.json) (and its chart,
[`docs/ORG_CHART.md`](../ORG_CHART.md)) is the **operating registry of the AI
agent lanes** — the 41 agent duties that execute work today, each gated so an
activation must name an artifact. This directory is the **company design**
that sits above it: catalog roles say which agent lane covers them today, and
the roster stays the enforcement surface for what the lanes actually did.
