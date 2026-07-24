# SignalGridMobile — canonical native iOS app (converged into the monorepo)

This package is the **single source of truth** for the native iOS surfaces. It was
brought into the repo to end the drift caused by parallel iOS codebases: everything
now shares one Swift core (`SignalGridMobileCore`) that models the repo's real `/v1`
contract, so the app can't silently diverge from the API it consumes.

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
   package is now the canonical one; see *Relationship to EnterpriseShell* below.

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

On Linux this runs the **8 core tests** (deterministic scenario outcomes, session
lifecycle, evidence↔decision linkage, step-up gating, sensitive-actions-never-auto-run,
public-safe fixture markers, **/v1 envelope-shape decode**, and **enum wire-value
contract**) and parses all SwiftUI sources. On macOS it additionally generates the
Xcode project and builds both app targets for the iOS Simulator.

The two contract tests are the anti-drift guard: `testDecodesRepoV1EnvelopeShape`
proves the client decodes the API's real `{ requestId, timestamp, ...payload }`
envelope, and `testEnumWireValuesMatchRepoContract` locks the outcome / disposition /
session-mode wire values to the repo's TypeScript contracts (including the
Trust→Action `assist` outcome).

## Relationship to `EnterpriseShell`

`../EnterpriseShell` is the UIKit **kiosk login shell** — the on-device state machine
that badge-checks-out a shared iPad (badge → OIDC session → run host apps → teardown).
It is a different surface from this package's Operator/Wardlink apps, and it currently
talks to an older `/api/sessions/*` endpoint rather than `/v1`. The convergence target
is for `EnterpriseShell` to consume `SignalGridMobileCore` and the `/v1` contract too,
so there is one Swift client across all iOS surfaces.

## Product boundary

Native comparison/demo build, not a production client: synthetic public-safe fixtures
only, no live Microsoft Graph calls, no real tenant/customer data, no PHI/PII, no
device-management writes, no vendor-partnership / compliance / production-readiness
claims, no autonomous remediation. Systems of record remain external.
