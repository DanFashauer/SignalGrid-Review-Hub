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

`health/` (liveness + readiness), `v1/` (keys, context, the three seeded
evaluate scenarios — compliant, noncompliant, stale — decisions, evidence,
sessions lifecycle, metrics, policies), and a representative
`control-plane/` slice (health, tenants, grid coverage, flows health). The
full route inventory is `docs/API_CONTRACT.md`. Requests name paths
verbatim, and `node scripts/check-api-collection.mjs` fails when any
collection path no longer matches a route registered in
`artifacts/api-server/src/routes/` — run it whenever either side changes.
