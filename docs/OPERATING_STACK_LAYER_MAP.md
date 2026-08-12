# SignalGrid IT Operating Stack Layer Map

**Status:** organizing taxonomy, adopted by owner instruction (intake ledger
row 34). This is a LENS over what already exists — a derived view whose
canonical sources remain `INTEGRATION_CATALOG.md`, the family code under
`lib/`, and the filed reference catalogs in `docs/inspiration/`. It creates no
new families, changes no verdict, and — per the owner's own boundary — **does
not expand the launch scope**: the launch path stays Microsoft Entra + Intune
→ one shared-device host app → one customer-approved sandbox → one live
decision loop → then expand across the operating stack.

Provenance: adapted from a six-layer "IT Operating Stack" framing supplied by
the owner (third-party Excellog.Biz infographic — digital workplace, network &
connectivity, cloud & infrastructure, IT service management, data &
integration, governance/FinOps/architecture). The seventh layer is the
SignalGrid extension the poster's taxonomy has no slot for: the physical and
operational world the fabric was built to see. No dependency is taken on any
tool named in the poster; every vendor named below is either a consumed
category (see `ECOSYSTEM_POSITIONING.md`) or a filed-catalog reference.

## The executive framing

> SignalGrid turns the IT operating stack into a decision fabric. Digital
> workplace, network, cloud, ITSM, integration, governance, and
> physical-world signals become one explainable allow / step-up / restrict /
> deny decision with routed ownership and audit evidence.

SignalGrid is not endpoint management, not identity, not physical access, not
ITSM, and not integration monitoring. It is the trust and workflow-decision
layer ACROSS those layers, answering at the moment of action: who is acting,
on what device, through what network, against what app and workflow, on which
infrastructure, with what evidence, policy, risk, owner, and audit trail.

## The seven layers

`operatingStackLayer` allowed values (the catalog-overlay enum):

| Value | Layer | The question SignalGrid asks there |
| --- | --- | --- |
| `digital_workplace` | Digital Workplace | Is this user, device, and app in a trustworthy state for THIS action? |
| `network_connectivity` | Network & Connectivity | Can this session safely reach what it needs — and is it actually traversing the mandated paths? |
| `cloud_infrastructure` | Cloud & Infrastructure | Is the backend healthy and authorized (a plane the fabric consumes as evaluated posture, never probes)? |
| `itsm_workflow` | IT Service Management | Who owns the exception, and did the response actually resolve it? |
| `data_integration` | Data & Integration | Are the signals, events, and evidence flows themselves reliable? |
| `governance_finops_architecture` | Governance, FinOps & Architecture | Is the action aligned to policy, approval, and risk — with an auditable trail? |
| `physical_operational_context` | Physical / Operational (SignalGrid extension) | What is happening in the real world — badge, room, dock, bin, task, custody? |

## Layer-by-layer map of the existing fabric

A derived index of where every existing surface sits. Families that genuinely
straddle layers are listed at their PRIMARY layer with the straddle noted.
FinOps is listed honestly as not modeled — cost signals are an operator's
caller-supplied policy if they ever arrive, never a fabric invention.

### `digital_workplace` — user, device, and app state

Read families: `uem`, `graph`, `device-management-health`, `macos-posture`,
`device-attestation`, `app-update`, `benchmark-selection`, `policy-binding`,
`edr-threat`, `vuln-scan`, `data-protection`, `peripheral-control`,
`credential-exposure`, `identity-risk`, `sso-session`, `platform-sso`,
`passkey-assurance`, `token-binding`, `oauth-consent`, `bootstrap-credential`,
`challenge-capability`, `access-governance`, `agent-identity`,
`agent-behavior`, `telemetry` (FleetDM read side). Identity is deliberately
filed here rather than in its own layer: this taxonomy's frame is "enable the
person's technology," and the fabric's identity families grade the person and
credential ACTING on the workplace device. Queued candidates from intake row
33 (per-app managed-config receipt; App Protection / MAM state) land here.
Example action: allow / step-up / restrict / deny at the host-app action.

### `network_connectivity` — the path

Read families: `nac`, `network-nac`, `link-usability`, `sse-egress`,
`carrier`. The doctrine chain built across rows 25/29/30: admitted is not
usable, usable is not protected, and a mandated edge is corroborated, never
believed. Example action: step-up, restrict, route to the network owner.

### `cloud_infrastructure` — the backend

A CONSUMED plane (intake row 32): the fabric grades the device in the
worker's hand, not the operator's cloud estate. Surfaces: the CSPM/CNAPP
positioning row (consumes nothing today, deliberately), the control-plane /
edge-sync deployment models with signed config bundles, and `@workspace/iac`'s
six endpoint-scoped resource kinds (a VNet is deliberately not declarable —
cloud-resource change belongs to the operator's Terraform/ARM pipeline).
Example action: hold an action on caller-posed service-state policy; route to
the infrastructure owner.

### `itsm_workflow` — ownership of the exception

Surfaces: the `itsm` emitter (gated, fixture-backed), `response-accountability`
(the watermelon detector, resolution timing, resolution evidence,
`routeConcern`'s caller-supplied team taxonomy), `@workspace/incident-playbook`
(priority, SLA, escalation, war-room). Example action: create/update a routed
ticket request, require acknowledgement, grade the closure.

### `data_integration` — the signal plane itself

Surfaces: the six outbound emitter families (`itsm`, `siem`, `syslog`,
`telemetry`, `webhooks`, `caep-events`) behind the unanimous four-clause gate;
`@workspace/signal-discovery` (auto-onboarding); Signal Radar (unknown-signal
detector); the MCP server + MCP↔fabric sourcing manifest; the sync manifest and
its drift gates. Fabric law here: a failed read never reports "nothing found",
absence is never health, and delivery is never claimed by a fixture. The
queued normalization-version stamping build (intake row 27) is this layer's
next named work. Example action: fail closed, raise on silence, route to the
integration owner.

### `governance_finops_architecture` — policy, approval, audit

Surfaces: policy versioning + the policy lifecycle, `@workspace/iac`
(declarative desired-state → plan → governed-approve → simulated apply),
`@workspace/dual-control` (two-person integrity), `@workspace/self-audit`,
`@workspace/adaptive-proposals` (a proposal can never activate itself), the
`@workspace/audit` hash chain, the proof/figure-guard evidence method, and the
phase-gate GREEN/YELLOW/RED risk lanes. FinOps itself is NOT modeled — no
cost signal exists in the fabric, and none is invented; if an operator ever
poses spend policy it arrives as caller-supplied data, the same law as every
other floor or bound. Example action: approval gate, recorded exception,
governance review.

### `physical_operational_context` — the real world (the SignalGrid extension)

Read families and packages: `pacs-access`, `rtls-custody`, `custody-beacon`,
badge-binding, SmartDock / dock-state, `location-services`,
`@workspace/facility-trust-graph` (spaces, portals, crossings, clinical bed
context, zone presence, Site Context Gateway), `shift-context`,
`task-exception`, work-context, `ot-posture`, and the handoff/custody
simulations. This is the layer the six-layer poster has no slot for and the
reason the fabric exists: the device is shared, badge-checked-out, and used
in rooms, at docks, on tasks. Example action: hold the task, reroute the
worker, require the wristband scan, verify the correction.

## The catalog-overlay schema

Future revisions of the owner-compiled catalogs (and any machine-readable
catalog export) carry these per-row fields. Defined here as the contract;
existing filed catalogs are NOT retro-edited (they are preserved verbatim by
the intake protocol).

| Field | Meaning |
| --- | --- |
| `operatingStackLayer` | One of the seven enum values above. |
| `systemOfRecord` | The platform that OWNS the state (the fabric never replaces it). |
| `signalType` | What decision-relevant fact the source contributes. |
| `workflowOwner` | Which team owns the workflow the signal gates. |
| `riskOwner` | Who owns the risk the signal surfaces. |
| `approvalOwner` | Who approves exceptions on this surface. |
| `evidenceSource` | Where the audit evidence for the fact lives. |
| `routeDestination` | The `routeConcern`-style owning queue for its incidents. |
| `automationPotential` | Honest grading of what could ever be automated (reviewable-only per the adaptive-proposals doctrine). |
| `signalGridPriority` | P0–P4, sequenced against the launch path. |

Owner-role fields (`workflowOwner`, `riskOwner`, `approvalOwner`,
`routeDestination`) are CALLER-SUPPLIED policy in fabric terms — the same law
as `routeConcern`'s routing table: the taxonomy is the operator's to author,
and a hole surfaces as unrouted rather than silently defaulting.

## Binding boundary

This document organizes; it does not authorize. Nothing here adds a family,
widens a gate, claims a partnership with any tool named in the source poster,
or moves the launch path. When the catalog overlay is populated, it is data —
reviewable, versioned, and owned by the operator — not a build queue.
