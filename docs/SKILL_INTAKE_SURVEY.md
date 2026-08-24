# Skill-collection intake — nine repositories, what was taken, and what was not

**Date:** 2026-08-20. **Requested by the owner**, who supplied ten repositories (nine skill collections plus two tools) and
asked that their capabilities "become an employee for the company and do what they
do for my company."

Two things came out of it: **one vendored skill set**, and **nine new roles**. About
1,900 skills did not become anything, and the reason is written down here so the
question does not get re-asked.

---

## 1. Licence first, because this repository is PUBLIC

Anything committed here is republished under our own MIT grant, and we can only
grant what we were granted. That is not a formality — it is what
`scripts/publication-boundary.mjs` means by its `third_party_intake` class:
*"The risk here is not leaking outward — it is REPUBLISHING someone else's licensed
work from a public repository."*

| Repository | Licence | Verdict |
| --- | --- | --- |
| `obra/superpowers` | MIT © 2025 Jesse Vincent | **VENDORED** — `.claude/skills/`, unmodified, licence retained |
| `coreyhaines31/marketingskills` | MIT | read for capability mapping; not vendored |
| `OneWave-AI/claude-skills` | MIT © 2025 OneWave AI | read for capability mapping; not vendored |
| `affaan-m/ECC` | MIT © 2026 Affaan Mustafa | read for capability mapping; not vendored |
| `ericbuess/claude-code-docs` | MIT | a docs mirror, not a capability |
| `yamadashy/repomix` | MIT © 2024 Kazuki Yamada | a tool; would be a dependency, not a role |
| `microsoft/markitdown` | MIT © Microsoft | a tool — converts PDF/Office/audio/images to Markdown; a dependency for document intake, not a role |
| `eyaltoledano/claude-task-master` | custom **"Task Master License"** | **UNREAD — do not use until a human reads it** |
| `ComposioHQ/awesome-claude-skills` | **NONE** | **REFUSED** |
| `travisvn/awesome-claude-skills` | **NONE** | **REFUSED** |
| `multica-ai/andrej-karpathy-skills` | **NONE** | **REFUSED** |
| `hesreallyhim/awesome-claude-code` | **CC BY-NC-ND 4.0** | **REFUSED** |

**Three carry no licence file at all**, and one of those holds 864 skills — the
largest catalogue of the set. Absence of a licence is not permission; it is the
default, and the default grants nothing. *"It is on GitHub and the repo is called
awesome"* is precisely the reasoning this table exists to stop.

`CC BY-NC-ND 4.0` disqualifies itself twice: **NonCommercial** against a commercial
venture, **NoDerivatives** against adapting anything.

A **custom licence is not a green light either.** `claude-task-master` may well be
permissive; nobody has read it, so it is marked unread rather than assumed.

## 2. What was vendored

`obra/superpowers` only — 14 skills, 51 files, byte-identical to upstream commit
`b36e082`. Provenance, licence basis and caveats are in `.claude/skills/VENDORED.md`;
the directory is classified `third_party_intake` in the publication boundary.

Chosen on merit, not volume: its skills — `verification-before-completion`,
`systematic-debugging`, `test-driven-development`, `requesting-code-review`,
`finishing-a-development-branch` — are the workflow form of what `preflight.mjs` and
the `proof:*` suite already enforce mechanically. Adopting them adds no new product
claim and no new launch surface.

They are **not** counted in `docs/agent/review-coverage.json`. They have been
surveyed, not audited, and counting unread files as reviewed is the exact fiction
that ledger exists to prevent.

## 3. What became a role

Nine, taking the roster from 31 to 40. A role is a *job with a trigger*, written in
our own words against this company's actual situation — not a copy of anyone's
prompt, which is why the unlicensed collections could still inform the gap analysis
without being republished.

### New division — Go-to-market (six roles)

The loudest gap in the chart. Seventeen engineering roles, six signal domains, eight
business-analysis roles, and **nobody whose job was to get the thing in front of a
buyer.** Sourced from `marketingskills`' coverage of positioning, ICP research,
content, launch, and lifecycle.

`positioning-messaging` · `icp-customer-research` · `proof-led-content` ·
`design-partner-outreach` · `launch-manager` · `lifecycle-activation`

Two are marked **PREMATURE** in the roster rather than started, and that is
deliberate. `launch-manager` would be writing fiction against a launch profile still
moving weekly. `lifecycle-activation` would describe a customer journey nobody has
taken.

`proof-led-content` is the one with unusual leverage: four findings are already
sitting unpublished — a quarantined NAC device receives an `Access-ACCEPT`; an
egress proxy collapses the `dns_failing` rung; a hash-chained ledger cannot see
deletion of its own tail; Keycloak emits no `amr` on any surface. Publishing
unflattering measurements is a differentiator competitors will not copy.

### Three added to Company

- **`finance-fundraising`** — there is no cost model for SignalGrid at all.
- **`commercial-counsel`** — selling into healthcare needs a BAA, while this
  repository states plainly that HIPAA/SOC 2 are not guaranteed and a human review
  is required. Those two facts have never been reconciled in writing.
- **`agent-ops-economics`** — nothing measures what the agent organisation costs to
  run, and it now spans every role in `docs/agent/org-roster.json` — the count is
  printed by `node scripts/check-org-roster.mjs`, not pinned here, because this
  line held a stale 40 against a registry of 41 — across four divisions and two
  machines. Review
  coverage measures what was read, never what reading it cost.

## 4. What did NOT become a role, and why

Roughly 1,900 skills across the surveyed repositories became nothing. Not an
oversight — a decision, and the roster gate states the principle it rests on:
**"A role nobody runs is a claim nobody keeps."**

- **Most were not jobs this company has.** `OneWave-AI/claude-skills` is 205 skills
  of which a large share are sports and personal finance — `fantasy-lineup-optimizer`,
  `trash-talk-generator`, `sports-betting-analyzer`, `workout-program-designer`.
  Real skills; not SignalGrid's org.
- **Many duplicate roles that already exist.** `technical-writer` and
  `knowledge-base-builder` are `docs-writer`. `code-review-pro` and
  `git-pr-reviewer` are `qa-engineer` plus the existing review lane.
  `security-pentest-planner` is `security-engineer` and `threat-modeler`.
  `accessibility-auditor` is `accessibility-specialist`.
- **Some are tools, not jobs.** `repomix` packs a codebase into one file; that is a
  dependency decision, not an employee.
- **Adding them anyway would have broken the thing that makes the roster useful.**
  It was deliberately converted from a census into a queue, with priorities and next
  actions. Forty roles where twenty-six are still cold is already a real backlog.
  Two hundred would make the chart decorative, and a decorative org chart reads as
  capability — the same unearned affirmative this repository exists to refuse.

## 5. Where the clones live

`/workspace/thirdparty/`, deliberately **outside** this repository so nothing can be
committed by accident. They are working copies for reference, not tracked content,
and they do not survive the session.
