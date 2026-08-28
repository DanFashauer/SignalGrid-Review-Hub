# The integration map

**What the grid connects to, and where each connection can actually be built.**

Companion to `docs/PURPOSE.md` (canonical, DR-020). This file is the *how*;
PURPOSE is the *what*. Nothing here overrides the doctrine.

**Standing rule: open source first. Paid solutions are for later, once there
are customers.** Where only a commercial option exists, this file says so and
names the closest open alternative.

---

## The three laws that constrain every row below

1. **Reads before it writes.** The first deployment of any source is read-only.
   Door and badge systems are the most politically guarded in any building; an
   unknown vendor does not get write access first. The owner's own Physical
   Access Control catalog (2026-07-31) states it independently: *"Start
   SignalGrid integration work with read-only event and posture signals, not
   door-unlock writes. Preserve the originating PACS as the system of record."*
2. **The worker never sees it.** No integration may add a step for the person.
3. **Verticals are configuration.** Nothing here may put industry-specific logic
   in the core.

---

## Where work can happen - the lane routing

The grid is physical. Most of it cannot be proven in a container.

| Lane | What belongs here |
| --- | --- |
| **MAC / LOCAL LAN** | Anything touching real hardware, a real network, a real enrolled device, or a real door. OSDP over RS-485, UniFi controller, Home Assistant, BLE/NFC readers, iOS on a device. **This is where the thesis is testable.** |
| **CLOUD** | Deterministic core, policy evaluation, API contract, connector normalization against fixtures. |
| **TENANT** | Anything needing live vendor credentials - owner only. |
| **OWNER** | Partner agreements, program membership, purchasing decisions. |

`pnpm run scan` routes findings by these venues. A MAC or TENANT finding is a
**capability boundary, not a defect.**

---

## The zero-purchase lab

One credential, one door, one device, one room, one ticket - no partner
agreement, no purchase, no NDA. **This is the first build.**

| Layer | Choice | Licence | Lane |
| --- | --- | --- | --- |
| Door + credential | **Seam** (abstraction) or **UniFi Access** | commercial API / local API | MAC-LAN |
| Door protocol (pure OSS) | **libosdp** - Rust bindings suit the dock firmware | Apache-2.0 | MAC-LAN + hardware |
| Device posture | **Fleet** (osquery + NanoMDM) | MIT | CLOUD or LAN |
| macOS posture | the existing **signalgrid-mcp** FastMCP server | - | MAC |
| Identity | **Keycloak** | Apache-2.0 | CLOUD |
| Location | **UniFi** client/AP association - **Traccar** | Apache-2.0 | LAN |
| Room cascade | **Home Assistant** - WebSocket event bus + `call_service` | Apache-2.0 | LAN |
| Event backbone | **NATS** | Apache-2.0 | CLOUD |
| Durable cascade | **Temporal** | MIT | CLOUD |
| Policy evaluation | **Cedar** (preferred - deterministic, formally analyzable) or **OPA** | Apache-2.0 | CLOUD |
| Ticket / escalation | **ntfy** - **Zammad** | Apache-2.0 / AGPL | CLOUD |

**Why Home Assistant is the highest-leverage single adoption:** it collapses
"one room, one environment cascade" into one API this stack already speaks -
a TypeScript WebSocket event bus with `subscribe_events` and `call_service`.
SignalGrid decides; Home Assistant actuates and stays authoritative for the
devices. That is the doctrine's delegation model, already built.

**Seam is already connected** as an MCP tool in the owner's workspace, with
ready-made JS/Python packs for Kisi, SALTO KS, Akiles, 2N, ButterflyMX, TTLock,
igloohome, Schlage, Yale and Nuki. The owner's own catalog rates Seam **P1**:
*"Best abstraction layer for rapidly prototyping multiple access-control
vendors."* Fastest path to a real door event.

---

## Standards to adopt - the thesis already has a home

These are not integrations. They are the **shape** the grid should take.

| Standard | Why it matters |
| --- | --- |
| **OpenID SSF / CAEP** | Continuous identity signals routed to receivers that attenuate access. **This is SignalGrid's thesis as an approved standard** (OpenID Final Specification, 2 Sept 2025). Free open tooling at `caep.dev` and `sharedsignals.guide`. **Build the receiver first**, transmitter later. |
| **CDS Hooks** (HL7, v2.0.1 STU2) | The healthcare equivalent: fires decision support *at a workflow moment*, returns cards. Model the clinical vertical as a CDS Hooks service. Keeps AI in the recommend lane while the deterministic core decides. |
| **OSDP** (IEC 60839-11-5) | Reader-controller. Prefer Secure Channel over Wiegand - Wiegand has no encryption or supervision and must be modelled as **lower-assurance evidence**. |
| **PSIA PLAI** | Physical-logical identity interchange. |
| **SCIM 2.0** | IdP to PACS user lifecycle. |
| **FHIR Subscriptions** | Use the **R4 Backport IG** - R5-native is not what hospitals run. |
| **IHE PCIM / ACM** | PCIM associates clinician-patient-room; ACM is the open alerting profile. **The closest open standard to nurse-call.** |

---

## What NOT to build

A mature project already does each of these well. Building them is surface area
this company cannot maintain.

- **Policy evaluation** -> Cedar or OPA
- **Durable workflow / retry / replay** -> Temporal
- **Apple MDM** -> Fleet / NanoMDM
- **FHIR server** -> Medplum (TypeScript, Apache-2.0) or HAPI
- **Room automation abstraction** -> Home Assistant
- **Multi-vendor lock/door abstraction** -> Seam
- **Event streaming** -> NATS

Keep the deterministic core, the Decision Envelope, the versioning, the
reconstruction, the audit chain, and the cascade logic. **That is the product.**
Everything else is a dependency.

---

## Licence landmines

This is a commercial product. Copyleft has consequences.

| Avoid embedding | Licence |
| --- | --- |
| Zitadel v3+ | AGPL-3.0 (changed 31 Mar 2025) |
| Windmill | AGPL-3.0 |
| n8n | fair-code Sustainable Use - not OSI-open |
| Grafana OnCall | AGPLv3 - **and archived read-only 2026-03-24. Do not adopt.** |
| Redpanda / Benthos | source-available/BSL on some versions - verify |

Safe: Keycloak, OPA, Cedar, Temporal, NATS, Fleet, Nano-suite, libosdp,
Medplum, HAPI, Traccar, Mosquitto, Home Assistant.

---

## Honest gaps

Stated plainly rather than papered over:

- **No production-grade open-source PACS exists.** libosdp gives the wire
  protocol, not a credential database or management plane. Consume a commercial
  PACS read-only (Brivo has free sandboxes; Verkada has unthrottled webhooks).
- **No open nurse-call API.** Vocera/Stryker, Rauland, Ascom, Hillrom expose no
  public REST. The path is HL7 v2 ADT + IHE ACM + middleware, partner-gated.
- **Open UWB indoor RTLS is immature.** BLE/Wi-Fi association is the practical
  lab path.
- **No MCP servers for PACS, RTLS or nurse-call.** Genuine white space.
- **Epic and Oracle production FHIR access is customer-gated.** Sandboxes are
  free and self-serve; production requires a named sponsoring health system.
  Wallet employee badges are a closed program requiring certified readers.

---

## Sources

`docs/PURPOSE.md` (DR-020) - the owner's Drive catalogs, verified 2026-07-31:
Physical Access Control API Catalog (61 vendors, 24 OSS repos, 10 standards,
13 P1) - Endpoint Management API Catalog - Technology Ecosystem Master Catalog
(423 entries) - Communications/Mobile/GitHub, Asset Management, and ControlUp
DEX bundles (2026-08-01/02).

**These catalogs are inputs, not a build queue** - the same rule the Ecosystem
Master Catalog states about itself.
