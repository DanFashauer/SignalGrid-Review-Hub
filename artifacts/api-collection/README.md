# SignalGrid API collection (Bruno)

A committed, reviewable API workspace for anyone who needs to hit the
SignalGrid API — [Bruno](https://github.com/usebruno/bruno) (MIT) stores
every request as a plain-text `.bru` file, so the collection lives in git
next to the API it exercises instead of in someone's cloud account.

## Use it

1. Install Bruno: <https://www.usebruno.com>.
2. Start the API in fixture mode:

   ```bash
   pnpm install
   PORT=5310 pnpm --filter @workspace/api-server run dev
   ```

3. In Bruno: **Open Collection** → this directory
   (`artifacts/api-collection`). Pick the **Local** environment.
4. Run `v1/Demo API keys` first — it lists the public-safe fixture tokens.
   The environment already carries the northwind operator token as the
   default bearer, so everything else works immediately.

## What the tokens are

`sgk_demo_*` values are **intentionally public fixture tokens**, shipped in
the demo seed (`lib/signalgrid-core/src/seed.ts`) so reviewers can drive the
API without credentials. They are not secrets; a production core never
exposes raw tokens (`demoApiKeys()` throws off demo mode).

## Coverage

**Every registered route has at least one request, and a gate enforces it in
both directions.** As of 2026-08-21 that is 77 distinct method+path pairs
across 83 request files (evaluate carries three scenario variants; four
requests are deliberate negative tests), with zero declared exceptions.

- `health/` — liveness + readiness probes (no auth).
- `v1/` — the launch-surface `/v1` routes: keys, context, the three seeded
  evaluate scenarios (compliant, noncompliant, stale), decisions + evidence,
  sessions lifecycle, metrics, policies + versions + tests, connectors +
  sync, audit.
- `control-plane/` — the original representative `/cp/v1` slice (health,
  tenants, grid coverage, flows health). Review-demo only, like everything
  under `review-demo/`.
- `review-demo/` — every route that exists only under the default
  `review-demo` profile: the deferred `/v1` routes (reconcile, simulate,
  resolution, policy authoring, webhooks, remediation, app-workflows, the
  WebAuthn step-up ceremony), plus `integrations/`, `monitoring/`,
  `simulator/`, `radar/`, `sim/`, and the remaining 20 `control-plane/`
  routes. Under `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` these
  paths 404 by design — see `review-demo/README.md`.
- `negative-tests/` — requests that MUST fail correctly (401 unauthenticated,
  404 cross-tenant, 400 malformed, 404 behind the GA fence), each asserting
  its expected status. See `negative-tests/README.md`.

The WebAuthn verify/complete requests send placeholder attestations and meet
the fail-closed 403 — Bruno cannot perform a native authenticator gesture, and
the refusal is itself the contract those routes promise. The served-contract
audit is `docs/API_CONTRACT_AUDIT.md`.

`node scripts/check-api-collection.mjs` is the enforcement: it fails when any
collection path matches no registered route AND when any registered route in
`artifacts/api-server/src/routes/` has no request (a route may only opt out
via the checker's declared-exceptions list — reason + date required, GA
routes never exceptable, stale exceptions fatal). Run it whenever either side
changes; `--self-test` proves both directions can fail.

The lab-service collections are different in kind and live OUTSIDE this
collection, at `artifacts/lab-collections/`: standalone Bruno collections for
the **external lab services** `scripts/run-live-lanes.sh` actually starts
(Fleet, Traccar, Keycloak, Wazuh). Those are third-party surfaces, not
api-server routes — and Bruno cannot run a collection that nests other
collections (their environments parse as requests from the parent, which is
why they moved). Open each `artifacts/lab-collections/<service>/` directly in
Bruno. Scope and credential rules live in `artifacts/lab-collections/README.md`.
