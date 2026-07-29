# Branching & Environments — the four-tier pipeline

SignalGrid promotes code through four long-lived tiers. Each is a protected
branch **and** a deployment environment. Code only ever moves **upward**, via
pull request, after CI is green.

```
dev  ──PR──▶  alpha  ──PR──▶  beta  ──PR──▶  prod
                                       (protected, stable)
```

> **This is the designed model, and the repository does not currently run it.**
> Two independent things stand between the diagram and reality, and it is worth
> keeping them apart because only one of them is a problem.
>
> **1. The tiers are not fed.** `SignalGrid_Alpha` is the default branch and the
> branch every merged PR lands on; the four tier branches are all pinned to the
> `Merge PR #65` commit and have not moved since. Promotion only ever moves commits
> *between tiers*, so while `dev` itself is behind, every promotion has an empty
> diff and nothing to carry. **Promote Tier** now reports each tier's actual
> position in its run summary — dispatch it to see the current gap, which it
> measures live rather than quoting a number that would go stale here.
>
> **2. Actions cannot open pull requests, and that is fine.** The repository has
> *Settings → Actions → General → "Allow GitHub Actions to create and approve pull
> requests"* off, which is GitHub's default and the safer posture. The workflow's
> own `pull-requests: write` grant cannot override it. Rather than fail, the
> workflow now hands back the compare link that opens the same PR in one click.
> Enabling the setting is optional and buys only convenience.
>
> Reconnecting the pipeline — item 1 — is an owner decision with three defensible
> answers, and it is deliberately not made in code: **feed `dev`** from
> `SignalGrid_Alpha` (keeps the model, needs the tier branches fast-forwarded);
> **re-point the default** to `dev` so work lands at the pipeline's entry point
> (see `docs/OWNER_ACTIONS.md` §3); or **retire the tier branches** and treat
> `SignalGrid_Alpha` plus per-environment config as the whole deployment story.
> Until one is chosen, read the table below as intent, not as current state.

| Tier | Branch | Purpose | Live integrations |
| ---- | ------ | ------- | ----------------- |
| **dev** | `dev` | Active development; every feature branch targets `dev`. | **Never** — always fixture-safe |
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
