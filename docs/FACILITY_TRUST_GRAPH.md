# Facility Trust Graph — spatial trust as a first-class subsystem

*Status: **phases 1–4 BUILT** (`@workspace/facility-trust-graph`, proven by `proof:facility-trust-graph`; phase 4 is the gateway's pure decision/data core — transport and deployment remain `control-plane`/`edge-sync`). This document records the
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

- **Phase 1 (BUILT):** `lib/facility-trust-graph` — the space model with
  permanent ids + vendor mappings + map versioning, and a location-certainty
  decision dimension consuming the normalized observation contract
  (`space_id`, `accuracy_class`, `confidence`, `observed_at`, source health;
  the caller's reference instant for staleness, per the no-clock rule).
  Fixture-backed; low-risk automations first.
- **Phase 2 (BUILT):** badge/door correlation. Doors are PORTALS: `connects`
  declares the space(s) a door opens to (validated — into nowhere, into
  itself, into another door, or on a non-door all refuse at build), and
  `doorSides()` derives the full set either direction touches.
  `correlateCrossing()` grades one crossing against one subsequent
  observation: **corroborated** (observed in a side or its descendant, inside
  the caller's window — carried as evidence, deliberately never an accuracy
  upgrade), **contradicted** (observed where the door does not lead:
  passback, tailgate, or a cloned badge → alert), **unassessed** (before the
  crossing or outside the window — no claim posed; clock skew lands here
  honestly, never as a silent pass), and every unreadable input raises.
- **Phase 3 (BUILT):** clinical bed context, three pieces in `clinical.ts`:
  - **ADT/FHIR assignment resolution** — an EHR record's unit/room/bed
    identifiers resolve through vendor attachments (never keys) to ONE
    coherent target space. An assignment is ADMINISTRATIVE truth ("this
    workflow concerns bed A"), never a location observation; a record whose
    bed does not descend from its own stated room or unit is `incoherent` —
    an anomaly, never "probably the bed" — and a stated identifier with no
    attachment is `unmapped` → alert.
  - **Source-capability ceilings** — the maximum class each recognized
    technology can physically vouch for (Wi-Fi → `room_candidate` at best;
    IR/ultrasound/UWB RTLS → `bed_confirmed`; the generic `rtls` label →
    nothing). A claim above the ceiling is NOT demoted to the ceiling — a
    caught lie gets no partial credit; the certainty becomes `unknown`, the
    verdict an alert a ceremony cannot cure.
  - **The wristband-scan step-up path** — when certainty cannot carry a
    bed-level workflow (insufficient precision, wrong-bed mismatch, no
    assignment at all, location gone dark), the verdict is a step-up whose
    satisfier is an explicit-selection ceremony in the HOST app
    (`wristband_scan` / `manual_selection`); the host attests only that the
    ceremony happened and when — no patient identifier crosses the boundary
    (an extra key is `malformed`). A valid, fresh attestation (supplied
    bound, supplied reference instant — no clock) lets the workflow proceed
    **without ever upgrading the accuracy class**, and it satisfies only
    step-up-class concerns: never a wrong map, a broken clinical mapping, or
    a source claim above its ceiling.
- **Zone-presence transitions (BUILT, intake row 17):** the geofence
  entry/exit state machine in `transition.ts`, from the session-control
  research report. Presence is EARNED — continuous in-zone evidence spanning a
  caller-supplied entry dwell; one radio blip never starts a session. Exit is
  CONFIRMED — only an affirmative observation outside a caller-supplied
  containment boundary (hysteresis via the graph: out of the room is not out
  of the unit) past the exit grace; one missing observation never revokes,
  and sensor silence can EXPIRE presence (step up, attenuate) but never
  manufactures the affirmative "they left". States:
  `present | crossing | probably_outside | confirmed_outside | never_present |
  unknown`; disordered, future-dated, or unreadable sequences raise. No clock:
  every instant is supplied, every bound is caller policy.
- **Phase 4 (CORE BUILT):** Site Context Gateway — the hybrid-deployment
  boundary's pure decision/data core, in `gateway.ts`:
  - **The minimization projector** (`projectUpstreamRecord`): the sensitive
    join happens locally; the cloud receives ONLY outcome, reason codes, a
    coarse zone, a pseudonym, device tier, source health, latency, and the
    audit anchor. The projector REFUSES what it does not recognize rather
    than stripping it — a silently dropped `patient_id` would teach callers
    to keep sending one. Spatial content coarsens THROUGH THE GRAPH to a
    caller-supplied kind ceiling; when the coarse zone cannot be derived the
    record carries nothing spatial, never the precise id. A cheap tripwire
    refuses email-shaped pseudonyms (a tripwire, not proof of pseudonymity).
  - **The restricted-mode grader** (`deriveGatewayMode`): the operator poses
    which local sources their high-trust workflows require; a required source
    unavailable, unrecognized, or simply ABSENT from the health report
    (absence is not health) puts the gateway in a defined `restricted` mode
    with location-derived privileges WITHDRAWN — a restricted place never
    silently loosens because location went dark. A gateway that cannot read
    its own health report is itself restricted. Non-required sources never
    restrict (the posed set governs).
  - **The audit anchor**: the local trail is NOT rebuilt here —
    `@workspace/audit` is already an atomic hash-chained ledger. The upstream
    record carries the local chain HEAD (`audit_head`), so the control plane
    can detect local tampering or truncation without ever receiving the
    sensitive records themselves.
  - **Honest boundary:** transport, sync cadence, config-down integrity
    (bundle checksums + signatures), and counts-only aggregation remain
    `control-plane`/`edge-sync`. Nothing in this package opens a socket.

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
- **Session-signal path (roadmap, row 17):** OpenID CAEP / Shared Signals is
  the natural OUTBOUND channel for telling cooperating applications that a
  session's context changed (exit confirmed, posture dropped, presence
  expired). It is an emitter, so when built it lands behind the same emitter
  discipline as itsm/siem/syslog/telemetry/webhooks — dev/alpha never emit.
  OAuth introspection / short-lived tokens are the consuming side and are
  already modeled by `token-binding` and `sso-session`.
- **Bootstrap credentials (queued candidate, row 17):** TAP-style temporary
  access grading — one-time, shortest-practical, enrollment-scope-only,
  location as corroboration never the sole verification factor.
- **Naming note:** the physical-access family in this repo is `pacs-access`;
  in healthcare-facing docs the expansion is always "physical access control
  system" — never bare "PACS", which collides with radiology picture archiving.

Every one of these remains behind the repository's connector discipline: tier
gate + `SIGNALGRID_LIVE_INTEGRATIONS` + credential + an injected transport
this repo does not ship.
