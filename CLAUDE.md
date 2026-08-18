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
- **Shell scripts run under bash 3.2** — the only `bash` on a stock Mac, and 20
  years behind the one on your Linux CI box. Under `set -u` it treats an EMPTY
  array's `"${a[@]}"` as *unbound* and aborts (bash 4.4+ expands it to nothing).
  Always write the guarded form:

  ```bash
  cmd ${ARGS+"${ARGS[@]}"}      # not: cmd "${ARGS[@]}"
  ```

  This is here because a comment explaining it in ONE script did not generalize:
  `cleanup-merged-branches.sh` documented the idiom, and `run-everything.sh` was
  written without it anyway. A plain `./scripts/mac/run-everything.sh` then died
  at line 108 in 387ms, before a single proof ran — while `--fast` worked, which
  is exactly why it survived unnoticed. The one mode meant to run EVERYTHING was
  the one mode that could never run.

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
- **The shell must look like the OS, not like a foreign app.** EnterpriseShell is
  a mix by design: most screens use semantic system colors (`.systemBackground`,
  `.label`), while the SignalGrid-branded surfaces use the `SG` tokens in
  `Services/DesignSystem.swift`. Both must follow the device. Concretely:
  - **Never pin `UIUserInterfaceStyle` in `Info.plist`.** It was pinned to
    `Light` while the SG palette was hardcoded dark, so the system-colored
    screens rendered white and the branded ones charcoal — the app contradicted
    itself screen to screen, and system UI (alerts, keyboards) never matched.
  - **Never call `UIFont.systemFont` / `monospacedSystemFont` directly.** Use
    `SG.sans` / `SG.mono` / `SG.monoDigits`, which scale via `UIFontMetrics`, and
    set `adjustsFontForContentSizeCategory = true`. 29 raw calls had already
    drifted in; the drift is the default unless this is written down.
  - **Scaling text needs somewhere to go.** A label that scales must be allowed
    to wrap (`numberOfLines = 0`, or `2` plus `minimumScaleFactor` in a narrow
    button), and any row holding it needs a `greaterThanOrEqualToConstant`
    height, never `equalToConstant`. Enabling Dynamic Type against fixed 44pt and
    80pt rows produced truncation, then overlap, then mid-word breaks — each one
    only visible at an accessibility text size.
  - **Verify at `accessibility-extra-large`, not just at the default.** Every one
    of those defects was invisible at normal size:
    `xcrun simctl ui booted content_size accessibility-extra-large`.
  - Decision colors (`allow`/`review`/`deny`) must clear **WCAG AA (4.5:1)**
    against both `SG.background` and `SG.card` in both appearances. `deny` once
    sat at 3.18:1 on card — the weakest contrast in the system on its most
    safety-critical state.
  - `SignalGridMobile` is pure SwiftUI with semantic colors and needs none of
    this; it is already adaptive. Do not "fix" it into a UIKit shape.

## Simulation results — provenance is the product

`artifacts/sim-results/*.json` are records of an execution, and their
`provenance.workingTreeClean` comes from `git status --porcelain` being empty —
**untracked files included**. Two rules follow, both learned the hard way:

- **Build output must be gitignored.** `native/ios/build/` was not, so a single
  `everything` run left ~97MB of untracked products and stamped every subsequent
  result as minted from a dirty tree. `native/android/**/build/` was already
  ignored; the iOS twin simply had not been.
- **Provenance is sampled BEFORE the runs**, in `scripts/mac/run-requests.mjs`.
  Operations are *expected* to write into the tree (`evidence` mints
  `artifacts/live-evidence/mac-run.json`), so sampling afterwards measured the
  runner's own output. The field answers "what code produced this result" — the
  state at launch. Do not move it back after the loop.

## Multiple Claude lanes

Parallel Claude sessions work this repo (cloud + Mac). Before touching a
shared surface (discipline gate, mutation guard, sync manifest, proof
registration, connector families the other lane's commits name), read
`docs/LANE_COORDINATION.md` and follow its protocol — the nac/webhooks
eight-file collision is why it exists.

## Ask before

Destructive git (force-push, history rewrite, branch deletion), anything that
sends data to an external service, and committing/pushing unless asked. For
regulated verticals (healthcare/fintech): Claude Code does **not** guarantee
HIPAA/SOC 2 — a human compliance review is required, not optional.
