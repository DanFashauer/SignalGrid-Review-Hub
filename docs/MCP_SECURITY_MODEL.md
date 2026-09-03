# MCP security model — what protects the agent plane today, and what is only designed

Companion to `docs/MCP_ARCHITECTURE.md` (the three-plane map). This document
exists to keep one specific claim from ever drifting: **the current in-repo
MCP server has no authentication, and that is stated as a fact about a local
stdio process, not apologized for or papered over.** Honesty over aspiration —
the deferred enterprise model is described below, clearly marked deferred, and
nothing in it is served today.

## The current model — what is actually true

The in-repo server is `artifacts/mcp-server/` (TypeScript, single source file
`artifacts/mcp-server/src/index.ts`), and every property below is checkable
against that file and `scripts/mac/mcp-up.sh`:

- **stdio only.** The server speaks MCP over stdin/stdout
  (`StdioServerTransport`). There is no HTTP listener, no port, no network
  surface. Nothing remote can reach it because there is nothing to reach.
- **Local process, spawned by the client.** Claude Desktop (or any MCP
  client) launches the server as its own child process — on the owner's Mac,
  via `scripts/mac/mcp-up.sh`, which fast-forwards the branch, rebuilds when
  sources moved, and only then execs `node dist/index.mjs`. The launcher
  fails open to a *stale* build, never to a broken one, and never touches
  stdout (stdout is the MCP transport).
- **No authentication — deliberately, and here is why that is sound today.**
  The process boundary is the security boundary: only a program that can
  already execute code as the local user can spawn the server, and such a
  program already has strictly more power than any MCP tool grants. An auth
  layer on a local stdio child process would be theater. This stops being
  sound the moment a network transport exists, which is exactly why HTTP
  transport and the auth model below are one deferred unit, not two.
- **Public-safe data only.** The server runs `SignalGridCore.demo()` — the
  in-memory demo core with `sgk_demo_*` fixture tokens (intentionally public,
  shipped in `lib/signalgrid-core/src/seed.ts`). No database, no live vendor
  calls, no real credentials anywhere in the process.
- **Read-only tool doctrine — no mutation tools.** The registered tools list
  scenarios, read the signal catalog, classify signals, inspect the fixture
  facility graph, report fabric status, and run evaluations. An evaluation
  *computes* a verdict in the in-memory core; nothing any tool does survives
  process exit, and no tool changes durable product, tenant, or vendor state,
  reaches an external network peer, or writes any committed file. **One tool is
  not read-only, and says so:** `bruno_collection_run` executes the committed API
  collection by running `pnpm --filter @workspace/api-server run build` (writing
  `dist/`), booting a fixture-mode api-server on a localhost port, and writing a
  gitignored results file under `artifacts/bruno/`. It touches the filesystem and
  a localhost socket — never an external peer, never any committed or durable
  product state — and it carries `readOnlyHint: false` (`openWorldHint: false`)
  in its annotations, so no client is told it is read-only. Adding a *mutation*
  tool — one that changes durable product state — requires a decision record and
  an approval-gate design first (`docs/MCP_ARCHITECTURE.md`, "What this
  architecture forbids"). `scripts/check-mcp-surface.mjs` keeps the tool
  surface from drifting silently, so a new tool cannot appear without the
  docs and manifest moving with it — which is where a reviewer would catch a
  doctrine violation.
- **No secrets in collections.** The Bruno plane this server sits beside
  carries only fixture tokens and documented container image defaults
  (`artifacts/api-collection/README.md`, `sources/README.md`); the MCP server
  neither reads nor holds anything more sensitive than those same fixtures.

The public sibling `signalgrid-mcp` repository (the macOS posture *source* —
see the plane-2 split in `docs/MCP_ARCHITECTURE.md`) follows the same posture
for the same reason: a read-only, locally spawned stdio process on the
owner's own machine, reading that machine's posture.

## The deferred enterprise model — design intent, not description

Everything in this section is **DEFERRED**. None of it exists in this
repository today; none of it may be described in the present tense anywhere —
a ban no gate scans for yet, so it is doctrine held by review, not by a
script; and building it is outside the frozen launch scope (DR-005) until
a decision record says otherwise. It is written down so that when the work is
ratified it is designed rather than improvised — and so nobody mistakes the
design for the product.

- **HTTPS transport.** A network-served MCP endpoint, TLS-terminated, replacing
  nothing — stdio would remain for the local lane.
- **OAuth-based client authentication.** MCP clients would obtain tokens from
  the tenant's IdP; the server would validate them per request instead of
  trusting the process boundary (which a network transport dissolves).
- **Tenant-bound scopes.** Capability grants of the shape
  `signalgrid:evidence:read`, `signalgrid:scenarios:read`,
  `signalgrid:decisions:evaluate` — each token bound to one tenant, tools
  refusing (fail-closed, the same 404-not-403 non-leak posture the API's
  cross-tenant handling already proves in
  `artifacts/api-collection/negative-tests/`) anything outside its scopes.
- **Invocation audit.** Every tool call recorded — who, which tool, which
  arguments, which tenant — into the same audit surface the `/v1` API uses,
  so agent access is reviewable after the fact, not just gated before it.
- **Mutation tools behind approval gates.** If any tool is ever allowed to
  change durable state, it arrives only with an explicit human-approval step
  in the loop and its own decision record — the standing prohibition is in
  `docs/MCP_ARCHITECTURE.md` and the DR-008 draft.

The rule for readers and writers alike: if a sentence about MCP security
cannot be verified against `artifacts/mcp-server/src/index.ts` or
`scripts/mac/mcp-up.sh` as they stand, it belongs in this deferred section or
it does not belong in the repository.
