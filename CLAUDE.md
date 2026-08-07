# CLAUDE.md — SignalGrid-Review-Hub

Guidance for Claude Code (and humans) working in this repo. Read this before your
first change. These rules override default behavior.

## What this is

A pnpm/TypeScript monorepo for **SignalGrid** — a signal- and location-driven
**Assist gate** for frontline devices. The decision core is deterministic and
fixture-backed; a "real-life simulator" subsystem plus a `proof:*` gate suite prove
behavior without a database. Native iOS lives under `native/ios/`.

Layout: `lib/*` (decision core, connectors, flows), `artifacts/api-server`
(Node/esbuild control-plane + `/v1` decision API), `artifacts/signalgrid-*`
(web), `scripts/*` (proof harnesses), `native/ios/*` (Swift apps), `docs/*`
(product + design docs — the de-facto PRD; start at `docs/CI_AND_VALIDATION.md`).

## Golden rules — do not break these

1. **Never modify `native/ios/EnterpriseShell/Services/DecisionEngine.swift` or
   `AppWorkflows.swift` for behavior.** They are byte-faithful ports of the TS
   simulator; parity is the point. New logic goes *around* them (see
   `SignalContext.swift` for the pattern).
2. **Fail-closed, deterministic, truthful.** No `Date.now()`/`Math.random()` in
   decision paths; an unknown/unreachable signal raises assurance, never lowers
   it; report status honestly (a failing gate is failing). `pnpm run
   review:invariants` enforces this — keep it green.
3. **Embedded UX law.** SignalGrid is invisible to end users; the worker uses
   their own host app and the Assist gate returns allow/step_up/restrict/deny.
   Domain safety (patient lookup, clinical guidelines, etc.) belongs in the HOST
   apps, not in SignalGrid.
4. **Platform honesty.** An app cannot grant device access, restrict other apps,
   make itself non-removable, or self-kiosk. Those are MDM/OS capabilities and
   need a **supervised device** (Apple Business Manager + APNs) — Fleet is the
   chosen MDM (see `docs`/`fleet/`). Never claim on-device enforcement works from
   a simulator; it can't be MDM-enrolled.

## Before you push — validation gate

Run the full local harness; it mirrors CI and catches breakage the individual
proofs miss:

```bash
./validate-sim-macos.sh          # full suite → the harness prints
                                 # "== SUMMARY: N passed, M failed =="; compare M
                                 # against 0. Do NOT compare N against a total quoted
                                 # here — the suite grows, and a pinned total silently
                                 # turns a regression into a pass.
                                 # (--sim-only for just the scenarios)
```

- **Added or changed a package's deps?** Regenerate the lockfile —
  `pnpm install --lockfile-only` — and commit `pnpm-lock.yaml`. CI runs
  `pnpm install --frozen-lockfile` (Node 22) and fails hard on drift.
  A **pre-push hook now enforces this** (`.githooks/pre-push`, ~0.5s), installed
  automatically by `pnpm install` via the `prepare` script. It exists because this
  rule was already written here, in these words, and a branch still reached the
  remote with a mismatched lockfile — CI failed on `Install dependencies` before
  running a single gate. The cause was mechanical, not forgetfulness: local builds
  add darwin platform binaries and restore the manifests afterwards, and that
  restore re-diverged the lockfile *after* it had been correctly regenerated. If you
  do that dance, restore the manifests FIRST and regenerate the lockfile after.
  Bypass with `git push --no-verify` when you mean to.
- **Touched the api-server?** `pnpm --filter @workspace/api-server run test:api`
  must pass **with every assertion green** (the suite prints `N/N`; 163/163 at the
  time of writing — the printed total grows as coverage does, so compare passed
  against total, not against a number quoted here). Adding a route near others:
  verify you didn't drop the neighbors (a real regression this file exists to
  prevent).
- Core gates individually: `pnpm run typecheck`, `pnpm run review:invariants`,
  `pnpm run proof:signalgrid-simulator`.

## Toolchain wrinkle (macOS/arm64)

`pnpm-workspace.yaml` `overrides` strip every native binary except
**linux-x64-gnu** (rollup/esbuild/lightningcss/oxide), so:

- Proofs/sim/`test:api` run natively once tsx's esbuild binary for this arch is
  present and the api-server is built (both handled by `validate-sim-macos.sh`).
- `pnpm run build` (the vite web build) only runs on linux-x64 / in CI. Don't try
  to "fix" a web-build failure here — it's expected off linux-x64.

## iOS specifics

- **Build from the repo root of the currently checked-out revision** — all iOS
  paths below are repo-relative (`native/ios/...`). Do not hand-fix any stray
  copy of the iOS tree outside this repository; only this tree is maintained.
- Two apps: **EnterpriseShell** (the kiosk-until-auth shell + Assist gate) and
  **SignalGridMobile** (Operator + Wardlink demo/console).
- Build & run:
  ```bash
  cd native/ios && xcodegen generate && \
    xcodebuild -scheme EnterpriseShell -sdk iphonesimulator \
      -destination 'platform=iOS Simulator,name=iPhone 17' build
  ```
  Add a new source to a **test target**'s explicit `sources` list in `project.yml`
  and re-run `xcodegen generate` (app targets auto-glob).
- **Demo flags** (simulator-only) live in `EnterpriseShell/Services/DemoMode.swift`
  — badge, location/zone, injected signals, screen-capture, seeded control-plane
  refs, etc. Pass via `xcrun simctl launch booted com.enterprise.shell -Flag ...`.

## Ask before

Destructive git (force-push, history rewrite, branch deletion), anything that
sends data to an external service, and committing/pushing unless asked. For
regulated verticals (healthcare/fintech): Claude Code does **not** guarantee
HIPAA/SOC 2 — a human compliance review is required, not optional.
