# Bruno API testing — the contract plane's operator manual

Plane 1 of the three-plane architecture (`docs/MCP_ARCHITECTURE.md`): the
committed Bruno workspace at `artifacts/api-collection/` is the canonical map
of what the API serves and what it refuses. This document is how to use it and
why it is shaped the way it is; the collection's own
`artifacts/api-collection/README.md` carries the counts and the folder-level
detail.

## Why Bruno

Every request is a plain-text `.bru` file in git, reviewed in the same PR as
the route it exercises — not a JSON blob in someone's cloud account. The
contract and the code move together or the gate fails.

## How the collection is organized

- **`health/`** — liveness and readiness probes, no auth.
- **`v1/`** — the launch-surface `/v1` routes: keys, context, the three seeded
  evaluate scenarios (compliant / noncompliant / stale), decisions and their
  evidence, the sessions lifecycle, metrics, policies (+ versions + tests),
  connectors (+ sync), audit.
- **`control-plane/`** — the representative `/cp/v1` slice. Review-demo only.
- **`review-demo/`** — every route that exists only under the default
  `review-demo` profile; under
  `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` these paths 404 by
  design.
- **`negative-tests/`** — requests that MUST fail correctly, each asserting
  its exact expected status. See below.
- **`artifacts/lab-collections/`** (a sibling root, NOT inside this
  collection) — standalone Bruno collections for the **external lab services**
  `scripts/run-live-lanes.sh` actually starts (Fleet, Traccar, Keycloak,
  Wazuh — `artifacts/lab-collections/README.md`). These map third-party
  surfaces, not api-server routes, and Bruno cannot run a collection that
  nests other collections, so they live outside — open each
  `artifacts/lab-collections/<service>/` directly in Bruno. A service gets a
  collection there only if `run-live-lanes.sh` starts it; everything
  aspirational stays in `docs/OPEN_SOURCE_LAB_REGISTRY.md` as
  `DEFERRED_RESEARCH` with no folder.

## The gate — two-directional coverage

`node scripts/check-api-collection.mjs` (preflight + CI) enforces the
contract in both directions, because one-directional coverage rots in exactly
the way a one-directional check cannot see:

1. **Collection → routes.** Every `.bru` URL must match a route registered in
   `artifacts/api-server/src/routes/` — exact method+path pairs after
   normalization (`{{var}}` and `:param` both become `*`), never suffix
   matching, comments stripped so a commented-out registration cannot keep a
   request alive, and only routers actually mounted in `routes/index.ts`
   count.
2. **Routes → collection.** Every registered route must carry at least one
   request, or stand in the gate's declared-exceptions list with a reason a
   reviewer can weigh and a date. The bar for an exception is "cannot be
   exercised from a request/response collection at all" (an SSE stream, a
   websocket upgrade) — not "awkward to demo". GA routes may **never** be
   excepted, and a stale exception (route gone, or since covered) is fatal, so
   the list can only shrink toward zero.

`--self-test` runs the gate against fixtures that prove **both directions can
fail** — a gate that cannot fail is not a gate. Run the check whenever either
side changes.

## Running requests locally

Against the fixture-mode server — no database, no credentials to obtain:

```bash
pnpm install
PORT=5310 pnpm --filter @workspace/api-server run dev
```

Then in Bruno: **Open Collection** → `artifacts/api-collection`, pick the
**Local** environment, and run `v1/Demo API keys` first — it lists the
public-safe fixture tokens, and the environment already carries the northwind
operator token as the default bearer, so every other request works
immediately. For the GA-fence negative test, start the server with
`SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` instead.

## The live run — the whole contract, executed

`node scripts/run-bruno-collection.mjs` executes the entire collection with
the real Bruno CLI (`@usebruno/cli`, a devDependency of the scripts package)
against an api-server it boots itself: one pass under the `review-demo`
profile (where the fenced routes serve and the `sgk_demo_*` fixtures
authenticate — including the token-dependent negative tests), one pass under
`shared-device-gateway` (where the profile fence 404 and the no-token 401
prove). It fails on any transport error, any 5xx, any failed assertion, and
on a zero-request run — an empty run must never read as a green one. Results
land under `artifacts/bruno/` (gitignored: a run record, not a committed
claim). Agents can trigger the same harness over MCP via
`bruno_collection_run`. Its first-ever full run caught a real server defect:
a malformed WebAuthn enrollment body answered 500 where fail-closed demands a
clean refusal — fixed in `lib/webauthn` the same day, which is the argument
for running the paper against the server and not only against itself.

## Negative-test philosophy — a refusal on schedule

A passing negative test is not the absence of a result; it is **a refusal
happening on schedule**. Each file in `negative-tests/` asserts the exact
status the route handler promises, read from the handler rather than guessed:
no bearer is a 401 and never a default tenant; another tenant's decision id is
the **same 404** as a nonexistent one, so existence never leaks as a 403;
partial evaluate input is a clean validation 400, never a decision; and the
gateway fence 404s everything outside the GA allowlist. The WebAuthn
verify/complete requests follow the same logic from the positive side: Bruno
cannot perform a native authenticator gesture, so the fail-closed 403 those
routes return **is** the exercisable contract, and the requests stay in the
covered set asserting it. When a negative test fails, the API has become more
permissive than its contract — the exact defect class this plane exists to
catch first.

## The no-credentials rule

Nothing in any collection is, or may ever become, a real secret:

- `sgk_demo_*` bearers are **intentionally public fixture tokens**, shipped in
  the demo seed (`lib/signalgrid-core/src/seed.ts`) precisely so reviewers can
  drive the API without credentials. A production core never exposes raw
  tokens (`demoApiKeys()` throws off demo mode).
- The `artifacts/lab-collections/` environments carry only **documented container image
  defaults** — `wazuh`/`wazuh` is the wazuh-manager image's documented default
  API credential, `admin`/`admin` is Keycloak's `KC_BOOTSTRAP_ADMIN_*`
  container default (both per the repo's standing `.gitleaksignore`
  precedent) — plus the per-run lab bootstrap account that
  `scripts/run-live-lanes.sh` itself mints into a localhost container.
- If a request would need a credential that does not fit those categories, the
  request does not belong in the collection. Full scope rules:
  `artifacts/lab-collections/README.md`.
