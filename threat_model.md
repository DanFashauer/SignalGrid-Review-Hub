# Threat Model

## Project Overview

This repository is a small pnpm monorepo with a production Express 5 API (`artifacts/api-server`) and a production static React/Vite site (`artifacts/signalgrid-review`). The API currently exposes only a health endpoint and has PostgreSQL/Drizzle wiring available through `lib/db`, but no production route currently uses the database. A separate `artifacts/mockup-sandbox` app exists for design-time component previewing and should be treated as dev-only; per project assumptions, it is not deployed to production.

Production scope assumptions for future scans:
- `NODE_ENV` is `production` in deployed services.
- TLS is handled by the platform.
- The mockup sandbox is never deployed to production.
- Only production-reachable code paths should produce vulnerabilities.

## Assets

- **Service availability** — the API health endpoint and static site should remain reachable and should not expose process internals through crashes or verbose errors.
- **Application secrets** — `DATABASE_URL` and any future service credentials loaded from environment variables must stay server-side and must not leak through logs, bundles, or error messages.
- **Future business and user data** — the repository already includes shared database and API scaffolding, so future user records, uploaded content, or business data added to `lib/db` and `artifacts/api-server` will become high-value assets.
- **Trustworthy client bundles** — the production static frontend must not embed secrets, execute attacker-controlled content, or assume client-side controls are authoritative.

## Trust Boundaries

- **Browser to API (`/api`)** — all requests crossing into the Express app are untrusted and must be validated, authenticated where needed, and authorized server-side.
- **API to database (`lib/db`)** — the server has direct access to PostgreSQL through Drizzle; any future route using this layer must prevent injection and improper data exposure.
- **Build-time tooling to production artifacts** — generated API clients, Zod schemas, and frontend bundles are produced from shared code under `lib/`; mistakes in shared libraries can affect both server and clients.
- **Production vs. dev-only artifacts** — `artifacts/mockup-sandbox` and related preview tooling are outside production scope unless a future deployment path makes them reachable.

## Scan Anchors

- **Production entry points**
  - `artifacts/api-server/src/index.ts`
  - `artifacts/api-server/src/app.ts`
  - `artifacts/api-server/src/routes/**`
  - `artifacts/signalgrid-review/src/**`
- **Highest-risk shared code areas**
  - `lib/db/src/**`
  - `lib/api-client-react/src/custom-fetch.ts`
  - `lib/api-spec/openapi.yaml`
- **Current public surface**
  - Static site at `/`
  - API route `/api/healthz`
- **Dev-only areas usually out of scope**
  - `artifacts/mockup-sandbox/**`
  - Vite dev-server-only settings and preview helpers unless production reachability is demonstrated

## Threat Categories

### Tampering

The main tampering risk in this project is future acceptance of client-controlled data across the browser-to-API boundary. The current API is minimal, but any new route added under `artifacts/api-server/src/routes` must treat the client as untrusted, validate request data against explicit schemas, and enforce server-side business rules. Shared client helpers in `lib/api-client-react` must not be mistaken for a security boundary.

Required guarantees:
- All future API endpoints MUST validate request inputs server-side.
- Client-side state, route guards, and generated API helpers MUST NOT be treated as authorization controls.
- Any future database access MUST use Drizzle or equivalent parameterized queries rather than string-built SQL.

### Information Disclosure

The project already handles environment variables and request logging, so the main disclosure risks are leaking secrets or internal details through logs, bundles, or error responses. Production frontend bundles must never contain server secrets, and the API must continue to avoid logging cookies, bearer tokens, or stack traces to clients.

Required guarantees:
- Secrets such as `DATABASE_URL` and future API keys MUST remain server-side only.
- Request logs MUST redact authentication material and cookies.
- Production error responses MUST avoid exposing stack traces, raw database errors, or internal file paths.
- Static frontend code MUST not embed sensitive environment variables.

### Denial of Service

The current Express app exposes only a lightweight health endpoint, so denial-of-service risk is low today. As new API routes are added, public endpoints, authentication flows, and any expensive database or external-service operations will need explicit abuse controls.

Required guarantees:
- Public endpoints MUST remain cheap to evaluate or be protected with rate limits once they perform meaningful work.
- Future request parsers, uploads, and external-service calls MUST apply reasonable size, concurrency, and timeout limits.
- Health checks MUST not depend on attacker-controlled expensive work.

### Elevation of Privilege

There is no current authenticated or admin surface, but the repository is already structured for future growth. The highest future risk is adding routes that read or modify data without server-side authorization, or exposing shared preview/development utilities to production by accident.

Required guarantees:
- Any future authenticated or admin endpoint MUST enforce authorization on the server for every request.
- Production deployment configuration MUST keep `artifacts/mockup-sandbox` and other preview tooling out of the public runtime unless intentionally hardened and deployed.
- Shared libraries used by both frontend and backend MUST not blur trust boundaries; server-only capabilities and secrets must remain isolated from client bundles.
