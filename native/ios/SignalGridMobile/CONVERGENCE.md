# SignalGridMobile — the `/v1`-contract iOS package (Operator + Wardlink)

This package is the **intended convergence target** for the native iOS surfaces, not
the state of the tree today: the gated ports and the iOS gates
(`scripts/check-decision-port-parity.mjs`, `scripts/check-ios-port-sources.mjs`,
`scripts/check-ios-dynamic-type.mjs`) all point at **EnterpriseShell**, which holds
the byte-faithful `DecisionEngine` / `AppWorkflows` ports. What this package
contributes now is one Swift core (`SignalGridMobileCore`) modelling the repo's real
`/v1` contract, so the surfaces built on it cannot silently diverge from the API they
consume. See *Relationship to EnterpriseShell* below.

## Why this exists

The iOS app kept "not playing out" for two structural reasons, now addressed:

1. **No compile/test feedback loop.** The CI/dev environment is Linux with no Xcode,
   so the SwiftUI targets could only ever be *parsed*, never built — every mistake
   surfaced late, on a Mac. But the substance of the app is not the views; it is the
   **logic core** (the `/v1` client, the Codable models, the decision / Assist /
   session behaviour). That core is pure Swift (Foundation only) and **now builds and
   tests on Linux** with the open-source Swift toolchain — so its correctness is
   verified where the code is written, not hoped-for downstream.
2. **Fragmentation.** Multiple parallel iOS efforts with overlapping models. This
   package is where they are meant to converge; EnterpriseShell holds the gated ports
   until that happens. See *Relationship to EnterpriseShell* below.

## Layout

| Target | Kind | Verifiable on Linux? |
| --- | --- | --- |
| `SignalGridMobileCore` | Pure-Swift SPM package: `/v1` client, models, deterministic fixtures, decision/Assist/session logic, tests | **Yes** — `swift build` + `swift test` |
| `SignalGridOperator` | SwiftUI operator/reviewer console | Syntax-parse only; full build needs macOS + Xcode |
| `WardlinkDemo` | SwiftUI generic clinical host app (SignalGrid invisible beneath) | Syntax-parse only; full build needs macOS + Xcode |

## Verify

```bash
# Linux or macOS — builds + tests the logic core, syntax-parses every SwiftUI file:
./scripts/verify.sh
```

On Linux this runs the **14 core tests** — measured, not remembered:
`grep -c "func test"
SignalGridMobileCore/Tests/SignalGridMobileCoreTests/SignalGridMobileCoreTests.swift`
→ 14, in two groups. `SignalGridMobileCoreTests` (8): deterministic scenario outcomes,
session lifecycle, evidence↔decision linkage, step-up gating,
sensitive-actions-never-auto-run, public-safe fixture markers, **/v1 envelope-shape
decode**, and **enum wire-value contract**. `StepUpGateTests` (6): only step_up
challenges, allow never prompts, satisfied permits, refused withholds, an unavailable
authenticator is not a free pass, and every reason carries a specific prompt. The
script also parses all SwiftUI sources. On macOS it additionally generates the
Xcode project and builds both app targets for the iOS Simulator.

The two contract tests are the anti-drift guard: `testDecodesRepoV1EnvelopeShape`
proves the client decodes the API's real `{ requestId, timestamp, ...payload }`
envelope, and `testEnumWireValuesMatchRepoContract` locks the outcome / disposition /
session-mode wire values to the repo's TypeScript contracts (including the
Trust→Action `assist` outcome).

## Relationship to `EnterpriseShell`

`../EnterpriseShell` is the UIKit **kiosk login shell** — the on-device state machine
that badge-checks-out a shared iPad (badge → OIDC session → run host apps → teardown).
It is a different surface from this package's Operator/Wardlink apps. Its service
layer already calls the `/v1` contract (`api/v1/context`, `api/v1/sessions/start`,
`…/refresh`, `…/end`, `api/v1/app-workflows/evaluate` — `DecisionServiceTests` pins
the path); an earlier version of this paragraph said it "currently talks to an older
`/api/sessions/*` endpoint", which the tree refuted (the only `api/sessions` strings in
`BackendService.swift` are comments saying the server does NOT serve them). The
convergence target that remains is for `EnterpriseShell` to consume
`SignalGridMobileCore` as its client, so there is one Swift client across all iOS
surfaces — the endpoint half has already converged.

## Product boundary

Native comparison/demo build, not a production client: synthetic public-safe fixtures
only, no live Microsoft Graph calls, no real tenant/customer data, no PHI/PII, no
device-management writes, no vendor-partnership / compliance / production-readiness
claims, no autonomous remediation. Systems of record remain external.
