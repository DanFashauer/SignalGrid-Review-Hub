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

## An Axis-B routing candidate — Switchyard

[Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) (NVIDIA, Apache-2.0) would sit a
layer ABOVE the access gateways above. Where OmniRoute and LM Studio decide *how to reach* a
model, Switchyard decides *which* model each call should go to — "route each LLM call to
the cheapest model that can still do the job, without changing a line of your agent." It
preserves native OpenAI and Anthropic API compatibility, so it drops into the same "point
the lane's base URL at an endpoint" mechanism (step 3 above) and can treat an OmniRoute or
LM Studio endpoint as one of its own routing targets.

**"Above OmniRoute/LM Studio" is a target architecture, not an operational one today**
(established by the Mac lane's independent source read, 2026-09-13). Switchyard's README says
it "runs inside gateways you may already have — NeMo Relay or LiteLLM"; the org runs neither,
and OmniRoute (DR-029) is not a documented Switchyard host. The **base-URL-repoint** shape —
the standalone `switchyard-server` proxy, the one that drops into the step-3 mechanism without
writing harness code — is rated by upstream's own component table as "Demo — Demos and
evaluation only. Not for production," the package is `Development Status :: 3 - Alpha`, pre-1.0,
and its README warns routing behavior can change between releases. (The embedded `libsy` shape
is also host-free but is not a base-URL repoint — the harness makes the calls.) So the
placement below is a candidate shape to grow into, not a wiring that exists.

It is logged here as a **research candidate for Axis-B routing only — an automatic
remote-vs-local picker between OmniRoute and LM Studio — not a Claude-tier router.** DR-050 §3
splits the one model-routing story into two axes: **Axis A** (which *Claude* model runs an
agentic stage) is owned entirely by **DR-047** through the harness's `model:` field, with no
HTTP gateway in the path; **Axis B** (which endpoint serves a raw, non-Claude-Code call) is
owned by OmniRoute (DR-029) with LM Studio as its local twin. DR-050 §3 places Switchyard on
**Axis B only** — "at most an automatic remote-vs-local picker between the two Axis-B
endpoints" — and rules it "REDUNDANT-and-harmful the moment it touches Axis A." So it is never
a candidate for the Claude-tier pipeline; see "Why it is confined to Axis B" below.

Its **placement** is governed by **DR-050** (Mac = always-on live brain, cloud = final review
board, owner-directed 2026-09-13): DR-050 §3 fixes Switchyard on Axis B and its
resource-placement table records that it runs fully on the Mac (no GPU, no keys) but its two
jobs are already covered — OmniRoute (DR-029) is the gateway, DR-047 owns Claude-tier
selection. DR-050 deliberately **defers Switchyard's adoption strength to this PR** rather than
settling it; so this PR records that disposition — a by-reference research candidate, not
adopted — and adds no decision record of its own. Placement is DR-050's; the by-reference
disposition is this PR's.

Three integration shapes, matching how a lane already runs: **embed the library**
(`switchyard-libsy`, Python `nemo-switchyard` / Rust — your harness makes every model call,
Switchyard only picks the model, so transport, retries and credentials stay yours), **run
the standalone proxy** (`switchyard-server`, OpenAI+Anthropic-compatible, the host-free
base-URL-repoint shape — but upstream-rated demo/evaluation only, not for production, as
above), or **plug into a host gateway** (LiteLLM router, NeMo Relay — neither of which the org
runs). The embedded and standalone-proxy shapes are both host-free; only the gateway plug-in
needs a host.
Its routing algorithms — **escalation** (start efficient; an LLM judge escalates on detected
issues) and **advisor-gate** (a stronger model approves a weaker one's plans and "done"
claims) — resemble the org's tiered agent work, but that resemblance is to **Axis A**, which
DR-047 owns and Switchyard may not touch (below). On its permitted Axis-B role it is far
simpler: a remote-vs-local endpoint picker, not a tier judge. NVIDIA reports Terminal-Bench
2.1 at 95-99% of an Opus-4.8 baseline's accuracy for 13-30% less cost.

Where it could fit here, once gated — Axis B only:

- **A candidate remote-vs-local picker between the two Axis-B endpoints** — deciding, for a
  raw non-Claude-Code call, whether OmniRoute's remote providers or LM Studio's local twin
  serves it. That is the whole of the role DR-050 §3 permits ("at most an automatic
  remote-vs-local picker between the two Axis-B endpoints"). It never selects a Claude tier.
- **A candidate backend for the model-tap boundary** that `docs/DECISION_RECORDS.md` DR-047
  rule 7 names alongside DR-029's gateway boundary: once the tap has decided a low-stakes,
  fully-recheckable task may leave the main (Claude) model, the work is an Axis-B call, and
  Switchyard's `libsy` could pick which Axis-B endpoint serves it — still never choosing the
  Claude tier itself. (The tap's own defining record lives on an open branch, not yet in this
  tree; this section does not stand in for it.)

**Why it is confined to Axis B — the DR-047 / DR-050 boundary.** Axis A (which Claude model
runs an agentic stage) is owned entirely by DR-047: each spawn sets an explicit tier via the
harness `model:` field, tier is assigned by work-class deterministically, and an
unavailable/unknown tier resolves UP to Opus with Opus judgment work WAITING rather than
downgrading. Switchyard's default is the opposite: its `stage_router` default `efficient_first`
(and the `auto` policy) fails DOWN to the cheap tier on low confidence. DR-050 §3 draws the
line from this directly: Switchyard is "REDUNDANT-and-harmful the moment it touches Axis A"
and "is never wired in front of the coordinating Claude Code session or its subagents." So
there is **no Axis-A promotion path** — not "constrained to the spawn-selected tier," not "if
DR-047 is amended"; a router whose default fails DOWN has no business on the axis whose rule is
fail-UP, and DR-047 already routes tiers with no gateway in the path. Switchyard's only
candidate role here is the Axis-B remote-vs-local pick above. Its **advisor-gate** (a stronger
model approves a weaker one's plans and "done" claims) is a separate, external *verification*
behavior; adopting it in that role would run through the external-verification-tool gate
(`AGENTS.md`, the evidence-toolchain skill + open-source lab registry), not this section.

**Promotion from candidate to an Axis-B picker requires all three**, when there is a real
Axis-B need for it, and is owned by `principal-engineer` — the role
`docs/agent/EVIDENCE_TOOLCHAIN_OWNERSHIP.md` assigns any promotion from research/reference into
a deployed dependency and the recording of its reversal path: (1) confinement to Axis B — wired
only between OmniRoute and LM Studio for raw non-Claude-Code calls, never in front of the
coordinating session or its subagents (DR-050 §3); (2) a pinned, vetted revision (it is pre-1.0
and builds from source; only `README @ main` has been read, so no commit is vetted — "pinned"
is a requirement not yet met); (3) **open-source lab registry intake — unconditional.** The evidence-toolchain
promotion rule (`docs/agent/EVIDENCE_TOOLCHAIN_OWNERSHIP.md`) requires that before any
source/tool becomes installed, deployed, CI-required, product-visible or a production
connector, `principal-engineer` records its classification, tier, accountable role, licence
basis, credential class, mutation rights and deployment evidence in
`docs/OPEN_SOURCE_LAB_REGISTRY.md` and its JSON twin — whether or not `advisor-gate` is
enabled. The advisor-gate verification role only sharpens *why* intake matters; it never
conditions *whether*. Until all three land, Switchyard stays a documentation reference,
exactly as OmniRoute is — nothing in the tree calls, imports, depends on, or is directed to
use it.

Every boundary above transfers unchanged, and one is sharpest:

- **Never in the decision path.** Switchyard is LLM-judge routing — nondeterministic and
  network-dependent by construction. Nothing under `lib/*`, `artifacts/api-server`'s `/v1`
  decision path, a connector, or a proof may call, import, or depend on it. A model must
  never decide a verdict, and a router that *chooses the model* is one layer further from
  determinism, not closer (golden rule 2).
- **Keys out of the tree.** Its `routes.toml` reads provider keys from the environment
  (`api_key_env`); those stay owner secrets, exactly as OmniRoute's do. `api_key_env` is
  optional — a keyless local target is architecturally supported ("omit to send no
  authentication") — but no upstream example demonstrates it and every documented example uses
  a provider key, so treat Switchyard as **keyless-capable, not keyless-by-default**.
- **By reference; pinning required before any run; not run in a live session.** Adopted by
  reference (Apache-2.0), not vendored, not a dependency here. It is **pre-1.0** — its
  components range Demo/Alpha/Beta and the README says pin the version you integrate. No
  revision is vetted yet: only `README @ main` has been read, so "pinned" is a prerequisite
  (a vetted commit or tag) that a future run must satisfy, not a property this record already
  holds. Its install paths build from source (`pip install git+…`, `cargo install`), which is
  install-time execution. It is not installed or run in this working session. The isolation
  shape a future run should take — an isolated per-run container, env-only keys, report-only,
  never touching this checkout or the decision path — follows the same disciplined pattern the
  repo's prior tool adoptions each set for their own tool (DR-022 installed Firecrawl as a
  *pinned*, keys-env-only, report-only MCP client, not the vendor one-liner; DR-041 ran
  LightRAG with its working directory *outside the tree* and hooks off). Those records govern
  their own tools, not Switchyard; the concrete run constraint for Switchyard is ratified at
  promotion, through the lab-registry intake and a record, not asserted as already-governing
  here.

## What this repo does and does not carry

- **Carries:** this adoption record (OmniRoute under DR-029, plus the LM Studio and
  Switchyard sections above) and the two dedicated intake rows that exist — OmniRoute's and
  Switchyard's. LM Studio is documented in this file only and has no dedicated intake row.
  That is the whole in-tree footprint by design.
- **Does not carry:** any gateway or router itself, its dependencies, any provider key, or
  any code path that reaches one. Removing OmniRoute, LM Studio or Switchyard **from this
  repo** is deleting documentation, and the product is unaffected, by construction. Removing
  one **from the org's runtime** is a separate act this record does not perform: whoever
  stood up the runtime tears it down — stop the gateway/router (or its per-run container),
  restore each lane's model base URL to a direct endpoint, and revoke or de-provision its
  provider credentials. The repo footprint is documentation; the runtime, if any, is owner
  infrastructure and is reversed there.
