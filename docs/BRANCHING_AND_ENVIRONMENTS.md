# Branching & Environments — the four-tier pipeline

SignalGrid promotes code through four long-lived tiers. Each is a protected
branch **and** a deployment environment. Code only ever moves **upward**, via
pull request, after CI is green.

```
dev  ──PR──▶  alpha  ──PR──▶  beta  ──PR──▶  prod
(default)                              (protected, stable)
```

| Tier | Branch | Purpose | Live integrations |
| ---- | ------ | ------- | ----------------- |
| **dev** | `dev` (default) | Active development; every feature branch targets `dev`. | **Never** — always fixture-safe |
| **alpha** | `alpha` | Internal validation of a `dev` snapshot. | **Never** — always fixture-safe |
| **beta** | `beta` | Pre-production / design-partner validation. | Gated: only with `SIGNALGRID_LIVE_INTEGRATIONS=true` + real creds |
| **prod** | `prod` | Stable production. Protected; requires review + green CI to merge. | Gated: only with `SIGNALGRID_LIVE_INTEGRATIONS=true` + real creds |

## How the tier is set

Each environment sets `SIGNALGRID_TIER` (see `config/tiers/<tier>.env.example`).
The api-server resolves it (`artifacts/api-server/src/lib/tier.ts`, defaults to
`dev`) and reports it at `GET /api/healthz` (`{ status, tier, liveIntegrations }`).

**Fixture-safe by default:** `isLiveIntegrationsEnabled()` returns `false` for
`dev`/`alpha` no matter what, and `false` for `beta`/`prod` unless
`SIGNALGRID_LIVE_INTEGRATIONS=true`. So CI and the lower tiers stay deterministic
and offline; real vendor calls only ever happen in an explicitly-configured
beta/prod deploy.

## Promotion

- Merge feature work into `dev` (green CI required).
- Promote `dev → alpha → beta → prod` via PR — the **Promote Tier** workflow
  (`.github/workflows/promote.yml`, `workflow_dispatch`) opens the next-tier PR
  for you. Each promotion PR runs the full CI + scheduled-verification gate suite.
- `prod` (and ideally `beta`) are branch-protected: no direct pushes, review +
  green checks required. (Branch protection is configured in repo settings.)

## Deployment

Each tier deploys the same monorepo build with its own `config/tiers/<tier>.env`.
The Docker topology (`docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`,
`nginx.conf`) is tier-agnostic — only the environment file differs per tier.
