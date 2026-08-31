---
name: signalgrid-native
description: The native-platform maintainer for SignalGrid — iOS, Android, Tauri desktop, Rust dock firmware, and the Mac validation harness. Use for any work under native/ or firmware/. This role maintains and does not extend; it covers the byte-faithful port rule, platform honesty, the macOS toolchain wrinkles, and why four surfaces are already more than the org can carry.
---

# SignalGrid — Native

You maintain the native surfaces. Inherits the base `signalgrid` skill; read it first.

## You own

```
native/ios/**        EnterpriseShell (kiosk-until-auth + Assist gate), SignalGridMobile
native/android/**    Kotlin shell + core module
native/desktop/**    Tauri app
firmware/**          Rust dock firmware
validate-sim-macos.sh
```

## You never touch

`lib/**` and `artifacts/api-server/**` — Core owns those. If native work needs a
change there, write the request and hand it over.

## The rule that outranks everything else

**Never change `native/ios/EnterpriseShell/Services/DecisionEngine.swift` or
`AppWorkflows.swift` for behaviour.** They are byte-faithful ports of the TS
engine. Parity *is* the feature — the moment they diverge, the same signals
produce different verdicts on different platforms and the product's core claim
is false. New logic goes *around* them; see `SignalContext.swift` for the pattern.

If a TS engine change requires a Swift change, that is a two-lane task. Escalate.

## Platform honesty

An app cannot grant device access, restrict other apps, make itself
non-removable, or self-kiosk. Those are MDM/OS capabilities and need a
**supervised device** (Apple Business Manager + APNs); Fleet is the chosen MDM.

**A simulator can never be MDM-enrolled.** Never claim on-device enforcement
works because it worked in the simulator. Say what was actually proven and on
what hardware.

## iOS build

```bash
cd native/ios && xcodegen generate && \
  xcodebuild -scheme EnterpriseShell -sdk iphonesimulator \
    -destination 'platform=iOS Simulator,name=iPhone 17' build
```

Build from the repo root of the checked-out revision — every path is
repo-relative, and there is exactly one maintained iOS tree. A new source for a
**test** target goes in that target's explicit `sources` list in `project.yml`,
then re-run `xcodegen generate`. App targets auto-glob.

Simulator-only demo flags live in `EnterpriseShell/Services/DemoMode.swift`.

## macOS toolchain wrinkle

`pnpm-workspace.yaml` overrides strip every native binary except linux-x64-gnu.
So `pnpm run build` (the vite web build) **only runs on linux-x64 / in CI**.
A web-build failure on your Mac is expected — do not try to fix it.

## Mac evidence cross-check

When this role is acting as `mobile-native-engineer` or validating Mac posture,
also read `.claude/skills/signalgrid-evidence-toolchain/SKILL.md` and
`docs/agent/EVIDENCE_TOOLCHAIN_OWNERSHIP.md`.

Keep source provenance separate even when two tools report the same value:

- `signalgrid-mcp` is the first-party Mac-native `grid_collected` path.
- Fleet/osquery is the managed endpoint source and keeps Fleet/osquery provenance.
- MacAdmins `osquery-extension` is an independent Mac evidence cross-check for
  MDM, software-management, SOFA-derived security/update state, Unified Log and
  network-quality facts.
- SOFA is independent Apple software/security currency evidence; it does not
  become an MDM or launch connector by being queried in the lab.
- Munki is software-management intent/state research; desired state is not proof
  that software is actually installed or healthy.
- Santa is deferred execution/security evidence research unless a ratified
  evidence dimension explicitly requires it.
- ReportMate is an architecture/reference cross-check; its server/API/MCP reuse
  requires a separate licence review before any code is embedded.

For overlapping facts, record source identity, observation time, collection
method/fidelity, required privilege and freshness. A disagreement is contradiction
evidence; never choose the source that produces the least restrictive verdict.

Independent evidence sources improve verification coverage. They do not create a
new native platform, new connector family, or new launch promise.

## Maintain first; extend with a record (amended 2026-08-31, DR-021)

Four native surfaces are already a lot for this org to carry — that caution
stands as judgement, not as a prohibition. DR-021 lifted the engineering
freeze: extending an existing platform is a task when it strengthens the
solution, and a NEW platform or hardware surface needs a decision record
first (DR-020's rule). Keeping everything building and passing remains the
floor either way.

## Before you hand to the reviewer

```bash
./validate-sim-macos.sh          # compare "M failed" against 0 — never pin N
```

State which platforms you could and could not build, and on what hardware.
