# Branching & Environments — the four-tier pipeline

SignalGrid promotes code through four long-lived tiers. Each is a protected
branch **and** a deployment environment. Code only ever moves **upward**, via
pull request, after CI is green.

```
dev  ──PR──▶  alpha  ──PR──▶  beta  ──PR──▶  prod
                                       (protected, stable)
```

> **2026-09-02: the branch half of this model no longer exists. Read the table
> below as intent, and as the shape a future pipeline would take — not as
> current state.**
>
> **1. The tier branches do not exist any more, and neither does the promotion
> workflow.** `SignalGrid_Alpha` is the default branch and the branch every merged
> PR lands on. This paragraph said until 2026-09-02 that the four tier branches were
> "pinned to the `Merge PR #65` commit and have not moved since" — they had by then
> been **pruned**. All four are in `artifacts/sync/merged-branches-to-prune.txt`
> (lines 4, 5, 63, 65, every one at the same tip `7ee88ef`), and
> `docs/BRANCH_HYGIENE.md` gives the reason: they had not moved since 2026-07-15 and
> nothing in CI or the compose files referenced them, so as stale pointers they
> implied a promotion flow this repo does not run. Verified 2026-09-02:
> `git ls-remote --heads origin` returns 16 refs and none of them is `dev`, `alpha`,
> `beta` or `prod`. The two documents contradicted each other for as long as both
> were current; this is the one that was wrong.
>
> The **Promote Tier** workflow (`.github/workflows/promote.yml`) was retired in the
> same sweep. Every promotion it could offer already had an empty diff, and a
> `workflow_dispatch` whose every input names a ref that resolves to nothing can only
> fail — a workflow that can only fail teaches people to ignore red.
>
> A pruned branch here is **recoverable, not lost** — the prune list records each
> tip precisely so `git push origin <tip-sha>:refs/heads/<branch>` restores it. No
> workflow reports tier positions any more, so settle live state with
> `git ls-remote --heads origin` rather than trusting a number quoted here.
>
> **What survives, and is real today:** the tiers as *deployment environments*.
> `SIGNALGRID_TIER` and `config/tiers/<tier>.env.example` are unchanged, the
> api-server still resolves and reports the tier at `GET /api/healthz`, and the
> fixture-safe rule below still holds. Tier is selected by configuration, not by
> which branch you are on.
>
> **What it would take to run the branch pipeline again:** recreate the four
> branches and re-add a promotion workflow. That is an owner decision, and two
> other shapes remain defensible — **feed `dev`** from `SignalGrid_Alpha`, or
> **re-point the default** to `dev` so work lands at the pipeline's entry point
> (see `docs/OWNER_ACTIONS.md` §3).
>
> One footnote worth keeping from the retired workflow, because it applies to
> any replacement: the repository has *Settings → Actions → General → "Allow
> GitHub Actions to create and approve pull requests"* **off**, which is
> GitHub's default and the safer posture. A job-level `pull-requests: write`
> grant cannot override it, so an Actions-authored promotion PR will not open;
> hand back a `compare/...?expand=1` link instead, which needs no elevated
> permission.

**Read the Branch column as DESIGNED, not as existing** — none of the four branches
is on the remote today (above). The Tier column is real: it is the value of
`SIGNALGRID_TIER`, and the live-integrations column is enforced in code regardless
of which branch anything was built from.

| Tier | Branch (designed) | Purpose | Live integrations |
| ---- | ----------------- | ------- | ----------------- |
| **dev** | `dev` — *pruned* | Active development; every feature branch targets `dev`. | **Never** — always fixture-safe |
| **alpha** | `alpha` — *pruned* | Internal validation of a `dev` snapshot. | **Never** — always fixture-safe |
| **beta** | `beta` — *pruned* | Pre-production / design-partner validation. | Gated: only with `SIGNALGRID_LIVE_INTEGRATIONS=true` + real creds |
| **prod** | `prod` — *pruned* | Stable production. Protected; requires review + green CI to merge. | Gated: only with `SIGNALGRID_LIVE_INTEGRATIONS=true` + real creds |

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

**Not currently run — the tier branches and the promotion workflow are both gone
(2026-09-02, see the note at the top).** What actually happens: a `claude/<topic>`
branch is opened, squash-merged into `SignalGrid_Alpha` behind green CI, and deleted
(`docs/BRANCH_HYGIENE.md`); a deployment then picks its tier through
`SIGNALGRID_TIER` / `config/tiers/<tier>.env`.

The designed flow, for whoever reconnects it:

- Merge feature work into `dev` (green CI required).
- Promote `dev → alpha → beta → prod` via PR. No workflow opens those PRs today —
  `.github/workflows/promote.yml` was retired with the branches. Each promotion PR
  would run the full CI + scheduled-verification gate suite.
- In the designed model `prod` (and ideally `beta`) would be branch-protected:
  no direct pushes, review + green checks required. Nothing is protected there
  today because no such ref exists; the protection that matters is on
  `SignalGrid_Alpha`, and branch protection is a repo setting either way.

## Deployment

Each tier deploys the same monorepo build with its own `config/tiers/<tier>.env`.
The Docker topology (`docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`,
`nginx.conf`) is tier-agnostic — only the environment file differs per tier.
