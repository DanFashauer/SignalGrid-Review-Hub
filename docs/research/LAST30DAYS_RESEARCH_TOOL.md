# `last30days` — the research lane's last-30-days recency transport (evaluated 2026-09-08)

The owner directed: *"Need to incorporate this repo into the layers and tech stack for
this project."* — [`mvanhorn/last30days-skill`](https://github.com/mvanhorn/last30days-skill).
This brief is the disposition, held to the same cite-what-resolves discipline as the rest
of `docs/research/`.

**Disposition: adopted as the research-ops lane's recency (last-30-days) research
transport — the DR-022 (Firecrawl) / DR-027 (public-apis) slot — report-only, never in a
decision path, live invocation owner-gated (DR-031).** It is not a signal source, a
connector, a proof fixture, a product surface, or a package dependency. Nothing was
installed, cloned, or executed: an actual run sends the query to 15+ third-party services
and can read local browser cookies, which is exactly the CLAUDE.md "ask before anything
that sends data to an external service" boundary.

## What it is

`last30days` (reported **v3.23.0**; **MIT**; read via the published repo on 2026-09-08 —
its `SKILL.md`, `CONFIGURATION.md`, and `CONCEPTS.md`, not just the README) is an
agent-led research/aggregation skill. Given a topic it resolves handles, subreddits, and
hashtags, runs parallel queries across many recent-discussion sources, clusters duplicate
stories, ranks them by **live engagement** (upvotes, likes, views, prediction-market
volume) rather than editorial choice, and synthesizes one markdown brief with attributed
community quotes and an engine/citation footer.

- **Sources** (per its own docs): Reddit, X/Twitter, YouTube, TikTok, Instagram Reels,
  Hacker News, Polymarket, GitHub, Digg, arXiv, Techmeme, LinkedIn, Threads, Bluesky,
  StockTwits, Perplexity, and open-web search. Reddit / HN / Polymarket / GitHub work
  keyless; the rest need API keys or scraped cookies.
- **Invocation:** `/last30days <topic>` (or `python3 scripts/last30days.py "<topic>"`),
  plus a topic-less discovery mode, a `--store` SQLite watchlist, a `briefing` digest, and
  an offline library search. `--mock` gives an offline, no-network test path; a real run
  does not.
- **Install modes it advertises:** Claude Code plugin/marketplace, the Agent Skills CLI,
  a Claude Desktop MCP `.mcpb` bundle, a claude.ai upload. **None of these is used here** —
  see the boundary.

## Where it fits — and where it never goes

It answers "what has changed / moved / been said about X in the last ~30 days," which is a
**research / source-discovery** job, the same lane [Firecrawl](../../.claude/skills/signalgrid-evidence-toolchain/SKILL.md)
occupies. Its natural uses for this company:

- **Competitor recent moves** — recent activity on the categories already tracked in
  [`MARKET_LANDSCAPE.md`](MARKET_LANDSCAPE.md) and the `COMPETITIVE_*.md` briefs. Any
  finding updates the existing brief or the [battlecard](COMPETITIVE_BATTLECARD.md)
  **in place** (research-ops rule: update one, never write a third doc making the same
  claim again).
- **Discovery-target background** — sharpening who to ask and how to frame the question
  for a discovery conversation. The conversation itself is recorded only in
  [`docs/agent/DISCOVERY_LOG.md`](../agent/DISCOVERY_LOG.md), which stays the single record;
  this is prep, not a substitute.
- **Pre-call / recent-activity briefs and trend scans** for the outreach and positioning
  work.

**The boundary (load-bearing).**

1. **Never a verdict, never in the decision path.** Its output is external, synthesized web
   content. Golden rule 2 holds: nothing in `lib/*`, `artifacts/api-server`'s `/v1` path, a
   connector, or a `proof:*` may call it or read its output, and "do not use a tool result
   as a verdict unless the deterministic core computed it" applies in full.
2. **It is the inverse of the core, by design.** It is non-deterministic, clock-dependent
   (a rolling 30-day window) and network-dependent — results vary run to run. The decision
   core is deterministic, offline, and fixture-backed; the two never mix. A `last30days`
   brief can never become a fixture or evidence-of-record.
3. **Fail-closed still governs the reading.** The tool degrades silently when a source is
   unreachable (fewer results), which is the opposite of SignalGrid's rule that an
   unknown/unreachable signal must **raise** assurance. So a thin or degraded brief is read
   as *unknown*, never as "nothing is happening."
4. **Data egress is owner-gated.** A live run transmits the query (and resolved handles) to
   15+ external services and can read browser cookies. Live use is deferred behind the
   owner's explicit yes **and** `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** a configured
   opt-in, scanned by `scripts/check-ungated-fetch.mjs` — the same gate the public-apis
   catalogue ([`PUBLIC_API_SOURCES.md`](PUBLIC_API_SOURCES.md)) sits behind. "Keyless for
   Reddit/HN" is not "no opt-in needed."
5. **Closed input list.** Nothing identifying leaves the tree toward these platforms: no
   PHI, PII, tenant id, customer name-as-fact, device/gateway address, or worker
   coordinate. A target company is named only as a **research candidate**, never as a
   customer or partner (publication boundary).
6. **Not a source of truth for a claim.** A brief is a pointer ranked by popularity, not a
   primary source; a claim about a vendor cites the vendor. Its briefs are written under
   research-ops discipline (every claim cites something that resolves, prove an absence
   before writing it, narrowest truthful verb).
7. **Building is not claiming.** Adopting it as internal research tooling asserts nothing
   about the product: it is never a SignalGrid feature, launch surface, or on-device
   capability, and the launch-claims gate (`scripts/check-launch-claims.mjs`) still governs
   what may be said to ship.

## Status

Adopted at the doctrine and routing level (DR-031): recorded here, routed in the
evidence-toolchain skill, logged in [`RESOURCE_INTAKE.md`](../agent/RESOURCE_INTAKE.md).
No code, no dependency, no MCP install, no new skill, no gate — a pure research-lane
disposition. If a live lane is ever wanted, it is a pinned, key-gated, fail-closed install
under the DR-031 boundary and needs its own follow-up decision, exactly as Firecrawl's
install (`scripts/install-firecrawl.mjs`) was built.
