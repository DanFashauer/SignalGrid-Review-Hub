# Signal sourcing — how each signal reaches the Grid

SignalGrid fuses many signals into one decision. **How good that decision is
depends on how the source systems are configured**, because every signal has to
get to the Grid somehow. There is no magic: if a system exposes its state, the
Grid reads it; if it does not, the Grid either collects the signal another way or
surfaces the gap. This page states that boundary plainly so no claim over-reaches.

Modeled in code as `@workspace/flows` → `signal-sourcing.ts`
(`AcquisitionMethod`, `projectSourcingAsSignalStates`, `summarizeSourcing`,
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
  proxy. The signal is still obtainable, but it is flagged **lower fidelity** and it
  costs more to stand up. `projectSourcingAsSignalStates` still counts it as wireable;
  `fidelityOf` reports the reduced confidence so nothing over-trusts a signal the Grid
  had to synthesize.
  - *A concrete, shipped example:* `signalgrid-mcp` (`DanFashauer/signalgrid-mcp`,
    released) reads **macOS device posture** — device identity, OS build, security
    controls (firewall, stealth mode, FileVault, SIP, Gatekeeper), MDM enrollment,
    patch/update state, XProtect currency, network posture, persistence, and backup
    state — **directly from the endpoint, read-only**, where no vendor API/MDM hook
    is assumed. That is exactly the `grid_collected` path: the Grid obtaining a signal
    itself. It is honest about "unknown" (a check that can't run returns unknown, never
    a false green), the same fail-safe discipline this model enforces. The server also
    **self-describes** how each of those signals plugs into this model — the MCP
    resource `signalgrid://sourcing` publishes, for every posture section, the fabric
    signal it feeds, its acquisition method (`grid_collected`), and its fidelity
    (`medium` — authoritative but self-collected, so never over-trusted), pinned by a
    test so it can't drift from the signals the server actually emits. See
    [API access & connectors](API_ACCESS_AND_CONNECTORS.md).
- **Gaps are surfaced, never hidden.** An `unavailable` source yields **no signal
  state at all** — it reads as missing downstream (fail-safe). The Grid never
  reports a situation as autonomously handled when the signal it depends on cannot
  be obtained. In the coverage model that situation stays `partial` (or a
  `blind_spot`), and the fix is explicit: add an integration, stand up a collector,
  or accept the gap.

## How it drives the outcome

Feed the sourcing posture into grid coverage and the dependency is exact:

(Read these as ceilings — see *Wireable ≠ wired* below. They describe what the
sourcing posture allows, not what is running.)

- Every required signal available via `api` / `native` → the Grid *could* handle its
  situations on its own once those signals are wired and healthy.
- A required signal is `grid_collected` → still wireable, so it does not lower the
  ceiling — the Grid does the lifting — but the sourcing summary shows it was the
  Grid's work, not the vendor's.
- A required signal is `unavailable` → its situation drops out of the ceiling
  entirely. That is a truthful gap, not a false green.

So "the more you add, the smarter the Grid" (see `docs/inspiration/INSPIRATION.md`)
carries a caveat this model makes explicit: *what you can add, and at what fidelity,
is dictated by what your existing systems support* — and where they support nothing,
the Grid does the lifting or the gap is named.

### Wireable ≠ wired ≠ delivering ≠ healthy

Everything above is about **acquisition posture** — how a signal *could* reach the
Grid. None of it observes anything. That distinction used to be lost the moment
sourcing met coverage, because the projection emitted `status: "healthy"` into a
health vocabulary and the coverage result went on to report situations as "active
and fully fed" with a percentage documented as what the Grid handles *right now*.
Four states collapsed into one, and the resulting present-tense claim was assembled
from a configuration fact nobody had measured.

`projectSourcingAsSignalStates` therefore returns a tagged `SourcingProjection`
rather than a bare array, and `evaluateGridCoverage` **derives** `coverage.basis`
from what it was handed:

| Input | `basis` | What the numbers mean |
|---|---|---|
| `SignalState[]` (real observations) | `observed` | What the Grid handles right now. |
| `SourcingProjection` | `projected_from_sourcing` | A **ceiling** — what it would handle once every wireable signal is wired and healthy. `unavailable` sources still cap it. |

Under a projection the per-situation wording changes too, not just the tag: a
"handled" situation reads *every signal it requires has a wireable source … nothing
here was observed*, never "fully fed". There is no flag to pass, so there is none to
set wrongly and none to forget — the basis follows the argument. `GET
/cp/v1/grid/coverage` serves a projection and says so; `summarizeGridConfig` names
its field `coveragePctAtFullHealth` for the same reason. Pinned by
`proof:grid-coverage`, including that the basis changes the claim and never the count.

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
