# Signal sourcing — how each signal reaches the Grid

SignalGrid fuses many signals into one decision. **How good that decision is
depends on how the source systems are configured**, because every signal has to
get to the Grid somehow. There is no magic: if a system exposes its state, the
Grid reads it; if it does not, the Grid either collects the signal another way or
surfaces the gap. This page states that boundary plainly so no claim over-reaches.

Modeled in code as `@workspace/flows` → `signal-sourcing.ts`
(`AcquisitionMethod`, `sourcingToSignalStates`, `summarizeSourcing`,
`fidelityOf`), and exercised by `pnpm run proof:grid-coverage`.

## The four acquisition paths

| Method | What it means | Fidelity | Who does the work |
|---|---|---|---|
| **`api`** | The source system exposes a read API the Grid polls (read-only). | High | The system |
| **`native`** | A supported native / partner integration feeds it — webhook, SCIM, event stream, first-party connector. | High | The system |
| **`grid_collected`** | The system offers no usable API or native hook, so **SignalGrid does the lifting itself**: a collector/agent, log & syslog ingestion, network / DEX observation, or a derived signal. | Medium (Low if it's a coarse proxy) | SignalGrid |
| **`unavailable`** | No API, no native hook, and nothing the Grid can collect. The signal **cannot be wired here** — a real gap. | None | Nobody — it's a gap |

## Why this is the honest boundary

- **Vendor-integrated first.** Where a system integrates (API or native), the Grid
  consumes the signal directly — highest fidelity, least effort. This is the
  preferred path for every signal.
- **The Grid compensates where it must.** Where a system won't integrate, the Grid
  does the lifting — a collector, log ingestion, network observation, or a derived
  proxy. The signal is still delivered, but it is flagged **lower fidelity** and it
  costs more to stand up. `sourcingToSignalStates` still wires it (it is present and
  working); `fidelityOf` reports the reduced confidence so nothing over-trusts a
  signal the Grid had to synthesize.
  - *A concrete, shipped example:* `signalgrid-mcp` (`DanFashauer/signalgrid-mcp`,
    released) reads **macOS device security posture** — firewall, stealth mode,
    FileVault, SIP, Gatekeeper — **directly from the endpoint, read-only**, where no
    vendor API/MDM hook is assumed. That is exactly the `grid_collected` path: the
    Grid obtaining a signal itself. It is honest about "unknown" (a check that can't
    run returns unknown, never a false green), which is the same fail-safe discipline
    the model enforces. See [API access & connectors](API_ACCESS_AND_CONNECTORS.md).
- **Gaps are surfaced, never hidden.** An `unavailable` source yields **no signal
  state at all** — it reads as missing downstream (fail-safe). The Grid never
  reports a situation as autonomously handled when the signal it depends on cannot
  be obtained. In the coverage model that situation stays `partial` (or a
  `blind_spot`), and the fix is explicit: add an integration, stand up a collector,
  or accept the gap.

## How it drives the outcome

Feed the sourcing posture into grid coverage and the dependency is exact:

- Every required signal available via `api` / `native` → the Grid can handle its
  situations on its own.
- A required signal is `grid_collected` → still wired, still handled — the Grid did
  the lifting — but the sourcing summary shows it was the Grid's work, not the
  vendor's.
- A required signal is `unavailable` → its situation drops out of autonomous
  coverage. That is a truthful gap, not a false green.

So "the more you add, the smarter the Grid" (see `docs/inspiration/INSPIRATION.md`)
carries a caveat this model makes explicit: *what you can add, and at what fidelity,
is dictated by what your existing systems support* — and where they support nothing,
the Grid does the lifting or the gap is named.

## Seeing it — the operator surface

The operator console (mobile PWA, `artifacts/signalgrid-app`) has a **Signal
sourcing** view that reads this live from `GET /cp/v1/grid/sourcing`:

- a rollup — wireable / vendor-integrated / grid-lifted / **gaps**;
- a **Gaps panel** that appears only when a signal is `unavailable`, naming the
  fix (add an integration, stand up a collector, or accept the gap);
- a per-signal table: signal → source system → **path** (API / native /
  grid-collected / gap) → **fidelity** → who does the work.

The demo signal set is deliberately mixed: vendor-integrated signals at high
fidelity, a grid-collected signal marked **low** fidelity (a coarse proxy the Grid
had to synthesize), and one genuine **gap** (a legacy nurse-call system with no API)
— so the honest boundary is visible on screen, not just asserted. The view is
read-only.

## Boundary

This does not claim SignalGrid can extract data a vendor does not expose without
doing the lifting, nor that grid-collected signals equal first-party API fidelity,
nor any partnership/certification with the named systems. Connectors are read-only;
see `docs/WHAT_SIGNALGRID_DOES_TODAY.md` and `docs/INTEGRATION_CATALOG.md`.
