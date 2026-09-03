# The three-plane architecture — Bruno, MCP, and the deterministic core

Ratified 2026-08-21, owner-directed — DR-008 in
`docs/DECISION_RECORDS.md` is the decision record.
This document is the map; `docs/MCP_SECURITY_MODEL.md` is the security truth
for the middle plane, and `docs/BRUNO_API_TESTING.md` is the operator's manual
for the first.

Three planes, three different jobs, and the whole point is that they never
collapse into each other:

> **Bruno proves the API. MCP gives agents controlled access to the API.
> SignalGrid determines what the evidence means.**

and its corollary, which is the load-bearing one:

> **MCP is an orchestration interface, not a new trust authority.**

An agent talking to SignalGrid over MCP gets *access* — it never gets a vote.
The verdict comes from the deterministic core or it does not exist.

## Plane 1 — the API contract plane (Bruno)

The served API's contract lives as a committed, reviewable Bruno workspace:
`artifacts/api-collection/` — plain-text `.bru` files in git, one per request,
next to the routes they exercise. `scripts/check-api-collection.mjs` enforces
coverage in **both directions**: every collection path must match a registered
route, and every registered route must carry at least one request (or a
declared exception with a reason and a date; GA routes may never be excepted).
The collection therefore cannot quietly become documentation of an API that no
longer exists, and a new route cannot ship unmapped. `negative-tests/` pins
the refusals (401/404/400 and the GA fence), `adversarial-trust/` executes
the no-unearned-affirmative doctrine per attack; the standalone collections for
the external lab services `scripts/run-live-lanes.sh` actually starts live at
`artifacts/lab-collections/` — third-party surfaces, deliberately outside both
this collection and its route gate. Details and run instructions:
`docs/BRUNO_API_TESTING.md`.

This plane answers one question: **what does the API actually serve, and does
it refuse what it promises to refuse?** Nothing on this plane evaluates
anything; it maps and asserts.

## Plane 2 — the agent interoperability plane (MCP)

Two MCP servers exist, in two repositories, and they are different in kind.
Naming both honestly matters, because a reader who conflates them will
misjudge what each one can do:

- **The in-repo fabric server** — `artifacts/mcp-server/` (TypeScript, stdio).
  Exposes the decision fabric *as tools* to an MCP client: room scenarios, the
  signal catalog and radar, direct decision evaluation, the Facility Trust
  Graph, and derived fabric status. It runs against the public-safe in-memory
  demo core — no database, no live vendor calls, no real credentials. The
  owner's Claude Desktop reaches it through `scripts/mac/mcp-up.sh`, the
  self-updating launcher, and `scripts/check-mcp-surface.mjs` fails the build
  when the registered tool list drifts from `docs/RUN_ON_MAC.md` or the
  live-sync manifest.
- **The public sibling** — the separate `signalgrid-mcp` repository
  (`DanFashauer/signalgrid-mcp`, Python): a **read-only macOS device-posture
  server**. It is not a second door into the fabric; it is a *signal source* —
  it reads a real Mac's security posture so the grid has true evidence to
  normalize. Its tool count is derived from an actual checkout by
  `pnpm run verify:all` (printed UNVERIFIED when no checkout is present, never
  guessed), and `docs/LIVE_SYNC_LOOP.md` describes how the owner's Mac runs it
  against this repo's contract.

The split, stated plainly: the in-repo server lets agents **ask the grid**;
the sibling lets the grid **read a device**. Neither one decides anything. A
tool result from either plane-2 server is input or output of the trust plane,
never a substitute for it.

### MCP and skills are different instruments

A skill is not a smaller MCP server and an MCP tool is not a stricter skill. In this
repository the two carry different responsibilities, and confusing them is how a rule of
conduct ends up as a tool nobody calls, or a capability ends up as prose nobody can
invoke:

- **MCP (`artifacts/mcp-server/`)** exposes capabilities of an external system to a model
  over a client/server protocol. Here the "external system" is SignalGrid's own
  fixture-backed decision core, and the tools are read-only (see
  [MCP security model](MCP_SECURITY_MODEL.md)). The model decides *whether* to call one;
  the tool decides nothing about trust (DR-008).
- **Skills (`.claude/skills/`)** are instruction files a model selects by their metadata.
  They shape the workflow, the output format and the constraints of the work: the role
  executors, the owner-comms rules, the session rituals. A skill can *use* MCP tools; it
  never exposes a capability of its own. The registry holds 24 tracked directories, 14
  vendored and 10 first-party, and `.claude/skills/VENDORED.md` is the record of which is
  which (gated by the publication boundary's vendored-set arithmetic).

So: a new capability that a model should be able to reach lands as an MCP tool behind the
same read-only, fixture-first rules as the rest of Plane 2; a new rule about *how* the
organisation works lands as a skill. Neither one moves the trust boundary in Plane 3.

## Plane 3 — the trust authority plane (the deterministic core)

`lib/signalgrid-core` — deterministic, fixture-backed, fail-closed. No
`Date.now()`/`Math.random()` in decision paths; an unknown or unreachable
signal raises assurance requirements, never lowers them; `pnpm run
review:invariants` and `pnpm run proof:signalgrid-simulator` keep it honest.
This plane owns the only question that matters: **what does the evidence
mean?** Bruno can prove a route serves; MCP can carry a request from an agent;
only the core can turn normalized evidence into allow / step_up / restrict /
deny.

## The evidence boundary, with the planes overlaid

Every external system relates to SignalGrid through exactly one boundary (the
canonical statement lives in `docs/OPEN_SOURCE_LAB_REGISTRY.md`, machine form
in `docs/agent/open-source-lab-registry.json`, gated by
`scripts/check-lab-registry.mjs`):

```
  external system          source adapter           SignalGrid core (Plane 3)
  (Fleet, Traccar,   ──▶   normalized evidence ──▶  freshness + provenance +
   Keycloak, Wazuh,        (signals, never           contradictions
   signalgrid-mcp           verdicts)                      │
   posture reads)                                          ▼
        ▲                                          deterministic policy
        │                                                  │
  Plane 1 (Bruno, lab colls)                                ▼
  maps + asserts these                                  VERDICT
  surfaces; changes nothing                    allow / step_up / restrict / deny
                                                           │
                                                           ▼
  Plane 2 (MCP) ◀──────────────────────────  agents read scenarios, evidence,
  orchestration interface                    and verdicts through tools —
                                             they never mint a verdict
```

Trust flows left to right and is minted in exactly one place. Plane 1 sits
beside the pipe proving its shape; Plane 2 gives agents a controlled window
into it; Plane 3 is the pipe's only judge.

## Built today vs. deferred

**Built and running today** (everything in present tense above is on this
list):

- The Bruno collection with two-directional route coverage
  (`scripts/check-api-collection.mjs`, `--self-test` proves it can fail),
  negative tests, and the `artifacts/lab-collections/` lab collections.
- The in-repo stdio MCP server, its `mcp-up.sh` launcher, and the
  `check-mcp-surface.mjs` drift gate.
- The `signalgrid-mcp` posture source in its own repository, with its tool
  count derived — not asserted — by `verify:all`.
- The deterministic core and its invariant/proof gates.
- **The Bruno execute-bridge** (`bruno_collection_run`): an agent can run the
  committed collection as ONE harnessed run — `scripts/run-bruno-collection.mjs`
  runs `pnpm --filter @workspace/api-server run build` (writing `dist/`), boots
  its own fixture-mode api-server on a localhost port, executes every request
  under both product profiles (negative tests included), tears it down, and
  writes a gitignored results file under `artifacts/bruno/`. It is the one tool
  here that is **not read-only** — it builds, spawns a subprocess, and writes
  files, and carries `readOnlyHint: false` to say so (see
  `docs/MCP_SECURITY_MODEL.md`). Its traffic is localhost only, it reaches no
  external peer, and no product, tenant, or vendor state and nothing committed
  changes; the harness's verdict is the tool's answer.

**Deferred — design intent only, not served, and no document may use present
tense for these.** No gate scans for this specific drift yet — the ban is
doctrine, held by review (the docs-sanity denylist and the false-claims
registry cover other claim classes, not these):

- **HTTP transport for the in-repo MCP server.** Today it is stdio only.
- **OAuth scopes / tenant-bound authorization for MCP access** (the
  `signalgrid:evidence:read` shape). Today there is no MCP authentication
  layer at all, because the server is a local stdio child process — see
  `docs/MCP_SECURITY_MODEL.md` for why that is stated as a fact rather than
  dressed up as a feature.

Deferred items land, if they land, behind the same doctrine as everything
else: fail-closed, deterministic, and inside the frozen launch scope (DR-005)
— all three are tooling/company surface, not new product surface.

## What this architecture forbids

- **MCP mutation tools without approval gates.** The in-repo server's tools
  read and evaluate against the in-memory demo core; nothing mutates state
  that outlives the process. Adding a tool that changes durable state requires
  an explicit decision record first.
- **Agents deciding trust.** No agent output, tool result, or LLM judgment is
  ever an input that *bypasses* the core, and no MCP tool may return a
  verdict the core did not compute.
- **Collapsing planes.** Bruno does not evaluate; MCP does not certify the
  contract; the core does not grow an agent-facing bypass. A change that makes
  one plane do another plane's job is architecturally wrong even if it works.
