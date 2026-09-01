# API access & connectors

How to talk to SignalGrid — and the options beyond raw REST. Everything here is
public-safe: the demo token is a fixture, not a real credential, and no live
vendor call happens by default.

## The surface

SignalGrid's api-server exposes two surfaces on one origin (default
`http://localhost:8080/api`):

- **Public demo surface** (no auth) — health, the integrations catalog, the
  simulator, the monitoring dashboards, the smart-hospital **room-entry**
  simulation, and the **Signal Radar** (`/signals/catalog`, `/signals/radar`).
- **`/v1` product API** (bearer token) — the deterministic decision core:
  context, `decisions/evaluate`, evidence, policies + versions, connectors,
  audit, webhooks, remediation, metrics. Tenant is always derived from the
  token, never from a client-supplied id.
- **`/cp/v1` control-plane surface** (no auth in the demo) — the SaaS management
  plane: tenants, sites, edge nodes (local decision planes), fleet devices,
  policy bundles pushed **down** (checksummed), telemetry ingested **up**, and a
  fleet-health rollup with a per-vertical breakdown. It also serves the read-only
  **build-the-grid** reads behind the operator console (see
  [`OPERATOR_GRID_CONSOLE.md`](./OPERATOR_GRID_CONSOLE.md)) — `grid/coverage`,
  `grid/sourcing`, `grid/config`, `grid/provisioning`, and `apps/resilience`. The
  control plane manages and distributes; it never decides — the edge core does. See
  [`DEPLOYMENT_MODELS.md`](./DEPLOYMENT_MODELS.md).

The authoritative machine-readable contract for `/v1` is
[`lib/api-spec/v1-openapi.yaml`](../lib/api-spec/v1-openapi.yaml) (OpenAPI 3.1).

## Who each surface is for — and what that audience is promised

The three surfaces above differ by MECHANISM (auth, direction, transport). They
also differ by AUDIENCE, and the audience determines what each surface promises
— the standard open / partner / internal API taxonomy, applied honestly to what
is actually served (intake: an API-types taxonomy the owner supplied,
2026-08-31; see `docs/agent/RESOURCE_INTAKE.md`):

| Surface | Audience class | Who reads it | What it promises |
| --- | --- | --- | --- |
| `/v1` product API | **Partner-facing** | The integration surface a design partner builds against (none is signed yet — discovery gates that). | The full contract: OpenAPI 3.1, bearer auth with tenant derived from the token, the versioning policy in [`API_VERSIONING_POLICY.md`](./API_VERSIONING_POLICY.md), and CI-enforced spec↔collection↔route lockstep. |
| `/cp/v1` control plane | **Internal** | SignalGrid's own management plane and operator console. | Fewer promises ON PURPOSE: no auth in the demo, no published versioning commitment, shape may move with the console. Do not build third-party integrations against it. |
| Public demo surface | **Demo, not an open API** | Reviewers exploring the fixture-backed demo. | Nothing beyond "the demo works today." It is unauthenticated because it serves fixtures, not because it is a supported open API — SignalGrid currently ships NO open/public API, and that is deliberate: every real decision is tenant-scoped. |

The distinction this table exists to hold: a route being REACHABLE does not make
it SUPPORTED. `/v1` is the only surface whose stability anyone outside this
repository may rely on, and only within the versioning policy's terms.

## Ways to connect — pick the one that fits

### 1. Postman collection (import and click)
A ready-made collection covering **every** endpoint (public + `/v1` + the
`/cp/v1` control plane, including the build-the-grid reads — grid coverage,
signal sourcing, config, provisioning, and app resilience) is committed at
[`docs/postman/`](./postman/):

- `SignalGrid.postman_collection.json` — 74 requests in three folders, with
  example bodies.
- `SignalGrid.postman_environment.json` — `base_url` + a demo `token` + the path
  variables (`decisionId`, `policyId`, …).

Import both into Postman (desktop or the web app), select the environment, and
run. Start with **List demo keys** (`GET /v1/keys`) to grab a token, paste it
into the environment's `token`, then call **Evaluate a decision**. The collection
is generated from the route list and kept in lockstep with the OpenAPI spec by a
CI check (`pnpm run check:postman`); regenerate with `pnpm run build:postman`.

### 2. Generated typed client (best for apps)
`@workspace/api-client-react` is a generated, fully-typed client + React Query
hooks for the API — no hand-written fetch code, types stay in sync with the spec
via `orval`. This is what the operator console and mobile PWA use. Import a hook
(`useListDecisions`, `useGetDashboardMetrics`, …) and call it; set the base URL
with `setBaseUrl()`.

### 3. Webhooks (push, not poll)
The `/v1/webhooks` surface delivers decision/remediation events outbound to a URL
you register, HMAC-signed, with retry + a deliveries log. Use this instead of
polling when you want to *react* to decisions (e.g. a SIEM or an alerting flow).

### 4. Raw REST / curl
Every endpoint is plain JSON over HTTPS. See [`RUN_ON_MAC.md`](./RUN_ON_MAC.md)
for curl examples.

## Bringing new signals in — the Signal Radar

You don't have to know in advance every signal a deployment emits. **Signal
Radar** (`@workspace/signal-radar`) watches incoming signals and classifies each:

- **evaluated** — already used by the decision core,
- **candidate** — a known roadmap category (observed, not yet a decision input),
- **novel** — never catalogued: a genuinely new signal, which raises a *first-seen
  alert* so you can decide whether to bring it into the grid.

Try it: `POST /api/signals/radar` with `{ "signals": [{ "category": "smart_bed_occupancy" }] }`
→ it comes back flagged as novel with an alert. The set of evaluated categories
is guarded at compile time: if the core's signal set changes, the radar (and CI)
notices. This is how the grid *detects, alerts on, and monitors* new signal
sources rather than silently ignoring them.

## "Is there something better than the API — direct connectors or plugins?"

Short answer: the API is the integration point, and there are three higher-level
options layered on it. Longer answer, honestly:

- **Connectors (inbound signals).** SignalGrid already models integrations as
  *connectors* that normalize a vendor's data into the core's signal shape — the
  harvested `@workspace/integrations` adapters (ITSM/UEM/NAC/SIEM/EDR) and the
  `@workspace/integration-bridge` (FleetDM posture → core signals) are exactly
  this. A "direct connector" for a new source means writing a small adapter that
  emits normalized signals; the Signal Radar helps you discover which sources are
  worth adapting. These stay **fixture-safe by default** and only make live calls
  in a `beta`/`prod` tier with real credentials.
- **Typed client + webhooks** (above) are the "SDK and events" layer over REST —
  usually what you want instead of hand-rolling HTTP.
- **MCP server (plugin path) — built.** `@workspace/mcp-server` is a
  **Model Context Protocol** server (stdio) exposing SignalGrid as tools, so an
  AI assistant or agent can query the grid directly. Tools: `list_room_scenarios`,
  `evaluate_room_entry`, `signal_catalog`, `scan_signals`, `evaluate_decision`.
  It runs against the public-safe in-memory demo core (no DB, no live calls).
  Build with `pnpm --filter @workspace/mcp-server run build`, then point an MCP
  client at it:
  ```json
  { "command": "node", "args": ["<repo>/artifacts/mcp-server/dist/index.mjs"] }
  ```
- **`signalgrid-mcp` (device-posture source) — shipped, separate repo.** A distinct,
  standalone **read-only** MCP server (`DanFashauer/signalgrid-mcp`, Python, released
  at `v1.0.2`, **22 tools**) that reads **macOS device security posture**
  directly from the endpoint — firewall, stealth mode, FileVault, SIP, Gatekeeper,
  and similar.

  That tool count is no longer hand-copied. It said "18 tools, 30 tests" — a
  transcription of another repo that nothing here could check, and both numbers had
  drifted (22 tools; the test figure was counting something else). `pnpm run
  verify:all` now DERIVES the count from the `signalgrid-mcp` checkout it already
  locates for the contract test and fails on drift. With no checkout present it
  prints the count as UNVERIFIED and says so — it does not assert a number it did
  not read. The test count is gone rather than corrected: `def test_` functions and
  pytest's collected total are different quantities, and a figure whose definition
  is ambiguous cannot be checked.

  It is the mirror image of the in-repo server: that one exposes
  SignalGrid *as* tools; this one is a *signal source*. Because it collects posture
  straight from the device rather than through a vendor API, it is the concrete
  example of the **`grid_collected`** sourcing path (see
  [Signal sourcing](SIGNAL_SOURCING.md) — "the Grid does the lifting"). It is a
  shipped companion/reference, read-only and honest about "unknown" (a check that
  can't run returns unknown, never a false green); it is **not** wired into the
  decision core here.
  (or `pnpm --filter @workspace/mcp-server run dev` for tsx watch).

If you tell me the specific system you want to connect (a UEM, a badge reader, a
nurse-call system, an assistant), the right answer is usually a small connector
that emits normalized signals plus a webhook subscription for the decisions back
out — and I can scaffold that.
