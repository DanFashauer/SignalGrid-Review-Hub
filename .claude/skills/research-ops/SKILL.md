---
name: research-ops
description: Evidence-first market, competitive, and customer-discovery research for SignalGrid, held to the same citation-and-truth discipline the code is. Use when researching a market, sizing a segment, comparing a competitor or category, preparing outreach or investor material, or planning and logging discovery conversations. Every claim is cited to something that resolves, nothing is fabricated, and an absence is proven before it is written. Points at the existing docs/research corpus rather than restating it.
---

# SignalGrid — Research Ops

Non-code work moves this company or it does not move. `docs/agent/DISCOVERY_LOG.md`
states it plainly: no amount of engineering changes the number that matters, and
the next evidence that can change `docs/PURPOSE.md`, the wedge, or the product
hierarchy comes from OUTSIDE the repo. This skill is how that outside evidence is
gathered and written down without inheriting the failure modes the code side
already paid for. It inherits the base `signalgrid` skill and the truth rules of
`signalgrid-scribe` — read those first; this does not repeat them.

This is an INSTRUCTION file, not a tool. It installs nothing and sends nothing
out. Adopting a research MCP or CLI that reaches an external service is a separate
act that needs the owner's explicit yes and a decision record (see how Firecrawl
and the public-apis directory were taken in `docs/agent/RESOURCE_INTAKE.md`).

## The corpus already exists — extend it, do not restate it

Before starting new research, read what is there. `docs/research/README.md` indexes
the set; the load-bearing pieces are `docs/research/MARKET_LANDSCAPE.md`, the
`docs/research/COMPETITIVE_*.md` briefs, `docs/research/COMPETITIVE_BATTLECARD.md`,
and the buyer/partner and investor packs beside them. A new finding either updates
one of these in place or earns its own file linked from `docs/INDEX.md` — never a
second document making the same claim a third time, which is how a figure drifts.

## The five rules that make research trustworthy here

1. **Every claim cites something that resolves.** A market number, a competitor
   capability, a buyer quote — each carries its source inline. Backticked repo
   paths are checked by `scripts/check-cited-paths.mjs`; a citation that points
   nowhere reads as evidence and is not. An external figure names its source and
   its date; a bare statistic with no attribution fails `node scripts/check-accuracy-doctrine.mjs`.
2. **Prove an absence before you write it.** Before "no competitor does X", "no
   surface named Y exists", or "the market has no Z", run
   `pnpm run check:absence <topic>` (`scripts/agent/absence-check.mjs`) and READ
   the matches yourself. Two in-repo documents have claimed a surface was absent
   while it sat in the tree; the feeling of being sure is what every instance had
   in common. `inconclusive` is not `corroborated`.
3. **Nothing is fabricated.** No invented quotes, no made-up company names against
   a claim, no synthetic "a buyer told us". If discovery has produced no data yet,
   the honest finding is that it has not — `docs/agent/DISCOVERY_LOG.md` scores
   problem-recognition and behavioural-commitment separately for exactly this
   reason, so "they agreed it's a real gap" is never quietly upgraded to "they
   would buy".
4. **The narrowest truthful verb.** researched / studied / candidate / a stated
   intent / a pilot discussion / a signed commitment are different claims. Do not
   promote one into another because a conversation was warm. This is the scribe's
   evidence vocabulary applied to market claims.
5. **Publication boundary and claim discipline hold.** This is a public,
   pre-production repository. No secrets, tenant IDs, customer data, PHI or PII in
   prose or a fixture. Never write that SignalGrid is production-ready, certified,
   a partner of any named vendor, autonomous, or a replacement for IAM/IGA/UEM/
   MDM/DEX/RMM/SIEM/SOAR/ITSM/NAC. Name a target company only as a candidate, not
   a customer or partner. Retired category labels stay retired.

## Discovery is the product's only moving number

Discovery work is governed by `docs/agent/DISCOVERY_LOG.md`, not by this file:
the pre-registered two-phase protocol, the target roles, and the tally live
there. Research Ops SUPPORTS it — sharpening the question, mapping who to ask,
preparing the read-only observe-mode framing — and records every conversation in
that log the day it happens. A polished pitch pack is not a discovery
conversation, and code work never substitutes for one.

## Handing findings back

- To the owner: follow `.claude/skills/owner-comms/SKILL.md` — answer first,
  plain prose, no padding. A finding he can act on in three sentences beats a memo.
- To the tree: a research file is reachable from `docs/INDEX.md`
  (`scripts/check-doc-orphans.mjs`) and cites only paths that exist
  (`scripts/check-cited-paths.mjs`). Date what you measured.
- When a prior claim proves false, it goes in `docs/agent/FALSE_CLAIMS.json` with
  the refuting evidence and why the error happened — a permanent regression test,
  never deleted to make a gate pass.
- An owner-supplied resource is absorbed by USE and logged in
  `docs/agent/RESOURCE_INTAKE.md`; adopting anything that runs in a session or
  reaches an external service gets a decision record in `docs/DECISION_RECORDS.md`.

## Before you hand back

```bash
pnpm run check:cited-paths      # every path a finding cites resolves
pnpm run check:doc-orphans      # every new file is reachable from an index
pnpm run check:false-claims     # nothing already disproven is re-asserted
node scripts/check-launch-claims.mjs   # no deferred capability read as current, no retired label
```

State plainly what you verified by running or reading something, and what you took
on trust. An undated, unsourced market claim ages into a fossil the day it is
written.
