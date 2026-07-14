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
| **Smart charging** | Charge state, battery health, and charge faults are first-class custody signals, so a device that could die mid-workflow is stepped up before it is handed out. |
| **Tamper evidence** | The dock is the tamper witness for the device+badge it holds; a suspected or confirmed tamper changes the runtime decision. |
| **Offline tolerance** | An on-prem SmartDock can buffer custody events through a network blip and reconcile deterministically when connectivity returns. |

These map one-to-one onto signals the core already evaluates today
(`custody_state`, `charge_state`, `tamper_state`, `dock_state`, `badge_binding`),
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

## Non-claims

SmartDock is a pre-production hardware design concept. It is not production-ready
hardware, is not certified/authorized/compliant, is not available for sale, does
not replace any MDM / UEM / IAM / MAM / shared-device platform (those remain
systems of record), makes no partnership or MFi claims, and performs no
autonomous remediation on production systems (physical actions are approval-gated
and simulated). Any hardware specification is a design target until a qualified
hardware partner, design, and certification path are validated.
