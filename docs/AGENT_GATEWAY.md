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

## The fully-local counterpart — LM Studio

[LM Studio](https://github.com/lmstudio-ai) is the same model-access layer in fully-local
form. It runs LLMs entirely on the machine and serves them over an OpenAI-compatible
endpoint (`http://localhost:1234/v1`, with `/models`, `/chat/completions`, `/completions`,
`/embeddings` and `/responses`), plus an `lms` CLI (`lms server start`, `lms status`,
`--json`) for headless use. Where OmniRoute fronts ~352 REMOTE providers, LM Studio runs the
model on-device with **zero cloud egress** — the air-gapped end of the same "point the lane's
OpenAI-compatible base URL at an endpoint" mechanism above (step 3). A lane can point at it
directly; OmniRoute can also treat it as one local upstream. Adopted **by reference** — not
installed, not vendored, not a dependency here.

Every boundary above transfers, and two are stronger:

- **Never in the decision path.** Same rule, same reason, more so: LLM inference is
  nondeterministic by design and LM Studio offers no determinism guarantee, so nothing under
  `lib/*`, `artifacts/api-server`'s `/v1` decision path, a connector, or a proof may call,
  import, or depend on it. A model must never decide a verdict — running that model locally
  does not change that (golden rule 2).
- **Keys don't exist.** The remote-provider keys OmniRoute needs are absent entirely: local
  inference makes no outbound provider call, so there is no provider credential to keep out
  of the tree. (Downloading a model, or connecting LM Studio to a *remote* MCP server, does
  touch the network; the inference itself does not.)
- **By reference, not vendored.** The SDK, CLI and engine repos are MIT; the desktop app
  itself is proprietary — free for personal and internal-business use as of 2025-07-08, but
  its terms forbid sublicensing, reselling, redistributing or offering it as a service, so it
  is run from upstream by whoever wants it, never embedded in or shipped with anything here.
- **No claim moves.** A local build tool asserts nothing about the product. The product's
  air-gapped deployment tier ([`DEPLOYMENT_MODELS.md`](DEPLOYMENT_MODELS.md)) runs the
  deterministic core with **no model at all**; a zero-egress build lane is coherent with that
  residency posture but is not the same thing and does not put inference into the product.

## How a chore routes through it — the tap (DR-035)

The gateway above is *how* a lane reaches a model; the **tap** is *how a chore in this repo
actually consumes it**, and the routing policy is *which* chores may. All three are build-lane
only and fenced out of the product's decision path.

- **The policy — one source of truth.** `scripts/lib/model-routing-policy.mjs` maps each task
  class to a tier: a FREE/LOCAL tier reached through this gateway for bulk, low-stakes work a
  gate can fully re-check (log/CI triage, first-draft prose, bulk classification), and a CLAUDE
  tier — the coordinating session does it inline — for anything that decides, judges, or
  authors shippable output. An unknown class resolves to CLAUDE (fail-closed: unknown tightens,
  never loosens).
- **The tap — report-only.** `scripts/lib/agent-model-tap.mjs`'s `draftWithModel()` sends a
  FREE/LOCAL chore to the gateway endpoint (`SIGNALGRID_AGENT_MODEL_BASE_URL` /
  `SIGNALGRID_AGENT_MODEL_NAME`, optional `SIGNALGRID_AGENT_MODEL_KEY` — ENV-only) and returns
  a draft always labeled `verified:false`, or `null`. It never throws, blocks, writes, gates,
  or decides; with no endpoint configured it simply returns `null` and the caller proceeds on
  its deterministic path or hands the task to Claude. First consumer: `scripts/brief.mjs
  --narrate`.
- **The fence — by construction.** `scripts/check-model-tap-boundary.mjs` (preflight + CI)
  proves no file under `lib/**`, the `/v1` server, a connector, or a proof references the tap,
  its env vars, or a model-call shape, and that the tap imports nothing from the decision path
  — so a model, free or local, can never reach a verdict (golden rule 2). This is the same
  boundary the OmniRoute record states, now enforced, not just asserted.

## What this repo does and does not carry

- **Carries:** this adoption record, DR-029, and the intake row. That is the whole
  in-tree footprint by design.
- **Does not carry:** the gateway itself, its dependencies, any provider key, or any code
  path that reaches it. Removing OmniRoute from the org is deleting three documents; the
  product is unaffected, by construction.
