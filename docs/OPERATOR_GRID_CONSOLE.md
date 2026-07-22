# Operator console — the "Build the grid" surfaces

The operator console (mobile PWA, `artifacts/signalgrid-app`) has a **Build the
grid** section that makes the decision fabric inspectable: one capstone overview
plus five detail surfaces, each rendering a `@workspace/flows` model live from the
read-only `/cp/v1` control-plane surface. Every view is **read-only**; availability
and posture are inputs (sourced like any signal), fallbacks and applies are
described, not executed, and enforcement stays off until an owner enables it.

This is the "see the grid in action" entry point. The end user never opens it —
per [`EMBEDDED_UX_PRINCIPLE.md`](EMBEDDED_UX_PRINCIPLE.md) the console is for the
operator/engineer; the decision itself is embedded and invisible to frontline
staff.

## The surfaces

| View | Route | What it shows | Backed by | Model |
|---|---|---|---|---|
| **Grid overview** | `/grid` | The whole grid at a glance — coverage, sourced signals + gaps, config validity, apps workable — with caveats *named*, not hidden, and links into each surface. | composes the five reads below | (capstone) |
| **Grid intelligence** | `/intelligence` | Flow health, recommendations, signal discovery, and the coverage rollup (situations handled on their own). | `/cp/v1/flows/health`, `/recommendations`, `/signal-discovery`, `/grid/coverage` | grid-coverage, recommendations, signal-discovery |
| **Device recorder** | `/provisioning` | Zero-touch provisioning — the recording as a Designer artifact, its CI validation, and a simulated plan preview; a non-matching device is shown **untouched**. | `/cp/v1/grid/provisioning` | provisioning |
| **App resilience** | `/app-resilience` | Each clinical app's availability → resilience mode; a PHI app with no safe path is **blocked and surfaced**, never a workaround. | `/cp/v1/apps/resilience` | app-resilience |
| **Signal sourcing** | `/signal-sourcing` | How each signal reaches the Grid — API / native / grid-collected / **gap** — and at what fidelity. | `/cp/v1/grid/sourcing` | signal-sourcing |
| **Grid config** | `/grid-config` | The declarative grid (signals + workflows + situations) an org commits to Git, plus the lint the pipeline runs before the Grid runs it. | `/cp/v1/grid/config` | grid-config |

## The honest boundary these surfaces keep

- **Fail-safe by construction.** Each model fails closed: an unavailable signal is a
  named gap (never a false "we have it"), a PHI app without safety nets is blocked
  (never an unsafe workaround), a non-matching device is never touched, an invalid
  config is surfaced as a blocking error. The overview's "all clear" only shows once
  every surface has loaded — a slow or errored read never reads as green.
- **Read-only and simulated.** These views compose `/cp/v1` reads. Nothing is
  enforced; provisioning applies and downtime fallbacks are described, not executed.
- **Fixture data.** The console is labeled `FIXTURE`; the numbers are illustrative,
  public-safe demo data (no tenant, no secrets, no PHI, no live vendor calls).

## Running it

See [`RUN_ON_MAC.md`](RUN_ON_MAC.md) to boot the api-server and the app locally; the
`/cp/v1` surface needs no auth in the demo. The same declarative grid the config view
renders lives at [`config/grid/example.grid.config.json`](../config/grid/example.grid.config.json).
The models behind each view are proven by `pnpm run proof:grid-coverage` (which
also exercises signal-sourcing), `proof:app-resilience`, `proof:provisioning`,
`proof:grid-config`, and the capstone `proof:grid-lifecycle`.
