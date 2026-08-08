# SignalGrid SmartDock — the optional embedded hardware layer

> **Status: pre-production hardware design concept.** SmartDock is a public-safe,
> fixture-backed description of a candidate hardware layer. No physical dock is
> built, certified, sold, or contacted anywhere in this repository. Every
> SmartDock signal in the core is a synthetic fixture. SmartDock is **not
> required** to run SignalGrid — the deterministic decision core, the APIs, and
> the apps work with software-only signal sources today. SmartDock is an
> *additional* layer for teams that want more control over the grid and their
> signals.

## What it is

SmartDock is a dedicated, sophisticated phone dock and smart-charging station
with the SignalGrid agent embedded in its firmware. The dock does two physical
things and one digital thing:

1. **Powers and smart-charges** the shared device (charge health, battery
   telemetry, thermal/charge-fault reporting).
2. **Holds custody** — device seating, badge binding at the reader case, and
   tamper-evidence for the device+badge it is responsible for.
3. **Emits normalized signals** — the embedded agent turns all of the above into
   the same vendor-neutral custody/charge/tamper/dock/badge signals the core
   already evaluates, and streams them to the decision layer.

The design intent is deliberately minimal at the edge: **the dock connects to
power and network, and nothing else is required of it.** Every decision — ALLOW /
STEP-UP / RESTRICT / DENY — is made by SignalGrid running either in the SaaS
cloud or on-site (self-hosted). The dock is a trusted, always-on signal source
and a local custody/charging point, not a decision engine of its own. That keeps
the hardware simple, cheap, and long-lived, and keeps the policy, audit, and
review logic in one place where it can be reasoned about.

## Why it exists — more control of the grid and your signals

Software-only signal sources (MDM/UEM posture, identity state, CIS baseline) tell
you a lot, but they are periodic and they don't see the physical world. SmartDock
adds the signals that only hardware at the point of custody can produce, at high
fidelity and in real time:

| SmartDock strengthens | How |
| --------------------- | --- |
| **Presence & binding** | The device and the badge are physically seated in a known bay; the person→shared-device binding is asserted by the dock, not inferred. |
| **Badge custody** | The reader case in the dock reports `present` / `removed` / `forced` continuously — a badge pulled or torn is a signal in milliseconds, not at next check-in. |
| **Smart charging** | Charge state and battery **health** are separate first-class custody signals, because charging fixes one and not the other. A *critically* low battery steps up and clears when the device charges (`low` is carried as evidence with no rule); a *failing* battery restricts and deliberately cannot be cleared by re-docking (`BATTERY_FAILING`). Charge *faults* remain a design target on real hardware, not a modelled signal. |
| **Tamper evidence** | The dock is the tamper witness for the device+badge it holds; a suspected or confirmed tamper changes the runtime decision. |
| **Offline tolerance** | An on-prem SmartDock can buffer custody events through a network blip and reconcile deterministically when connectivity returns. |

These map onto signals the core already evaluates today (`custody_state`,
`charge_state`, `battery_health`, `tamper_state`, `dock_state`, `badge_binding`),
so SmartDock is not a new decision surface — it is a higher-fidelity source for
the surface that already exists. See
[What SignalGrid Does Today](WHAT_SIGNALGRID_DOES_TODAY.md).

## Where it plugs in — a fourth DockBridge ingestion mode

SmartDock is realised in the product core as a DockBridge connector ingestion
mode. The [DockBridge Product Connector](DOCKBRIDGE_PRODUCT_CONNECTOR.md) already
models three ways custody events arrive; SmartDock adds a fourth:

| `ingestionMode` | Meaning |
| --------------- | ------- |
| `app_in_dock` | A generic SignalGrid agent embedded in a third-party dock/cradle reports events. |
| `vendor_api` | SignalGrid polls a dock/locker vendor's existing event API (read-only). |
| `edge_gateway` | An on-site gateway relays dock events. |
| `embedded_smartdock` | The **dedicated SignalGrid SmartDock** — SignalGrid firmware on SignalGrid-designed hardware, emitting the full custody/charge/tamper/dock/badge signal set natively. |

The demo seeds a fixture `embedded_smartdock` connector so the dedicated-dock
path is represented end to end (connector → sync run → normalized signals →
decision → audit), exactly like the other ingestion modes. It is read-only and
performs no dock action; its `credentialRef` is a non-secret placeholder.

## Deployment — SaaS cloud or on-site, your choice

```
SmartDock (power + network in)
   └─ embedded SignalGrid agent  ── normalized signals ─▶  SignalGrid decision core
                                                              ├─ SaaS cloud, or
                                                              └─ on-site / self-hosted
                                                                    │
                                                     operator / admin workflow + audit
```

- The **only required hardware is the dock**, and even the dock is optional — the
  product runs without it.
- **Decisioning runs where you want it**: multi-tenant SaaS cloud, or fully
  on-site for teams that keep everything in their own environment.
- **Additional services are additive, never gating**: fleet provisioning, dock
  fleet health, and managed onboarding are optional services that complete the
  solution; none of them is required to make a decision.
- Systems of record stay external: MDM/UEM owns enrollment and compliance, IAM
  owns identity, ITSM owns tickets, SIEM/SOAR owns detection. SmartDock adds
  custody signal and a charging/custody point; it does not replace any of them.

## Relationship to shared-device access and mobility platforms

Teams running shared and frontline devices often already use a mobile-access or
shared-device platform (for example Imprivata Mobile Access Management /
GroundControl-style tooling). SignalGrid and SmartDock are designed to
**complement and augment** that layer, not to compete with it:

- SignalGrid coexists with an existing shared-device/mobility platform: it
  consumes context and adds a runtime, per-workflow decision and audit layer that
  those platforms do not provide at workflow-execution time.
- SmartDock is a candidate hardware layer that could be delivered as a
  **partnership or investment opportunity** with such a vendor, or offered
  directly where a team wants a more dedicated, SignalGrid-native dock.
- No current partnership, alliance, marketplace listing, validated integration,
  or replacement relationship is claimed with any such vendor. SignalGrid is not
  described as replacing Imprivata, GroundControl, or any mobile-access /
  shared-device product; those remain their owners' systems of record. See the
  [DockBridge Strategy](DOCKBRIDGE_STRATEGY.md) Imprivata note.

## Safety model

- SmartDock is a **read-through custody signal source** in this repository.
  Physical enforcement it could perform on real hardware (badge latch, charge
  management, out-of-service hold) is **simulated and approval-gated** here —
  recorded, never executed on a production system.
- No autonomous production remediation. High-risk custody actions stay
  operator-reviewed and simulated, consistent with the rest of the product.
- Deterministic and fixture-backed: the seeded SmartDock connector produces the
  same signals, decision, and audit chain on every run.

## The firmware core — what is built, and what a green build means

`firmware/dock/core` is a `no_std` Rust crate: the dock's judgement, with no operating
system under it. `.github/workflows/firmware.yml` builds and tests it on every change.

**What the lane proves, in the exact words that are true: it compiles for real MCU
hardware, and its output conforms in simulation.**

| Step | The claim it supports |
| --- | --- |
| `cargo test` (28 tests) | the fail-closed rules behave as written |
| `cargo build --target thumbv7em-none-eabihf` | it builds for a Cortex-M4F: no `std`, no allocator, no OS |
| `readelf -h` on the emitted object | the output really is `Machine: ARM`, not an x86 build wearing a target name |
| `cargo run --example emit_fixtures` → `check-dock-firmware-contract.mjs` | what the firmware **actually emits** is accepted by the fabric |

The three rules the firmware exists to get right, each with tests that fail if removed:

1. **A sensor that did not answer never produces a value.** A silent frame reports
   `unknown` on every axis. One test brute-forces every combination of
   not-reported/faulted across five sensors and asserts no combination ever yields
   `none`, `empty`, `occupied`, `absent`, or `checked_in`.
2. **Tamper latches.** Once a breach is observed it stays `confirmed` until an operator
   acknowledges it — not when the case is closed again, and not when the switch goes
   quiet. A tamper that clears itself is the most security-relevant signal the dock has
   becoming the least reliable one. A broken switch reports `sensor_unavailable`, which
   is a different fact from "no reading" and one an operator can act on.
3. **Custody is never inferred from absence.** An empty bay with no checkout record is
   an `exception` — a device that left without being signed out. It is not
   `checked_out` (nobody claimed it) and certainly not `checked_in`.

Plus one embedded-specific rule, in `wire.rs`: **a buffer that does not fit produces
nothing.** The tempting shortcut is to write until full and send what fits, but
truncated JSON sometimes *parses* — and a record that arrives missing its `tamperState`
is indistinguishable from a dock with nothing to report. A test asserts that *every*
buffer size below the required length refuses, not just the boundary.

The contract gate derives both the field list and the legal values from
`lib/signalgrid-core/src/dock.ts` and `types.ts` rather than restating them, so adding a
state to the fabric and not to the firmware fails the build — and vice versa. It also
requires the fixtures to show more than one value per field, and to include the
silent-dock case; a firmware that answered `unknown` to everything would otherwise pass.

### What a green firmware build does NOT mean

- **No hardware has run this.** Nothing has been flashed to a dock.
- **There is no driver layer, bootloader, secure element, radio, or transport.**
  `SensorFrame` is the seam where a driver would hand readings in. Everything past that
  seam is in this repository and tested; everything before it is not written.
- **Nothing about timing, power, RF, thermal, or the enclosure** is addressed.
- **No firmware-image attestation or secure boot.** A dock that can be reflashed by
  anyone with physical access is a dock whose signals cannot be trusted, and that is an
  unsolved problem here, not a solved one.

## Non-claims

SmartDock is a pre-production hardware design concept. It is not production-ready
hardware, is not certified/authorized/compliant, is not available for sale, does
not replace any MDM / UEM / IAM / MAM / shared-device platform (those remain
systems of record), makes no partnership or MFi claims, and performs no
autonomous remediation on production systems (physical actions are approval-gated
and simulated). Any hardware specification is a design target until a qualified
hardware partner, design, and certification path are validated.
