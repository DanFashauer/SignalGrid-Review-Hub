# Browser-level E2E (Playwright)

The repo's first E2E layer that verifies what a **human sees** in a real
browser, not what a module exports. The proof scripts pin the core, the API
contract, and the connectors; none of them can catch a page that builds green
and renders wrong — or renders copy the core no longer honours. These tests
close that gap.

## How to run

```sh
# from the repo root
pnpm --filter @workspace/scripts exec playwright test \
  --config playwright.config.ts --tsconfig ../tsconfig.base.json
```

(or `pnpm exec playwright test --config playwright.config.ts --tsconfig
../tsconfig.base.json` from `scripts/`).

The `--tsconfig ../tsconfig.base.json` flag is required: Playwright's own
tsconfig loader cannot parse directory-style project `references` (it appends
`.json` to `"../lib/signalgrid-core"` instead of looking for the directory's
`tsconfig.json`), so pointing it at the reference-free base config sidesteps
the crash. It only affects how Playwright *transpiles* the spec files; `tsc`
still typechecks them through the normal `scripts/tsconfig.json` gate.

**Browsers:** never run `playwright install` in this environment. The runner
preinstalls Chromium under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; the
config prefers the stable `/opt/pw-browsers/chromium` symlink when it exists
(the preinstalled revision can lag the Playwright package's expected one — it
does today: 1194 installed vs 1234 expected — and a download must never
happen mid-CI). `E2E_CHROMIUM_PATH` overrides the binary explicitly.

Everything is localhost and every fixture is the deterministic demo seed, so
`retries: 0` — a red run is a regression, not a coin-flip. Each spec also
blocks all non-localhost requests (the consoles' `index.html` references
Google Fonts), keeping runs hermetic and offline-capable. Full run:
~40 seconds including all six builds.

## Servers (booted by `webServer` in `playwright.config.ts`)

| Port | App | Served as |
| --- | --- | --- |
| 4611 | signalgrid-review (operator/review console) | `vite build` + `vite preview` (static; decision core runs in-browser) |
| 4612 | signalgrid-web (public website) | `vite build` + `vite preview` |
| 4613 | api-server | `node dist/index.mjs` (the real built server; in-memory demo core, no DATABASE_URL) |
| 4614 | signalgrid-app (admin console) | `vite build` + `vite preview`, `/api/*` proxied to the live api-server via `API_PROXY_TARGET` |
| 4615 | signalgrid-desktop (desktop client) | `vite build` + `vite preview`, `/api/*` proxied to the live api-server via `API_PROXY_TARGET` |
| 4616 | signalgrid-mobile-pwa (mobile PWA) | `vite build` + `vite preview`, `/api/*` proxied to the live api-server via `API_PROXY_TARGET` |

Ports are overridable via `E2E_REVIEW_PORT` / `E2E_WEB_PORT` / `E2E_API_PORT`
/ `E2E_ADMIN_PORT` / `E2E_DESKTOP_PORT` / `E2E_PWA_PORT` (the specs read the
same variables). Apps are served from
their **built** bundles — a green run pins the artifact, not the dev server.

## What is covered

- **`review-console.spec.ts`** — operator console: the seeded decision list
  renders one row per outcome class with outcome badge *and* reason code
  (ALLOW/TRUST_ESTABLISHED, RESTRICT/DEVICE_NONCOMPLIANT,
  STEP-UP/BATTERY_CRITICAL, DENY/IDENTITY_DISABLED); a RESTRICT decision's
  full evidence trace (Compliance = `non_compliant`, snapshot integrity
  `verified`, digest present); the battery **charge** evidence row for the
  critically-low-battery decision plus the anti-fabrication negative control
  (no `Battery health` row when the device reports no health reading); the
  battery **health** row for a failing-battery decision (see Known red); the
  audit chain reporting VERIFIED in the UI.
- **`website.spec.ts`** — Hardware page pins the **corrected battery copy**
  ("A failing battery restricts … the device needs a battery, not a bay") and
  asserts the old, wrong copy (step-up + "topped up in its bay") is gone; the
  public-safety honesty banner ("Pre-production hardware design concept",
  "not shipped or certified"); SmartDock section and a concrete spec value;
  both deep-load (`/hardware` direct) and client-side navigation.
- **`admin-console.spec.ts`** — the one surface with a real network path:
  browser → `vite preview` proxy → live api-server → decision core.
  `/api/healthz` + `/api/v1/keys` through the app's own proxy; dashboard
  fixture telemetry with exact values (18,432 / 82.0%); the Live Decision
  panel POSTing `/v1/decisions/evaluate` and rendering RESTRICT ·
  DEVICE_NONCOMPLIANT with decision/evidence/policy provenance; the
  decisions and policies pages listing the fixture catalogs.

## The gap this suite caught on its maiden run (was red; fixed in the same change)

`review-console.spec.ts › a failing-battery device surfaces the Battery
health row with its RESTRICT reason` was **red on the suite's first run**,
and the failure was a real product gap no other gate could see: the
batteryHealth commit added the "Battery health" evidence row, the core seed
devices (`nurse.failbatt`/`ipad-loan-04`, `nurse.flatandworn`/`ipad-loan-05`),
the BATTERY_FAILING restrict rule, and proof-level scenarios — but no entry
was added to the operator console's `SCENARIOS` list, so every scenario the
console evaluated had `batteryHealth: "unknown"` and the row was hidden by
its own `!== "unknown"` guard. The core was verified correct over the API;
the operator-facing half of the feature never rendered.

The one-line `SCENARIOS` entry ("Failing battery (SmartDock)",
`nurse.failbatt`/`ipad-loan-04`) landed in
`artifacts/signalgrid-review/src/components/sections/OperatorConsoleSection.tsx`
**in the same change that adds this suite**, and the test was green — 15/15 **at that point** (the suite has since grown to 35).
An adversarial review then caught an earlier draft of THIS section still
describing the test as red after the fix had landed, which is its own lesson:
a README describing a test's live state is a hand-maintained claim, and the
test itself is the only version of that claim that cannot go stale.

Do not delete or skip the test — it is the executable statement of the
requirement, and it is the regression guard for exactly this gap recurring
with the next evidence field.

## What is deliberately NOT covered (yet)

- **Other review-dashboard sections** (worker self-service, simulator,
  connector emulator, credential reader): same in-browser core, lower
  marginal value; add specs when their content becomes load-bearing.
- **Admin pages beyond dashboard/decisions/policies** (fleet, app-workflows,
  intelligence, provisioning, …): the proxy wiring they share is proven; the
  remaining pages are fixture rendering.
- **api-server durable modes** (`DATABASE_URL`, live-integration tiers): E2E
  runs the public-safe in-memory tier only; the pg proofs own the rest.
  There is no OpenAPI-serving endpoint on the api-server to test (the spec
  lives in `lib/api-spec` and is contract-checked by `proof:api-contract`).
- **Cross-browser, mobile viewports, visual regression, a11y audits**:
  Chromium-only by design — the preinstalled browser is the only one allowed
  here, and these tests pin *content and wiring*, not pixels.
