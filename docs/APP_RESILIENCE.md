# Application resilience — keep staff working through cloud-app downtime

Clinical environments run on a suite of applications — EHR, BCMA, HIS, comms,
drug reference. When a vendor cloud app has an **unplanned outage**, enters a
**planned maintenance window**, or **degrades**, the technology becomes the
bottleneck: staff get stuck, device fatigue spikes, and care slows. SignalGrid
turns an app's availability into a **resilience decision** so people keep working
— PHI-safely — instead of hitting a dead end.

Modeled in `@workspace/flows` → `app-resilience.ts`
(`resolveAppResilience`, `fleetResilience`), proven by
`pnpm run proof:app-resilience`. Availability is an **input** obtained like any
signal (see `docs/SIGNAL_SOURCING.md`); nothing here calls a vendor.

## Availability → resilience mode

| App availability | Mode | Staff can proceed? |
|---|---|---|
| `available` | `normal` — work normally | Yes |
| `degraded` | `degraded_monitor` — proceed, the Grid watches | Yes |
| `unknown` | `degraded_monitor` — proceed, **flagged unverified** (never assumed healthy) | Yes |
| `planned_maintenance` / `unplanned_outage` **with** a ready fallback (and, for PHI, safety nets) | `downtime_fallback` — on the prepared downtime path | Yes |
| `planned_maintenance` / `unplanned_outage` **without** a safe path | `blocked_no_fallback` — surfaced, escalate | No |

## The PHI safety net (non-negotiable)

A downtime fallback for an app that handles **regulated data (PHI/PII)** is offered
**only** when its disaster-recovery safety nets are configured (e.g. a DR
checkpoint, post-hoc reconciliation, a witness) — the same break-glass principle
as `user_override_on_downtime` in the flow engine. Without them, the posture is
`blocked_no_fallback`, never an unsafe PHI workaround. The proof pins the headline
invariant: **a PHI app is never placed on a downtime fallback without safety
nets**, at any availability.

## Why this matters

- **Device fatigue / technology-as-bottleneck** is a leading pain in clinical (and
  other mobile-heavy — warehouse, retail, field) settings. Auto-routing to a
  prepared, safe fallback keeps people moving instead of stuck at a frozen screen.
- **Change management & DR** become first-class: a maintenance window is a known,
  planned downtime the Grid routes around; an unplanned outage without a plan is
  surfaced honestly, not papered over.
- **Fleet view:** `fleetResilience` rolls up a whole app suite — how much staff can
  still use, and whether anything is `blocked` — so an outage's blast radius is one
  glance, not a scramble.

## Boundary

Availability is modeled/simulated here from an input, not scraped from a vendor
status page; SignalGrid does not claim a live status integration with any named
application. Fallbacks are described, not executed — real downtime enforcement
stays approval-gated and simulated until an owner enables it. No
partnership/certification with any application vendor is implied. See
`docs/WHAT_SIGNALGRID_DOES_TODAY.md`.
