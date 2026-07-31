# Facility Trust Graph — spatial trust as a first-class subsystem

*Status: **design accepted, phase 1 in build**. This document records the
owner's architecture (2026-07-31, intake ledger row 16), what the fabric
already covers, and the honest built-vs-roadmap boundary. Nothing here claims
a live vendor integration exists — this repository is fixture-backed.*

## The capability

Not indoor mapping, and not asset tracking. A spatial trust layer that answers:

> Which trusted user is operating which trusted device, in which **versioned
> physical space**, with **what location certainty**, through which authorized
> doorway, for which assigned workflow, under which facility policy?

The decisive design rule, verbatim from the owner: **do not make Cisco
coordinates, badge events, or room presence individually authoritative**. The
defensible product is the correlation layer that understands when independent
observations agree, conflict, go stale, or lack the precision to automate
safely.

## What the fabric already covers (named, per the intake rule)

| Element of the design | Covering surface |
| --- | --- |
| Badge/door-crossing evidence, out-of-schedule/zone entry, tailgating flags | `pacs-access` (events are evidence, never proof — already its doctrine) |
| "Is the person still inside" — continued observation vs the original badge event | `rtls-custody` (badge dwell), `custody-beacon` (offline recovery) |
| Coarse premises geofence (on/off premises, stale fixes) | `location-services` |
| Device/user trust plane (MDM, EDR, identity, network) | the existing 40 connector families + the decision core |
| MAC ≠ identity — network observation correlated through 802.1X → MDM → device record | `deviceResolver` + `nac` (endpoint identity), `network-nac` (posture) |
| "Physical location is one contextual input, never the sole trust anchor" (NIST ZT) | the composition law: worst-concern-wins; no single signal grants |
| Fail-safe when a source goes dark: unknown raises, never grants | every dimension's doctrine; `signal-radar` for novel/dead sources |
| Cloud / hybrid / local-only deployment modes | `control-plane` + `edge-sync` (config-down, local decisions, WAN-interruption survival) — the Site Context Gateway extends this, not replaces it |
| Patient-record behavior itself | **HOST apps, deliberately** — the embedded-UX law. SignalGrid returns allow/step_up/restrict/deny for the workflow; the EHR host app opens or hides the record |

## What is genuinely missing (the build)

1. **The canonical space model.** `RoomContext` today is flat
   (roomId/unit/sensitivity). There is no hierarchy
   (org → campus → building → floor → security zone → unit → room → bed/door),
   no permanent `space_id`, no vendor-ID **mappings** (Cisco
   campus/building/floor/map/zone ids; access-control area/door/reader ids;
   EHR facility/unit/room/bed; RTLS sensor/anchor ids) attached to a space
   rather than used as its key, and no `map_version`. Without it, a floor-plan
   replacement or vendor migration silently breaks policy.
2. **The certainty ladder.** Nothing grades `accuracy_class`
   (`site | building | floor | zone | room_candidate | room_confirmed |
   bed_candidate | bed_confirmed | unknown`) against a caller-supplied
   **required precision per workflow** ("medication administration requires
   `bed_confirmed`; unit dashboard requires `unit` or better"). Achieved vs
   required is exactly the fabric's shape: policy supplied, evidence derived,
   fail-closed.
3. **Location state as a first-class input**:
   `KNOWN | STALE | CONFLICTED | DEGRADED | UNAVAILABLE`, with stale →
   step-up/grace, conflicted → step-up or deny, unavailable → restricted mode —
   a restricted location must never silently become less secure because a
   location service went offline.
4. **The multi-bed rule, mechanically.** Room presence alone must be
   *unrepresentable* as bed-level certainty: a Wi-Fi room fix is
   `room_candidate` at best, and a workflow requiring `bed_confirmed` on a
   `room_candidate` observation yields **STEP-UP: scan wristband / select
   patient explicitly** — never "open every patient in the room".

## Build phases (mirroring the owner's implementation order)

- **Phase 1 (in build):** `lib/facility-trust-graph` — the space model with
  permanent ids + vendor mappings + map versioning, and a location-certainty
  decision dimension consuming the normalized observation contract
  (`space_id`, `accuracy_class`, `confidence`, `observed_at`, source health;
  the caller's reference instant for staleness, per the no-clock rule).
  Fixture-backed; low-risk automations first.
- **Phase 2:** badge/door correlation — reader → door → portal → adjacent
  spaces mapping in the graph; door crossing + device movement + session
  fusion (directionality, tailgating assumptions, clock skew as *modeled*
  uncertainty, not assumptions).
- **Phase 3:** clinical bed context — ADT/FHIR location normalization into
  the graph; bed-level RTLS classes; the wristband-scan step-up path. Patient
  semantics stay in the host app.
- **Phase 4:** Site Context Gateway — the local-only/hybrid deployment mode
  built on `edge-sync`/`control-plane`: local normalization and sensitive
  joins, pseudonymized minimum telemetry upstream, immutable local audit,
  defined restricted mode when sources are unavailable.

## Vendor and standards positioning (no dependency taken)

- **Location observations:** Cisco Spaces / Meraki / CMX (Firehose
  `DEVICE_LOCATION_UPDATE` as the adapter reference; the DevNet samples are
  study material, to be rewritten as a hardened ingestion service, never used
  unchanged). Cisco Spaces for Government's FedRAMP Moderate authorization is
  relevant to some deployments and automatically sufficient for none.
- **Spatial system of record:** ArcGIS Indoors (strongest), or a self-hosted
  PostGIS + IndoorGML/GeoJSON model; Mappedin as map *experience*, not policy
  authority. OGC IndoorGML 2.0 informs the topology vocabulary.
- **Physical access head-ends:** Genetec, LenelS2 OnGuard, Gallagher,
  C•CURE 9000 — SignalGrid integrates at the head-end API. OSDP/libosdp sits
  *below* the badge system, not in place of it; Secure Channel where
  supported.
- **Healthcare RTLS:** CenTrak, Kontakt.io, Securitas/Sonitor, Zebra UWB —
  the precision layer for multi-bed and sensitive areas, deployed selectively.
- **Naming note:** the physical-access family in this repo is `pacs-access`;
  in healthcare-facing docs the expansion is always "physical access control
  system" — never bare "PACS", which collides with radiology picture archiving.

Every one of these remains behind the repository's connector discipline: tier
gate + `SIGNALGRID_LIVE_INTEGRATIONS` + credential + an injected transport
this repo does not ship.
