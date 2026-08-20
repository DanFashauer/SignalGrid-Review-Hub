# The SignalGrid org chart — every job the company needs, and who holds it

**Owner directive, 2026-08-19:** *"building out our complete internal org chart
for anything needed in this will require an employee aka agent to be its job to
be that ultimate skill for that employee. I need you to be running those types
of operations and thinking like this more."*

This is that chart. Thirty-one roles across three divisions. Each is an agent
whose job is to be the deepest skill the company has in one thing.

## The rule that keeps this honest

An org chart is the easiest document in a company to lie with. Thirty
impressive titles that never do any work read as capability the company does
not have — and this repository has just been bitten by exactly that shape:
`tenant:admin` was declared in the permission union, granted to a role, and
**required by nothing**. A control that reads as protection and isn't.

So this chart is **enforced, not asserted**:

- The machine-readable roster is `docs/agent/org-roster.json`.
- `scripts/check-org-roster.mjs` runs in preflight and CI. It **fails** on
  incoherence — a role with no charter or trigger, a duplicate, drift between
  the registry and this document, or an activation that does not name what it
  produced — and it **reports, on every single run**, how many roles have
  never been activated and which ones.
- So nobody can say "we have a compliance analyst" without "who has never run"
  being printed beside it.

**The current split is printed by the gate, deliberately not repeated here.**
An earlier draft of this document pinned the number in prose; that is the exact
staleness shape `check-memory-freshness.mjs` exists to catch, and it would have
been wrong within the hour — `network-domain` activated the same afternoon. Run
`node scripts/check-org-roster.mjs` for the live count.

## Division 1 — Engineering (function: *how* work is done)

Detailed charters, the shift loop and the delegated-authority model live in
`docs/VIRTUAL_TEAM.md`.

| Role id | Title | Activates when |
| --- | --- | --- |
| `principal-engineer` | Principal engineer / architect | A pending decision is technical and reversible |
| `qa-engineer` | QA engineer | Code shipped that no skeptic has read |
| `security-engineer` | Security engineer | CI, scripts or auth surfaces change |
| `product-manager` | Product manager | The queue has drifted or needs ranking |
| `web-engineer` | Frontend engineer | Web artifacts change, or a truth sweep runs |
| `sre` | SRE / operations engineer | Workflows change, or CI cost drifts |
| `mobile-native-engineer` | Mobile / native engineer | Native surfaces change, or port parity needs checking |
| `compliance-analyst` | Compliance analyst | A partner document or control claim changes |
| `performance-engineer` | Performance engineer | A performance figure is quoted, or the decision path changes |
| `release-engineer` | Release engineer | A surface is added to or reclassified in the launch profile |
| `data-persistence-engineer` | Data / persistence engineer | Ledger, migration or export code changes |
| `api-contract-architect` | API contract architect | A route is added or a contract changes |
| `devex-tooling-engineer` | DevEx / tooling engineer | A gate changes, or one is suspected of passing vacuously |
| `docs-writer` | Documentation engineer | A doc is added, or a claim outlives what it described |
| `accessibility-specialist` | Accessibility specialist | Any user-facing surface changes |
| `desktop-engineer` | Desktop engineer | Desktop code or its CI lane changes |
| `firmware-hardware-engineer` | Firmware / hardware engineer | Firmware or dock claims change |

The last eight exist because the work exists and nobody owned it: the launch
profile, the audit ledger, the `/v1` contract, the gate fabric itself, the docs
that serve as this product's PRD, accessibility, the Tauri lane, and firmware.

## Division 2 — Signal domains (*what the signal actually is*)

Full department detail — products represented, dimensions owned, what has been
live-verified — is in `docs/SIGNAL_DOMAIN_TEAM.md`.

| Role id | Department | Dimensions | Live-verified against |
| --- | --- | --- | --- |
| `iam-domain` | Identity & Access | 15 | Keycloak 26.4 |
| `endpoint-uem-domain` | Endpoint / UEM | 9 | Fleet 4.89.2, Headwind CE 5.30.3 |
| `secops-domain` | Security operations | 10 | Wazuh |
| `network-domain` | Network & connectivity | 6 | FreeRADIUS + a real intercepting egress proxy — **3 of 6** dimensions have had live contact |
| `physical-ot-domain` | Physical, facilities & OT | 5 | Traccar 6.14.5 |
| `itsm-ops-domain` | ITSM & operations | 6 | osquery (via the Fleet lab) |

The distinction between a department's *dimensions* being live-verified and the
*role* being activated matters: the Keycloak, Fleet, Headwind, Wazuh and Traccar
verifications happened before these roles existed, done by the coordinating
session. The department owns that work going forward.

`network-domain` was the priority — six dimensions with no live source ever
driven against any of them — and it is the first domain role activated. Its
shift stood up real RADIUS, the protocol every NAC product speaks beneath its
console, and found that a **quarantined device receives an `Access-Accept`**:
there is no quarantine packet or attribute in the protocol, so `quarantined` is
always a derivation from a customer-chosen VLAN or filter name, never something
a source reports. Five of its six dimensions remain live-unverified.

## Division 3 — Company (*the business around the product*)

| Role id | Title | Activates when |
| --- | --- | --- |
| `solutions-architect` | Solutions architect | A pilot is scoped or a deployment question needs an answer |
| `threat-modeler` | Threat modeler | A trust boundary moves or a surface is exposed |
| `competitive-analyst` | Competitive / market analyst | A competitor or category needs assessing |
| `partner-alliances-analyst` | Partner & alliances analyst | A partnership candidate surfaces |
| `pricing-packaging-analyst` | Pricing & packaging analyst | A pricing or packaging claim changes |
| `brand-design` | Brand & design lead | A user-facing surface's look changes |
| `program-manager` | Program manager | A shift is planned, or the roster reports stale roles |
| `records-archivist` | Records archivist | An owner input arrives, or a decision is made |
| `finance-fundraising` | Finance & fundraising lead | A spend or pricing decision needs a number, or an outside party asks for financials |
| `commercial-counsel` | Commercial counsel liaison | A counterparty sends paperwork, or a document starts committing rather than describing |
| `agent-ops-economics` | Agent operations & economics lead | The agent lanes change shape, or spend moves without matching output |

`program-manager` is the role that reads this gate's output and calls the ones
that have gone cold — the org watching itself.

## Division 4 — Go-to-market (*getting it in front of someone*)

| Role id | Title | Activates when |
| --- | --- | --- |
| `positioning-messaging` | Positioning & messaging lead | Scope changes, or a document makes a claim a buyer would not recognise |
| `icp-customer-research` | ICP & customer research lead | A decision is about to rest on an unchecked assumption about buyers |
| `proof-led-content` | Proof-led content lead | A live shape-check or gate finding lands that a practitioner would want to read |
| `design-partner-outreach` | Design-partner outreach lead | The product demos end to end and the positioning is settled |
| `launch-manager` | Launch manager | The launch profile stops moving |
| `lifecycle-activation` | Lifecycle & activation lead | A first design partner is live |

This division was missing entirely until 2026-08-20, and its absence was the
loudest gap in the chart: seventeen engineering roles, six signal domains, eight
business-analysis roles — and nobody whose job was to get the thing in front of a
buyer.

Two of its six are marked PREMATURE in the roster rather than started.
`launch-manager` would be writing fiction against a launch profile still moving
weekly (22 items classified launch against 134 deferred), and
`lifecycle-activation` would be describing a customer journey nobody has taken.
Naming a gap is not the same as working it, and a role invented to look complete is
the same unearned affirmative this repository exists to refuse.

`design-partner-outreach` **prepares only**. Contacting a person outside the company
is one of the owner's five reserved actions, so that role can never send anything
itself.

## What no role in this chart may do

Unchanged, and short on purpose (`docs/VIRTUAL_TEAM.md` holds the full text):
nothing reaches a person outside the company without the owner sending it;
nothing binds legally or in compliance without a human signing; nothing
irreversible; nothing needing credentials the team does not hold; and no role
invents an owner preference on taste, appetite or strategy.

## The queue — how the next thing to do is decided

`check-org-roster.mjs` used to print a count of cold roles. A count is a
census, and a census does not move work: "twenty-one roles have never run" tells
you the size of a deficit and nothing about what to do about it. The
`program-manager` shift on 2026-08-19 changed it into a **queue**.

Every cold role now carries a **`priority`** (1 = call next, 2 = real work
waiting on capacity, 3 = genuinely waiting for its trigger to fire) and a
**`nextAction`** — one concrete sentence naming what that role would actually
do first. The gate **refuses** a cold role that has no `nextAction`, which is
the same law applied one level deeper: an activated role must name what it
produced, and a cold role must name what would make it real. Neither can be a
title alone.

So the tool now answers the operating question directly:

```bash
node scripts/check-org-roster.mjs     # the P1 set, with each role's next action
```

The top of that list is the next thing to do. Nobody has to deliberate about
which cold role matters — the deliberation happened once, is written down, and
is revised when the situation changes rather than re-argued each session.

## How a role gets activated

1. It is called by name — by the owner, or by `program-manager` reading the
   unactivated list — and works a shift under the loop in `VIRTUAL_TEAM.md`:
   read-only findings, adversarial verification, then gated application.
2. Its roster entry gains an `activated` date **and** a `produced` field
   naming what came out of it. The gate fails if a role claims activation and
   names nothing, because "activated" without an artifact is the unearned
   affirmative with a date on it.
3. A role that stays cold indefinitely gets deleted rather than carried. The
   chart is meant to describe the company, not flatter it.
