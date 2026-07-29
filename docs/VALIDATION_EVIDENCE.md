# Simulation Validation Evidence

Machine-generated evidence from running the deterministic simulator + proof suite
outside CI, to complement `SIMULATOR_VALIDATION_RUNBOOK.md`. Reproduce with
`./validate-sim-macos.sh` (native macOS) and the linux build steps below.

## 1. Native run (macOS, Apple Silicon / arm64)

Harness: `validate-sim-macos.sh`. Result **as recorded at the time of this run:
33 / 33 gates green** — the whole suite as it then stood.

> **This section is a dated record, not a current measurement.** The suite has
> since grown to **87 gates** (4 named simulator gates + 78 looped `proof:*`
> gates + 5 non-proof gates; derive it with the command below). Re-run the
> harness to refresh it — and note the harness prints
> `== SUMMARY: N passed, M failed ==`, so read `M` against 0 rather than pinning
> a total here again, which is how these numbers went stale in the first place.
>
> ```
> node -e "const s=require('./package.json').scripts;const sim=['proof:signalgrid-simulator','proof:room-sim','proof:signalgrid-core','proof:signalgrid-grid'];const all=Object.keys(s).filter(k=>k.startsWith('proof:'));console.log('total gates', 4+all.filter(k=>!sim.includes(k)).length+5)"
> ```

| Group | Gates | Result |
|---|---|---|
| Real-life simulator | `proof:signalgrid-simulator` (11 scenarios / 39 assertions), `proof:room-sim`, `proof:signalgrid-core`, `proof:signalgrid-grid` | PASS |
| CI-mirror proof suite | the remaining `proof:*` gates at that time — 24 then, 78 now (incl. `-pg` gates via in-memory fallback) | PASS |
| Non-proof gates | `typecheck`, `test:api`, `safety:check`, `docs:sanity`, `review:invariants` | PASS |
| Hygiene | `git diff --check` | clean |

### Real-life simulator scenarios (all allow/route/audit-evidence correct)

- healthy-shared-device-checkout → allow
- apple-ddm-platform-sso-state → allow
- non-compliant-clinical-device → restrict
- stale-checkin-shared-device → step_up
- wrong-zone-rtls-event → alert_operator
- dock-missing-overdue-device → alert_operator
- low-battery-workflow-impact → alert_operator
- operational-health-degradation → create_ticket
- edr-security-risk → restrict
- api-integration-outage → alert_operator
- remediation-verified → verify_remediation

## 2. Web build (Linux)

`pnpm run build` (typecheck + all 8 package builds incl. the 6 vite frontends,
`mcp-server`, `api-server`) — **built clean (exit 0) on linux/arm64.**

### Environment note (toolchain is linux-x64-pinned)

`pnpm-workspace.yaml` `overrides` strip every native binary except linux-x64-gnu.
To run the build off linux-x64, add back the current platform's binaries:

- macOS arm64: `@esbuild/darwin-arm64`, `@rollup/rollup-darwin-arm64`, `lightningcss-darwin-arm64`, `@tailwindcss/oxide-darwin-arm64`
- linux arm64: the `*-linux-arm64-gnu` / `@esbuild/linux-arm64` variants

The api-server (pure esbuild, no vite/rollup) builds natively on any arch and is
required before `proof:observability` and `test:api` (they boot its `dist/`).

## 3. Known limitation — byte-exact linux-x64 not reproduced locally

A byte-identical linux-x64 build was **not** reproduced on the available hardware:
the arm64 Docker Sandboxes (`sbx`) microVM cannot register qemu binfmt for amd64
(`exec format error` persists after `tonistiigi/binfmt --install`). The linux-arm64
build passing is strong evidence the linux-x64 CI build is green (identical source
and toolchain; only the native-binary arch differs), but is not a substitute for a
real linux-x64 CI run.

## 4. Proof coverage audit (feedback loop)

Each of the 28 proof gates **that existed when the audit ran** was
independently audited for *real coverage vs. rubber-stamp* (the suite has since
grown to 82 `proof:*` scripts, so this audit covers a subset). Full report: [`PROOF_COVERAGE_AUDIT.md`](./PROOF_COVERAGE_AUDIT.md).

Headline: **12 strong, 16 moderate, 0 weak; 0 formal rubber-stamps** — but the
moderate gates repeatedly assert outputs are *present/well-typed* rather than
*correct*, and the untested surface concentrates in **fail-closed security
branches**. Top gaps to close (see report for the concrete test in each case):

1. `signalgrid-core` — the `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` guardrail is dead-code-untested.
2. `signalgrid-grid` — baseline decision correctness never asserted (only truthiness).
3. `signalgrid-simulator` — subset checks let a spurious `allow` on high-risk scenarios pass.
4. `control-plane` — no negative bundle signature/checksum test.
5. `webauthn-verify` — signature-counter clone detection uncovered.
6. `audit-ledger` / `-pg` — mid-chain tamper (delete/reorder) untested.
7. `microsoft-graph-sandbox` — proof uses an inline oracle, exercises no shipped code.
8. `enterprise-auth` — configured clock tolerance never exercised at its boundary.

### Remediation (all 8 gaps closed in this branch)

All eight highest-value gaps were implemented as real assertions against shipped
code and verified by re-running each proof; the full suite was **33/33 green**
at that point.
None revealed a product bug — the fail-closed branches were correct, just untested.

The additions are mutation-verified, not rubber-stamps. Example: forcing
`verifyBundleSignature` (lib/control-plane) to `return true` makes
`proof:control-plane` fail at exactly the two new authenticity assertions, and it
passes again on revert — i.e. the strengthened proof catches a signature-forgery
regression the previous proof would have missed.

| Gate | Added assertion (real behavior now proven) |
|---|---|
| signalgrid-core | allow with degraded critical evidence is suppressed to step_up (`ALLOW_SUPPRESSED_DEGRADED_EVIDENCE`) |
| signalgrid-grid | baseline decision correctness for all scenarios (`status === "PASS"`) |
| signalgrid-simulator | exact outcome-set per scenario + "never allows" on edr/wrong-zone/dock high-risk cases |
| control-plane | tampered / hex-flipped bundle → `verifyBundleSignature`/`Checksum` fail closed |
| webauthn-verify | replayed assertion with `signCount <= N` rejected as clone |
| audit-ledger | mid-chain reorder detected with correct non-zero `brokenAtIndex` |
| microsoft-graph-sandbox | drives the shipped `GraphPostureConnector`; reason codes pinned on all 11 cases |
| enterprise-auth | clock-tolerance boundary pair (~30s past exp accepted, ~90s rejected) |
