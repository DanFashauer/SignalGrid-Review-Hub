# Deployment — durable stack

How to run the SignalGrid API with **durable Postgres persistence** turned on.
Public-safe: the stack makes no external vendor calls by default.

## One command

```bash
docker compose -f docker-compose.prod.yml up --build
```

This builds the API image (`Dockerfile.api`) and starts two services:

- **db** — `postgres:16` with a persistent volume.
- **api** — the SignalGrid API on `:8080`, wired to Postgres.

The API is then at `http://localhost:8080` (health: `/api/healthz`, metrics: `/metrics`).

## What turns durability on

The persistence layer (audit ledger, decision + evidence store, session store) is
**gated on `DATABASE_URL`**. With it set (as the compose file does), those records
persist to Postgres and survive a restart. With it unset, the API runs entirely
in-memory (the fixture-safe default used by the public build and CI).

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string. Set ⇒ durable persistence on. | unset (in-memory) |
| `SIGNALGRID_TIER` | `dev` \| `alpha` \| `beta` \| `prod`. | `dev` |
| `SIGNALGRID_LIVE_INTEGRATIONS` | `true` only permits live vendor calls, and only on `beta`/`prod`. | unset (off) |
| `PORT` | API listen port. | `8080` |
| `LOG_LEVEL` | pino log level. | `info` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call `/v1`. | none (deny all cross-origin) |
| `OIDC_ISSUER` | Enterprise IdP issuer. Set ⇒ OIDC/JWT bearer auth on for `/v1`. | unset (demo keys) |
| `OIDC_AUDIENCE` | Expected token audience (the API's app/client id). | unset |
| `OIDC_JWKS_URI` | IdP JWKS endpoint (discovery `jwks_uri`). | unset |
| `OIDC_TENANT_CLAIM` / `OIDC_ROLE_CLAIM` | Claims carrying the IdP tenant / role. | `tid` / `roles` |
| `OIDC_TENANT_MAP` / `OIDC_ROLE_MAP` | JSON maps: IdP value → internal tenant id / role. | unset |
| `GRAPH_ACCESS_TOKEN` | Read-only Microsoft Graph token for the posture connector. | unset (fixture mode) |
| `CARRIER_ACCESS_TOKEN` | Read-only carrier/IoT-connectivity token for the reachability connector. | unset (fixture mode) |

## Enterprise sign-in (OIDC) — gated

With `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI` set, the `/v1` surface also
accepts a real **OIDC JWT** bearer: the token's **RS256 signature** is verified
against the IdP's JWKS and its **issuer / audience / expiry** are enforced, then
the verified claims are mapped (`OIDC_TENANT_MAP` / `OIDC_ROLE_MAP`) to a
tenant-scoped principal. `alg:none` and HMAC (`HS*`) tokens are rejected outright
(algorithm-confusion defense). With the OIDC vars unset — the default — the API
keeps using the public-safe demo bearer keys and nothing here runs. Wiring it to a
real Entra/Okta/Auth0 tenant is a one-time configuration step, no code change.

## Read-only Microsoft Graph connector — gated

The read-only Graph posture connector reads **users + managed devices** and
normalizes them to SignalGrid's posture vocabulary. It is **read-only by
construction** (only GET requests are issued) and **gated exactly like every
other integration**: it makes live Graph calls only on `beta`/`prod` **and** with
`SIGNALGRID_LIVE_INTEGRATIONS=true` **and** `GRAPH_ACCESS_TOKEN` set — otherwise it
runs in offline **fixture mode**. So it is safe to stand up for evaluation with no
tenant, and its normalization/pagination/error paths are proven offline in CI
(`pnpm run proof:graph-connector`).

## Post-exit reachability (carrier connectivity) — gated

Once a shared device leaves managed Wi-Fi, MDM "find/ring/lock" commands become
opportunistic. The read-only **carrier reachability connector** reads per-SIM
session + last-seen state from a carrier/IoT platform (shaped for Verizon
ThingSpace, Cisco IoT Control Center, Twilio Super SIM), and a **pure,
deterministic evaluator** turns it into a posture (`reachable` / `degraded` /
`unreachable` / `wifi_only_blindspot`) plus the single self-managing playbook
action it warrants (`monitor` / `locate` / `alert` / `escalate`) — so a lost
device becomes a self-triaging event instead of something an admin must chase.
Read-only by construction and gated exactly like every other integration (live
only on `beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true` + `CARRIER_ACCESS_TOKEN`;
otherwise fixture mode). Proven offline in CI (`pnpm run proof:carrier-reachability`).

**Fixture-safe by default:** even at `SIGNALGRID_TIER=prod`, no live vendor calls
are made unless `SIGNALGRID_LIVE_INTEGRATIONS=true` is also set — so this stack is
safe to stand up for evaluation without any external credentials.

## Schema

Tables are created automatically on first connect. Canonical migrations live in
`lib/persistence/migrations/` and `lib/audit/migrations/` for use with a
migration tool in a managed deployment.

## How it's validated

The `deploy-stack` CI job builds this exact image, brings up the api+Postgres
stack, and runs `scripts/smoke-stack.mjs` against it — evaluating a real
decision, reading it back from Postgres, verifying its evidence, confirming
cross-tenant isolation, and scraping `/metrics`. The same smoke script runs
against any running stack (`BASE_URL=… node scripts/smoke-stack.mjs`).

## Not included here (needs your infrastructure)

Managed secrets, TLS termination / a reverse proxy, backups and restore testing,
centralized log shipping, and alerting are deployment-environment concerns owned
by whoever operates the stack — see `docs/SECURITY_CONTROLS_MATRIX.md` for the
full production-controls picture.
