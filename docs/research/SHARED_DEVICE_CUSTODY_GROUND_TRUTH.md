# Shared-device custody — the real operating ground truth, held against this tree

**Date: 2026-09-04. Intake: the owner supplied the operational runbooks for a real
large-hospital shared-clinical-device deployment (L1/L2 support guides, iOS device-prep
and update guides, macOS setup) as the "why" behind SignalGrid, absorbed by use per
DR-021 — the workflow and its failure taxonomy were mapped onto the repository's real
event contract, connector families, detections and remediation path, not summarized from
memory. The source runbooks are confidential customer material and are NOT committed; this
map is generalized, with no customer, personnel, purchase-order, site, internal-URL,
directory-group or network-address specifics.**

## Why this file exists

`docs/PURPOSE.md` states the thesis in the abstract: *you do not need a single monolithic
vendor; you need a good event contract and deterministic playbooks.* This document is that
thesis measured against a real deployment — the concrete, un-abstract world SignalGrid
models, so the fixtures, detections and positioning are held to something true rather than
imagined.

## How to read this

Each row is a real-world element (a workflow step, a signal, or a failure mode observed in
the runbooks) mapped to the SignalGrid surface that represents it, with a status:

- **modeled** — a shipped, fixture-backed surface represents it; the path is cited.
- **partial** — a surface represents part of it; the gap is named.
- **gap** — nothing represents it yet; filed as a backlog row, not implied to exist.

Nothing here is a claim that SignalGrid runs in this or any deployment. It is a fidelity
map between a real domain and the deterministic simulator.

## The real workflow (generalized)

A clinician taps a badge at a charging dock, a shared iPhone unlocks and is checked out to
them, they use it for a shift, and they return it to any dock where it checks itself back
in, re-provisions, and recharges. Underneath that one gesture sits a multi-vendor mesh:

- a **badge-based mobile access management (MAM)** platform driving check-out / check-in
  (the category SignalGrid's competitive brief already covers — see
  [Imprivata comparison](COMPETITIVE_IMPRIVATA.md));
- **charging docks** with per-bay light and beep state (white/green/red/blue), each seated
  device a custody slot;
- a **UEM / MDM** holding device policy and compliance;
- **Apple supervision identity** ("device trust") — without it, no management command runs;
- a local **internet-connection-sharing** layer (a tethering host on the site network) that
  every workflow silently depends on.

Two facts run through every page of the runbooks, and they are exactly SignalGrid's design
premises:

1. **Nearly every failure root-causes to network or pairing** — an untethered device, a
   stuck USB multiplexer, a phantom device, a lost supervision identity. An unknown or
   unreachable signal is the norm, not the exception, which is why golden rule 2 (unknown
   raises assurance, never lowers it) is the whole game.
2. **Remediation today is manual tribal knowledge** — an L1→L2→tier-3 ladder of reboots,
   console clicks and terminal commands. The runbooks *are* the product. A deterministic,
   fixture-backed remediation cascade is what replaces them.

## The mapping

| Real-world element | SignalGrid surface | Status |
| --- | --- | --- |
| Badge tap → check-out / check-in lifecycle | `checkout_requested/granted/denied`, `device_removed`, `device_returned`, `badge_access` event types in [`lib/event-contract/src/types.ts`](../../lib/event-contract/src/types.ts) | modeled |
| Dock bay state (seated / unlocked / relocked / timed-out) | `dock_unlocked`, `dock_relocked`, `dock_timeout` event types (same contract); custody signalled by the [`custody-beacon`](../../lib/integrations/src/integrations/custody-beacon) and [`rtls-custody`](../../lib/integrations/src/integrations/rtls-custody) families | modeled |
| Badge / physical-access authority (zone entry) | [`pacs-access`](../../lib/integrations/src/integrations/pacs-access) and [`passkey-assurance`](../../lib/integrations/src/integrations/passkey-assurance) families | modeled |
| Device "trust" = Apple supervision identity present | [`device-attestation`](../../lib/integrations/src/integrations/device-attestation) family — supervision/attestation as a trust precondition | partial (attestation modeled; the specific supervision-identity lifecycle is not a distinct fixture) |
| UEM / MDM posture (compliant / unmanaged / unknown) | [`lib/ddm-connector`](../../lib/ddm-connector) + [`macos-posture`](../../lib/integrations/src/integrations/macos-posture) + [`device-management-health`](../../lib/integrations/src/integrations/device-management-health); unknown/unreporting posture only *raises* assurance | modeled |
| Network dependency (802.1x site net; tethered vs offline) | [`nac`](../../lib/integrations/src/integrations/nac) / [`network-nac`](../../lib/integrations/src/integrations/network-nac) for network authority; `reachability_changed` + `carrierConnectivityState` in the event contract; [`carrier`](../../lib/integrations/src/integrations/carrier) for the "alive on cellular" signal | modeled |
| Decision must still be made when the network is down | [`local-authority`](../../lib/integrations/src/integrations/local-authority) family (offline/degraded, fail-closed) | modeled |
| Manual check-out fallback (credentials when badge fails) | [`break-glass`](../../lib/integrations/src/integrations/break-glass) family — an explicit, audited override path | partial (override modeled; the badge→manual fallback sequence is not a distinct fixture) |
| iOS update / device-prep workflows | [`app-update`](../../lib/integrations/src/integrations/app-update) family | partial |
| Shift-change automation windows (maintenance runs before/after shift) | [`change-window`](../../lib/integrations/src/integrations/change-window) family | modeled |
| Cross-domain detection: checked out but never became compliant | `CHECKOUT_WITHOUT_COMPLIANCE` in [`lib/event-contract/src/detect.ts`](../../lib/event-contract/src/detect.ts) | modeled |
| Cross-domain detection: dock tamper + connectivity loss | `DOCK_TAMPER_WITH_NETWORK_LOSS` (same file) | modeled |
| Cross-domain detection: dark in MDM yet alive on cellular/badge | `INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE` (same file) | modeled |
| Deterministic remediation cascade (what the L1/L2 ladder does by hand) | [`lib/signalgrid-simulator/src/remediation-allow.ts`](../../lib/signalgrid-simulator/src/remediation-allow.ts), proven by [`scripts/src/remediation-allow-proof.ts`](../../scripts/src/remediation-allow-proof.ts) | modeled |
| **Custody integrity: a returned device still checked out to a prior holder / "unpaired" but occupying a slot** | — | **gap** |
| **Per-user checkout cap (a hard limit silently blocking a clinician when a prior return did not clear)** | — | **gap** |
| **A faithful end-to-end "smart-charging" simulator scenario (badge → dock → provision → in-use → check-in, with the real failure branches)** | — | **gap** |

## The three gaps, and why they are worth filing

The mapping is dense with **modeled** rows — the domain fits the existing surfaces almost
one-to-one, which is the strongest evidence yet that the event-contract-first design was
the right bet. Three fidelity gaps are genuine and filed as backlog rows rather than
implied:

1. **The "phantom custody" detection.** The single most-cited operational pain is a device
   that reads as checked-out to someone who already walked away, or occupies a dock slot
   while unpaired — a custody-state contradiction across the dock, MAM and posture planes.
   This is exactly the shape `detect.ts` exists to catch, and no current detection covers
   it. A `CUSTODY_STALE_OR_CONTESTED`-style detection (deterministic, fixture-backed) is the
   highest-value addition.
2. **The checkout-cap contradiction.** A per-user cap that blocks a clinician because a
   prior return failed to clear is a decision the fabric should surface, not a mystery beep
   at the dock. Modeling it needs a small state addition and a fixture.
3. **A faithful scenario.** The simulator should carry one end-to-end scenario shaped like
   the real workflow and its failure branches (unpaired / network-down / cap-hit /
   dock-fault), so proofs exercise the real thing.

Because all three touch the decision core / simulator (behavior, DR-020 territory), they
are proposed here and filed to [`docs/BUILD_BACKLOG.md`](../BUILD_BACKLOG.md) for a decision
record, not changed unilaterally.

## What this sharpens beyond code

The runbooks are the definitive discovery and positioning input the company has been
missing: the buyer's real pain is *un-rootable failures and manual remediation across a
vendor mesh*, and SignalGrid's answer is *one event contract + deterministic playbooks +
the worker never sees it*. That narrative belongs in discovery preparation
([`.claude/skills/research-ops`](../../.claude/skills/research-ops)) — the ground truth here
is its evidence base.
