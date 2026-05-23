# SignalGrid

SignalGrid is the runtime decision layer for Zero Trust enforcement on shared frontline device fleets — evaluating signals from MDM, EDR, SIEM, and identity providers at the moment each workflow is triggered.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port varies per workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session signing key

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec) — generates React Query hooks + Zod schemas
- Build: esbuild (CJS bundle)
- Frontend: React 19 + Vite + Tailwind v4 + shadcn/ui + Framer Motion + Recharts

## Where things live

- `lib/db/src/schema.ts` — Drizzle schema (decisions, policies, signal_events tables)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers (decisions, policies, signals, integrations, metrics)
- `artifacts/signalgrid-web/src/pages/Home.tsx` — marketing site (8-section landing page)
- `artifacts/signalgrid-app/src/pages/` — operator dashboard pages (Dashboard, Decisions, Policies, Signals, Integrations)
- `artifacts/signalgrid-app/src/components/AppLayout.tsx` — persistent sidebar layout

## Architecture decisions

- OpenAPI-first: all API contracts defined in `lib/api-spec/openapi.yaml` before implementation. Frontend uses only generated hooks — no hand-written fetch calls.
- Simulation layer in API: decisions/signals/integrations are seeded with realistic data and the API simulates live telemetry. No external integrations required to demo.
- Dark-by-default dashboard: operator dashboard forces dark mode for the target persona (security engineers in SOC environments).
- Signal evaluation is synchronous in the current implementation — decisions are evaluated inline with the request. A future async queue pattern is documented in the threat model.

## Product

**Marketing site** (`/`) — 8-section dark landing page explaining SignalGrid's value proposition to IT security buyers. Sections: Hero, Problem, Signal Types, How It Works, Decision Engine, Integrations, Pricing, CTA.

**Operator Dashboard** (`/app`) — real-time Zero Trust monitoring dashboard for IT security engineers. Pages: Overview (metrics + chart + live feed), Decisions (filterable log + detail), Signals (live feed by type), Integrations (health grid + detail), Policies (CRUD management with rule editor).

**API** (`/api`) — Express 5 decision engine backend. Routes: `/decisions`, `/policies`, `/signals`, `/integrations`, `/metrics`.

## Preview paths

| Path | Artifact | Description |
|------|----------|-------------|
| `/` | signalgrid-web | Marketing website |
| `/app` | signalgrid-app | Operator dashboard |
| `/api` | api-server | Decision engine API |
| `/review` | signalgrid-review | Second-opinion review UI |

## Self-hosting (Docker Compose)

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and SESSION_SECRET
docker compose up -d
```

See `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`, `nginx.conf`.

## User preferences

- Dense, precise UI — information density over whitespace
- JetBrains Mono for all technical data (IDs, values, latency numbers)
- Inter for body text
- Dark navy palette: background HSL 222.2 84% 4.9%, primary HSL 217.2 91.2% 59.8%
- Border radius: 0.25rem (tight, near-square)
- No emojis anywhere in the UI

## Gotchas

- Workflows `signalgrid-web` and `signalgrid-app` may show as FAILED in the system but are actually running — the restart_workflow health check sometimes races the port open. Test with `curl http://localhost:80/` and `curl http://localhost:80/app/`.
- `pnpm run build` on artifacts requires `PORT` and `BASE_PATH` env vars (injected by workflows). Use `pnpm run typecheck` instead for CI-style checks from bash.
- Do NOT edit `lib/api-client-react/src/generated/` directly — always update `lib/api-spec/openapi.yaml` and run codegen.
- The signal evaluation loop (`lib/db` seeding) runs at startup for development — do not run `pnpm --filter @workspace/db run push` in production without a migration plan.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `threat_model.md` for security architecture and required guarantees
