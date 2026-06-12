# Simulator Validation Runbook

## Local setup

```bash
pnpm install --frozen-lockfile
```

## Start commands

Review Hub:

```bash
pnpm --filter @workspace/signalgrid-review run dev
```

Review Hub plus simulator API:

```bash
pnpm run dev:simulator
```

API server:

```powershell
$env:PORT=5174; pnpm --filter @workspace/api-server run dev
```

## URLs

- Review Hub: http://localhost:5173
- API health: http://localhost:5174/api/healthz
- API static integrations: http://localhost:5174/api/integrations
- Simulator scenarios: http://localhost:5174/api/simulator/scenarios
- Simulator audit: http://localhost:5174/api/simulator/audit

## Simulator scenarios

Run each scenario from the Review Hub simulator section or with:

```bash
pnpm run proof:signalgrid-simulator
```

Expected coverage:

- Healthy shared device checkout produces allow and audit evidence.
- Apple DDM and Platform SSO state produces allow and audit evidence when declared state, identity, workflow, and audit-event fixtures align.
- Non-compliant clinical shared device produces restrict, ticket, operator alert, and audit evidence.
- Stale check-in produces step-up/review and posture-refresh request.
- Wrong-zone RTLS event alerts the operator and routes to the local owner.
- Dock missing or overdue device creates an owner-routed ticket/action.
- Low battery workflow impact routes to the operator with a swap/return recommendation.
- Operational health degradation routes to DEX/EUC without denial by default.
- EDR/security risk restricts/reviews and escalates to security.
- API/integration outage queues/retries in simulation and alerts the platform owner.
- Remediation verified produces allow candidate, verification evidence, and audit record.

## Validation commands

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
git diff --check
```

## Known limitations

- Simulator data is deterministic fixture data.
- API simulator routes are in-memory and reset when the server restarts.
- DB-backed API routes intentionally return 503 without DATABASE_URL.
- Real Microsoft Graph, DEX, RTLS, ITSM, DockBridge, EDR, and mobile implementations remain future private-core or local follow-up work.
- Vite sourcemap or large chunk warnings may remain non-blocking.

## Intentionally simulated

- Identity signals.
- Apple DDM, Platform SSO, configuration, enrollment, and management audit-event signals.
- Device posture signals.
- Operational health and DEX-style signals.
- RTLS/location events.
- DockBridge events.
- Ticket and alert routing.
- Remediation verification.
- Audit evidence.

## Future/private-core work

- Real source-system authentication and tenant isolation.
- Real connector access and rate-limit handling.
- Signed event integrity and replay protection.
- Production observability, support, and incident response.
- Mobile packaging and hardware/dock adapter validation.
