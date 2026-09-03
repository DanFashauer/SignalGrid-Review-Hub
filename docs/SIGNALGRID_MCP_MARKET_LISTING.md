# SignalGrid Fabric MCP — marketplace listing

**Scope.** Nothing here is a claim of current capability. SignalGrid's MCP server is a
**public-safe prototype, not a production or certified service**, and this listing does
not claim any partnership, customer, or certification. It describes the read-only MCP
server this repository already ships at `artifacts/mcp-server/` — what it exposes and
how to run it — so the owner can offer it as a solution on his own creator page.

This is the copy for that listing plus the honest boundary around it. The tool surface
it describes is the real one: the set enumerated and drift-gated by
[`scripts/check-mcp-surface.mjs`](../scripts/check-mcp-surface.mjs), which fails the
build if the server, its docs, its ready message, and the live-sync manifest ever
disagree — so this listing cannot quietly overstate the tools. The architecture behind
it is [`docs/MCP_ARCHITECTURE.md`](MCP_ARCHITECTURE.md) (DR-008: *MCP is an
orchestration interface, not a new trust authority*) and its security posture is
[`docs/MCP_SECURITY_MODEL.md`](MCP_SECURITY_MODEL.md).

---

## Listing copy (paste this)

**Name:** SignalGrid Fabric MCP

**One-line pitch:** Query a deterministic, fail-closed access-decision fabric over
MCP — ask the grid what a signal means, and get a verdict with its reason codes and
audit evidence.

**Short description:**
SignalGrid Fabric MCP exposes a deterministic, fixture-backed decision core as
read-only Model Context Protocol tools. An assistant or agent can run trusted-entry
scenarios, evaluate an explicit identity/device/workflow, grade one location
observation against the precision a workflow needs, inspect connectors, policies and
the tamper-evident audit ledger, check evidence freshness, and read what the fabric
models today — all against a public-safe in-memory demo core with no database, no live
vendor calls, and no real credentials. Every tool reads or evaluates; none mints a
verdict the core did not compute, and none mutates state that outlives the process.

**Tool families it exposes** (confirmed against `artifacts/mcp-server/src/index.ts`):

- **Decision evaluation** — run the real decision core for a scenario or for an
  explicit identity/device/workflow, and get the outcome, reason codes and explanation.
- **Room / location certainty** — list synthetic trusted-entry scenarios and grade a
  single location observation against a workflow's required precision (the multi-bed
  rule), fail-closed on anything unstated.
- **Evidence freshness & explanation** — report when a decision's evidence was
  captured, whether its tamper-evident digest still verifies, and each reason code's
  catalog entry.
- **Audit query** — read the tenant's tamper-evident audit chain with the chain's own
  verification verdict alongside, so a filtered read never outruns its integrity.
- **Facility graph** — inspect the canonical space model and resolve a vendor
  identifier (Cisco / physical-access / EHR / RTLS) to the space it attaches to.
- **Connector / policy listing** — list seeded connectors with their health, and
  policies with their versions (read-only: activation and drafting exist on the core
  but are deliberately not exposed over MCP).
- **Signal catalog / scan** — list the signal categories the grid evaluates and the
  roadmap candidates, and classify a batch of incoming signals to discover new ones.
- **Contract-plane bridge** — list and read the committed Bruno API collection, and
  run it as one harnessed, localhost-only fixture-server pass.

**Transport:** stdio (a local child process). The MCP client config is
`{ "command": "node", "args": ["<repo>/artifacts/mcp-server/dist/index.mjs"] }`.

**Configuration:** environment variables only — the owner's Mac launcher resolves the
server through `SIGNALGRID_MCP_PATH`. **No secrets, no API keys, and no tenant IDs are
required or accepted**: the server runs against the public-safe demo core, and live
vendor integrations stay off (`SIGNALGRID_LIVE_INTEGRATIONS` unset/false) by
construction. The `sgk_demo_*` tokens it uses are intentionally-public fixtures.

**Boundary (read before installing):** SignalGrid Fabric MCP is a fixture-backed
deterministic decision core — a public-safe prototype, not a production or certified
service. It does not replace an IdP, EDR, SIEM, ITSM, NAC, UEM, or physical-access
system; it decides on top of the signals those systems produce. Over MCP it only reads
and evaluates: no tool mutates durable state, activates a policy, approves a
remediation, or writes to any vendor surface. There is no authentication layer because
the process boundary is the boundary (stdio, local child process) — do not expose it as
a network service; HTTP transport and OAuth-scoped access are deferred design intent
only (see the security model).

---

## Publishing

This document is the listing text for **`app.mcpmarket.com/dan-fashauer/mcp/new`**.
The creator/deploy side of MCP Market is authentication-walled, so **only the owner can
publish it** — he has the login. To publish:

1. Open `app.mcpmarket.com/dan-fashauer/mcp/new` while signed in.
2. Paste the fields from *Listing copy (paste this)* above — name, pitch, description,
   tool families, transport, configuration, and the boundary paragraph verbatim (the
   boundary is not optional; it is what keeps the listing honest).
3. Point the install/run instructions at the stdio command above; keep the env-only,
   no-secrets configuration exactly as written.

Nothing in this repository publishes on the owner's behalf, and no credential for the
creator page lives in the tree. Keeping the listing accurate is a matter of re-running
`scripts/check-mcp-surface.mjs` before each publish and copying the current tool set —
never hand-counting it here, so the number cannot drift.
