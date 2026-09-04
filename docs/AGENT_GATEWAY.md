# Agent gateway — OmniRoute as the model-access layer for the coding lanes

**Status:** adopted by reference (DR-029, owner-directed 2026-09-04). This is a
BUILD/AGENT tool, not a product component. Read the boundary before wiring anything.

## What it is

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT) is a self-hosted AI
gateway: one OpenAI-compatible endpoint in front of ~352 upstream providers / 1200+
models, with routing strategies, free-tier token aggregation, token compression, and
three-layer resilience (circuit breakers, cooldowns, model lockout). It exists to keep an
agent working across a single provider's rate limits and outages — "never stop coding."

For SignalGrid it is the sanctioned **model-access layer for the coding lanes** (cloud +
Mac) and the org's agents: a lane points its model traffic at the gateway and gets
provider fallback and free-tier aggregation so build work does not stall.

## The boundary (do not cross it)

OmniRoute lives entirely on the build/agent side. It carries the BUILDERS' model traffic
and decides nothing about the product.

- **Never in the decision path.** Nothing under `lib/*`, `artifacts/api-server`'s `/v1`
  decision path, a connector, or a proof may call, import, or depend on the gateway. The
  decision core is deterministic, offline and fixture-backed (golden rule 2); an AI
  gateway is nondeterministic model routing by design. A model must never decide a
  verdict.
- **Keys out of the tree.** Provider keys/OAuth are owner secrets — environment-only,
  never committed, the same rule every connector credential already follows.
- **By reference, not vendored.** Run it from upstream; it is not copied into this repo
  and is not a package dependency here, so its 352-provider surface stays out of this
  repo's supply chain.

## How a lane adopts it

Runtime adoption is owner infrastructure — the repo ratifies and documents it; it cannot
provision it, because a lane's model endpoint is set by its environment, not by this
repository.

1. **Owner: self-host the gateway.** Run OmniRoute on infrastructure the owner controls
   (Docker or Node 18+), following the upstream README. Keep it private to the org.
2. **Owner: provision provider keys** in the gateway's own configuration (its README
   documents provider setup and which of its ~52 providers are free-tier/keyless). These
   are secrets; they live in the gateway's environment, never in this repo.
3. **Per lane: point model traffic at the gateway.** Set the lane's OpenAI-compatible
   base URL to the gateway endpoint via the lane's own environment (not committed). The
   gateway then handles routing, fallback and aggregation transparently.
4. **Optional — its MCP server.** OmniRoute ships an MCP server (110 tools). If a lane
   wants it, register it the same keys-env-only way the other dev MCP servers are set up
   (see [`MCP_AND_SKILLS_LANE_PARITY.md`](MCP_AND_SKILLS_LANE_PARITY.md) and
   `pnpm run mcp:setup`). It is optional and separate from the gateway role above.

## What this repo does and does not carry

- **Carries:** this adoption record, DR-029, and the intake row. That is the whole
  in-tree footprint by design.
- **Does not carry:** the gateway itself, its dependencies, any provider key, or any code
  path that reaches it. Removing OmniRoute from the org is deleting three documents; the
  product is unaffected, by construction.
