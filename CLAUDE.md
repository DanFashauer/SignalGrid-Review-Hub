# CLAUDE.md — SignalGrid-Review-Hub

Guidance for Claude Code (and humans) working in this repo. Read this before your
first change. These rules override default behavior.

## What this is

A pnpm/TypeScript monorepo for **SignalGrid**. `docs/PURPOSE.md` is canonical
(DR-020) and states what SignalGrid is; this file governs implementation only.
SignalGrid connects the systems a building runs into one grid that decides and
acts on a person's behalf as they move through door, device, room and app — a
decision is the trigger for a cascade, not the end of it, and the worker never
sees SignalGrid. The decision core is deterministic and
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
   their own host app and the gate returns allow/step_up/restrict/deny.
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

**`validate-sim-macos.sh` green is NARROWER than preflight green, and the
difference is not small.** The harness enumerates every `proof:*` script, so a
new proof joins it automatically — but roughly thirty-five preflight gates are
not proofs and it never runs them: the docs↔proof figure guard, the launch
profile, both preflight↔CI parity checks, the guard registries, the publication
boundary, the simulation-request gate, `test:load`, the benches. A branch can
therefore pass the harness and fail CI on a gate the harness has no concept of.
Run BOTH before pushing anything that touches gates, docs figures, or the
launch surface:

```bash
node scripts/preflight.mjs       # the per-push lane CI mirrors (~35 non-proof gates)
pnpm run verify:breadth          # 47 deferred families + 8 doctrine proofs, its own CI job
```

### Commands worth knowing, and when

| Command | When |
| --- | --- |
| `pnpm run lane:inbox` | **Run this first, every session.** What the other lane needs you to know. `pnpm run lane:send "subject" "body…"` to write back, `pnpm run lane:ack <id> "what I did"` to close one — then commit and push `artifacts/lane-messages/`, because the push is the delivery. The owner is not a message bus; do not ask them to relay. |
| `pnpm run sim:run-requests` | On the Mac: run the verification operations the cloud lane queued in `artifacts/sim-requests/`. `--plan` first to see what would run; `--id <id>` for one. Results land in `artifacts/sim-results/` with provenance and are COMMITTED — that is how the other lane learns the run happened. See `docs/LIVE_SYNC_LOOP.md`. |
| `node scripts/check-sim-requests.mjs` | What is still owed. A refusal or a skip never closes a request; pending is reported on every run and never counts green. |
| `node scripts/check-lane-messages.mjs` | What mail is still unread, in either direction. Unread is REPORTED, never fatal — the other machine is not always awake — but it is never silent, and only the addressee can close a message. |
| `pnpm run check:absence <topic>` | **Before writing "X does not exist."** Probes four differently-shaped ways; exits 1 refuted, 2 inconclusive, 0 corroborated. A word appearing in a disclaimer is NOT the thing existing — that verdict is `inconclusive`, and you read the matches yourself. TWO in-repo documents have now claimed a surface was absent while it sat in the tree — `docs/DELIVERY_GAP_ANALYSIS.md` (several claims, recorded in `docs/agent/FALSE_CLAIMS.json`, and repeated by external analyses) and `docs/company/ICP_EVIDENCE.md` on 2026-08-24, which said no competitive surface named OLOID or Imprivata while four anchored briefs and a battlecard had sat in `docs/research/` for two weeks. (An earlier version of this row said "two" and then "three" without citing which; the registry substantiates one prior in-repo document, so the number now names its sources.) **The tool ITSELF fail-opened until 2026-08-24**: its content probe excluded `docs/*`, so a topic living only in prose returned CORROBORATED instead of INCONCLUSIVE — and a roster entry was rewritten on that verdict to say a live, buyer-facing label drift was "named NOWHERE". Fixed, with a live self-test. Run it BEFORE the sentence goes in, and read the matches yourself: the feeling of being sure is what every instance had in common. |
| `pnpm run scan:estate` | The cited-path check across ALL SEVEN repositories, not just this one — the other six have no gates watching them. Needs the siblings cloned under `/workspace`; a repo it cannot reach is reported NOT SCANNED and never counted clean. Not a CI gate for that reason: CI has one checkout. |
| `pnpm run test:load` / `test:stress` | The `/v1` HTTP surface under concurrency. Correctness is GATED; throughput, percentiles and the saturation knee are REPORTED — a latency threshold on a shared runner is a flaky gate and a flaky gate gets switched off. |
| `pnpm run bench:decision-latency` / `bench:decision-throughput` | The in-process decision core: one decision, then saturation across every core. **Not the same number as `test:load`** — no HTTP, no connector, no database. The gap between them is the transport. |
| `SIGNALGRID_MCP_PATH=… pnpm run verify:all --require-mcp --emit-evidence` | The ONLY lane that can refresh `artifacts/live-evidence/mac-run.json`. macOS only, refuses on CI, refuses unless both halves are green. |
| `node scripts/generate-sync-manifest.mjs` | After changing any cross-surface contract. Never hand-edit the manifest. |

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
  must pass **with every assertion green** (the suite prints `N/N`; 305/305 at the
  time of writing — the printed total grows as coverage does, so compare passed
  against total, not against a number quoted here). Adding a route near others:
  verify you didn't drop the neighbors (a real regression this file exists to
  prevent).
- Core gates individually: `pnpm run typecheck`, `pnpm run review:invariants`,
  `pnpm run proof:signalgrid-simulator`.

## Toolchain wrinkle (macOS/arm64)

`pnpm-workspace.yaml` `overrides` strip every native binary except
**linux-x64-gnu** (rollup/rolldown/esbuild/lightningcss/oxide — rolldown is
Vite 8's bundler, win32 bindings deliberately kept for the windows desktop CI), so:

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
- Two apps: **EnterpriseShell** (the kiosk-until-auth shell + Assist gate) and <!-- framing:mechanism -->
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
  - **Never call `.systemFont(ofSize:` / `.monospacedSystemFont(ofSize:`
    directly** (the implicit-member form Swift uses at the call site — grepping
    `UIFont.systemFont` matches ZERO, which is how 18 sites hid in the two
    Assist-gate view controllers after a hand conversion regressed). Use
    `SG.sans` / `SG.mono` / `SG.monoDigits`, which scale via `UIFontMetrics`, and
    set `adjustsFontForContentSizeCategory = true`. The drift is the default
    unless this is written down — so it is now GATED: `scripts/check-ios-dynamic-type.mjs`
    (in preflight and CI) fails on any raw call outside `DesignSystem.swift`.
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

## Working with Dan (owner) — communication contract
- Non-engineer founder, dyslexic, usually reading on a phone. Be extremely concise: answer first, no preamble, no recaps, no hedging filler, plain prose over bullets. 1–3 sentences for simple answers; go long only when asked.
- Blunt and short beats warm and long. Never pad for politeness.
- Explain any risky command in one line before running it. Show a plan before editing.
- Dan decides; Claude Code executes. Strategy and doctrine debates happen in chat, never here.
- When Dan shares external material (repositories, articles, tools, vendor content), absorb it: log it in `docs/agent/RESOURCE_INTAKE.md`, evaluate it by use, and wire in what strengthens the repo — never answer it with a memo of reasons. (Amended per DR-021; the original handoff line said "never a build order.")

## Truth and completion (enforced by hooks, restated here)
- Never claim pass / exists / fixed / absent without just running the command and quoting real output. Numbers come from output, never memory.
- Done = tests/gates pass with quoted output AND the commit is confirmed on origin via `git ls-remote`. Local-only is not done.
- Never bypass a check: no `--no-verify`, no stash-to-dodge, no quiet flags, no force-push. Report the failure and fix the cause.
- Session ritual: START — read `docs/agent/LOOP.md`, run `pnpm run loop:state`, quote output. END — update the LOOP.md STATE block, push, confirm on remote.

## Scope (current phase — DR-021, 2026-08-31)
- Engineering is UNFROZEN across every lane (DR-021). Build what strengthens the solution; new verticals/platforms/hardware still get a decision record first (DR-020 rule).
- Claim discipline is unchanged: the launch-claims gate, launch-profile classification, and publication boundary still govern what may be *said* to ship. Building and claiming are different acts.
- The only number that moves the company is discovery conversations (`docs/agent/DISCOVERY_LOG.md`). Code work never substitutes for it.
