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
