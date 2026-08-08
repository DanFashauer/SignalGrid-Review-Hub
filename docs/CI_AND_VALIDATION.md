# CI and Validation

SignalGrid Review Hub has its own repository-native CI because it is the public review and validation surface for SignalGrid. Checks that run in `/DEV` are Alpha or legacy checks; they do not protect this public repository, its documentation, or its proof scaffolds.

## Review Hub CI

The `Review Hub CI` workflow runs on pull requests, pushes to `SignalGrid_Alpha`, and manual workflow dispatch. It is intentionally conservative and validates the public-safe repo surface only.

The validation job runs:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
pnpm run proof:microsoft-graph-sandbox
pnpm run proof:connector-emulator
```

The docs sanity job verifies that required public-review docs exist and checks for narrow, direct unsafe claims such as production-ready, replacement, partner, MFi certification, or autonomous production-remediation claims. It is not intended to block explicit disclaimers, guardrail language, or validation-command examples that document the scanner itself.

## Apple lane — iOS, iPadOS and macOS

`.github/workflows/ios-ci.yml` runs on `macos-latest` for any change under
`native/ios/**` (and for changes to the workflow itself). It carries four jobs:

| Job | What it proves |
| --- | --- |
| `EnterpriseShell (iPhone simulator)` | the app target builds and its unit tests pass on iPhone |
| `EnterpriseShell (iPad simulator)` | the same, on iPad |
| `macOS native (SwiftPM, no simulator)` | the decision port and `SignalGridMobileCore` build and test as native macOS binaries |
| `SignalGridMobile` / `Lint & Security` | `scripts/verify.sh`, SwiftLint, and the credential/insecure-URL scan |

**Why iPad is its own job.** Every app target in `native/ios/project.yml` sets
`TARGETED_DEVICE_FAMILY: "1,2"` — a claim that the app supports iPad. Before this
matrix existed the workflow picked *the first available iOS simulator*, which on
GitHub's images is always an iPhone, so the iPad half of that claim was asserted and
never once built. The matrix uses `fail-fast: false`, so a green iPhone cannot hide a
red iPad, and `native/ios/scripts/pick-simulator.py` **refuses** rather than falling
back when a device family is missing from the runner — the fallback is precisely what
made the gap invisible. That refusal has its own negative controls
(`pick-simulator.py --self-test`), which run in the job before the picker is trusted.

**Why macOS is not a simulator run.** `native/ios/Package.swift` compiles the six
pure-Foundation port files — `DecisionEngine.swift`, `AppWorkflows.swift` and the
services around them — as a SwiftPM library, and runs the same XCTest suite against
it. That buys two things a simulator run cannot: the whole logic suite runs in seconds
with nothing booted, and "the port is pure Foundation" stops being a comment and
becomes a compile error the moment somebody reaches for UIKit.

The Xcode test target and the SwiftPM package deliberately compile *the same files*
rather than a copy — duplicating a byte-faithful port to make it testable would defeat
the reason it is byte-faithful. The test sources carry
`#if canImport(EnterpriseShellPort)` around their import so one set of tests serves
both builds. Because both file lists are hand-maintained,
`scripts/check-ios-port-sources.mjs` derives them from `Package.swift` and
`project.yml` and fails if they diverge; it runs in `preflight` and in the
`macos-native` job. Without it the two lanes could drift into testing different code
while both stayed green.

**What none of this proves.** A hosted macOS runner is a throwaway VM and a simulator
is not a device: nothing here says anything about MDM enrolment, supervision, or
on-device enforcement. See `docs/MAC_LANE.md` for that boundary.

## Desktop lane — Windows and Linux

`.github/workflows/desktop.yml` builds and tests `native/desktop/core` — the Assist
gate client for the desktop shell — on **both `ubuntu-latest` and `windows-latest`**,
with `fail-fast: false` so a green Linux cannot hide a red Windows.

**What exists and what does not.** `native/desktop/core` is a Rust crate: the Assist
outcome vocabulary, fail-closed wire parsing, and endpoint validation, with 38 tests.
There is **no desktop application binary yet** — `artifacts/signalgrid-desktop` remains
a Vite web app, exactly as `docs/APP_SUITE_MATRIX.md` has always said. The core came
first deliberately: everything that decides what a worker is told is testable with
`cargo test`, on any machine, with no display server, installer, or signing
certificate. The shell can then be thin, because nothing important is left in it.

Windows is a separate job for the same reason iPad is one in the Apple lane: a
platform claimed from a build that never ran on it is a claim nothing checks.

## One set of Assist cases, three clients

There are now three independent implementations of the same fail-closed rule —
TypeScript in `lib/` (the source of truth), Kotlin in `native/android/core`, and Rust
in `native/desktop/core`. Each had its own hand-written tests, which is precisely the
arrangement in which they diverge silently: every suite stays green while one client
starts treating a malformed response differently from the others.

`native/shared/assist-wire-conformance.json` is **one set of 42 cases every client
must agree on** — happy paths, transport failures, captive-portal HTML, truncated
bodies, wrong-typed fields, and the near-misses (`allow_all`, `disallow`, `allowed`)
that a lenient parser could talk itself into accepting. Each client has a test that
reads the file and asserts its own parser agrees, case by case.

**It found two real defects in the Kotlin client on its first run**, neither visible
to that client's own suite:

| Defect | Why it mattered | Settled by |
| --- | --- | --- |
| `RESTRICT.proceedsWithoutFurtherAction` returned `true` | a host app would have carried on at **full** capability on a restrict decision, silently discarding the ceiling | `lib/orchestration/src/index.ts` maps `restrict` → mode `hold`, not `proceed` |
| `parse()` accepted `"stepup"` / `"step-up"` as `STEP_UP` | strictly **more permissive** than denying: `STEP_UP` offers a challenge and so a route to proceeding, `DENY` offers none | the wire vocabulary is exactly four values (`VALID_OUTCOMES` in `lib/signalgrid-core/src/policy.ts`) — neither spelling appears anywhere in the product |

Both were fixed against the source of truth rather than by editing the vectors to
match. **Never make a case pass by weakening it**: a disagreement here is a client
that will mishandle a real gate response.

Two things keep the file itself honest:

- **A non-vacuity floor.** A suite made only of denials is satisfied by a client that
  returns `DENY` unconditionally and decides nothing. The file declares its own
  minimum case count and required outcomes; every client asserts them *before* running
  the cases, and asserts afterwards that a proceedable case actually proceeded.
- **`scripts/check-assist-conformance.mjs`**, which derives the client list from
  `native/*/core` on disk rather than a written-down list — so a fourth client added
  without wiring the vectors fails the gate rather than quietly opting out. It runs in
  `preflight` and in the desktop workflow.

**Not established by a green run:** that the clients' tests *ran* (the language lanes
do that); iOS, which ports the decision engine rather than consuming `/v1` as a wire
client and is covered by `scripts/check-decision-port-parity.mjs`; or the TypeScript
source the vectors were written *from* — a case that misread the product would be
wrong in every client at once, and consistently.

## Required local checks

Before opening or updating a pull request, run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
pnpm run proof:microsoft-graph-sandbox
pnpm run proof:connector-emulator
git grep -nE "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl" -- README.md docs artifacts/signalgrid-review/src || true
git diff --check
```

`PORT` and `BASE_PATH` are required because several Vite review surfaces read those environment variables during production builds.

## Branch protection

After the workflow is available on GitHub, branch protection should eventually require `Review Hub CI` before merge. Recommended settings for `SignalGrid_Alpha`:

- Require status checks before merging.
- Require `Review Hub CI`.
- Require conversation resolution before merging.
- Require the branch to be up to date before merging.

This keeps Review Hub independent from `/DEV` and makes the public validation surface self-protecting.

## The two verification layers added with the zero-cost test wave

- **Real-cryptography proof.** `pnpm run proof:live-idp` (31 checks) boots a
  certified OIDC provider in-process, mints genuine RS256 and DPoP-bound tokens
  over real HTTP, and drives every accept/reject decision through the production
  verifier in `lib/enterprise-auth` — tampered signatures, wrong issuer/audience,
  real 1-second expiry, HS256 algorithm-confusion forged from the provider's own
  public-key bytes, and `cnf.jkt` validated against the RFC 7638 thumbprint of
  the held key before the token-binding dimension is allowed to call the result
  sender-constrained. The fixture proof shows the logic is right; this shows it
  is right against bytes SignalGrid did not fabricate. Fully local, no tenant,
  no cost.
- **Browser-level E2E.** `pnpm run test:e2e` (35 tests, ~126 content-bearing
  assertions) runs Playwright against the BUILT review console, website,
  admin console, desktop client, and mobile PWA (the admin console, desktop
  client, and mobile PWA proxied to a live locally-booted api-server).
  It asserts what a human actually sees — decision evidence rows, reason codes,
  the corrected battery copy — and its maiden run caught a real gap no other
  gate could: a decision-evidence row the core carried and no console scenario
  ever rendered.

## Unsafe-claim scan scope

The CI denylist is intentionally narrow and direct. It checks for production-ready, replacement, partnership, MFi certification, autonomous-remediation, and specific replacement phrases such as `replaces Jamf`, `replaces Intune`, `replaces Apple Configurator`, and `replaces GroundControl`, while allowing explicit disclaimers, guardrail wording, and validation-command lines that document the scanner itself.
