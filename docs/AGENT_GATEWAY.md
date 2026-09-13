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

## The routing brain — Switchyard

[Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) (NVIDIA, Apache-2.0) sits a layer
ABOVE the access gateways above. Where OmniRoute and LM Studio decide *how to reach* a
model, Switchyard decides *which* model each call should go to — "route each LLM call to
the cheapest model that can still do the job, without changing a line of your agent." It
preserves native OpenAI and Anthropic API compatibility, so it drops into the same "point
the lane's base URL at an endpoint" mechanism (step 3 above) and can treat an OmniRoute or
LM Studio endpoint as one of its own targets.

Three integration shapes, matching how a lane already runs: **embed the library**
(`switchyard-libsy`, Python `nemo-switchyard` / Rust — your harness makes every model call,
Switchyard only picks the model, so transport, retries and credentials stay yours), **run
the standalone proxy** (`switchyard-server`, OpenAI+Anthropic-compatible, Demo-grade only),
or **plug into a gateway** (LiteLLM router, NeMo Relay). Its routing algorithms are the part
that matters for the org's own tiered agent work: **escalation** (start on an efficient
model; an LLM judge escalates to a capable one on detected issues) and **advisor-gate** (a
stronger model approves a weaker one's plans and "done" claims, or sends it back) are almost
exactly the shape of the standing multi-tier pipeline — cheap model does the slice, a
stronger model reviews, escalate only when the work needs it. NVIDIA reports Terminal-Bench
2.1 at 95-99% of an Opus-4.8 baseline's accuracy for 13-30% less cost.

Where it fits here:

- **The standing multi-tier pipeline's routing layer** — the concrete "route bulk work to
  the cheapest capable model, escalate the hard slices" mechanism, running *over* the
  provider access OmniRoute/LM Studio give it.
- **A candidate backend for the model-routing tap** (`docs/DECISION_RECORDS.md`, DR-035, the
  chore-only, report-only helper): the tap decides *whether* a low-stakes, fully-recheckable
  task may leave the main model; Switchyard's `libsy` is a ready-made *which-model* picker
  for that path.

Every boundary above transfers unchanged, and one is sharpest:

- **Never in the decision path.** Switchyard is LLM-judge routing — nondeterministic and
  network-dependent by construction. Nothing under `lib/*`, `artifacts/api-server`'s `/v1`
  decision path, a connector, or a proof may call, import, or depend on it. A model must
  never decide a verdict, and a router that *chooses the model* is one layer further from
  determinism, not closer (golden rule 2).
- **Keys out of the tree.** Its `routes.toml` reads provider keys from the environment
  (`api_key_env`); those stay owner secrets, exactly as OmniRoute's do.
- **By reference, pinned, not run in a live session.** Adopted by reference (Apache-2.0),
  not vendored, not a dependency here. It is **pre-1.0** — its components range Demo/Alpha/
  Beta and the README says pin the version you integrate. Its install paths build from
  source (`pip install git+…`, `cargo install`), which is install-time execution; per DR-041
  and DR-022 it is **not** cloned or built into a live working session. When the pipeline
  actually runs it, it runs in an isolated per-run container with env-only keys, never
  touching this checkout or the decision path.

## What this repo does and does not carry

- **Carries:** this adoption record (OmniRoute under DR-029, plus the LM Studio and
  Switchyard sections above), and their intake rows. That is the whole in-tree footprint by
  design.
- **Does not carry:** any gateway or router itself, its dependencies, any provider key, or
  any code path that reaches one. Removing OmniRoute, LM Studio or Switchyard from the org
  is deleting documentation; the product is unaffected, by construction.
