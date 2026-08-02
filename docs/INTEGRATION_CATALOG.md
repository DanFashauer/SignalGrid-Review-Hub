# Integration Catalog

SignalGrid acts as a runtime decision layer that consumes signals from source systems, evaluates context, emits decisions or workflow requests, and records audit evidence. Source systems remain authoritative for their own domains.

## Integration categories

| Category                                        | Candidate systems                                                                                                                                                                                                                                                                             | What SignalGrid consumes                                                                                                                                  | What SignalGrid emits                                                                                                                 | Source system still owns                                                                                                                 | MVP/public-preprod priority                                                               | Private-core priority                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Identity trust / IAM / IdP                      | Microsoft Entra ID, Okta, Ping Identity, Duo, Auth0, Keycloak, Azure AD B2C / External ID                                                                                                                                                                                                     | User ID, group/role, MFA status, Conditional Access result, risk level, app assignment, session state, guest/external identity type.                      | Runtime trust outcome, review request, audit event, optional step-up/restrict/deny recommendation.                                    | Identity lifecycle, authentication, SSO, MFA, directory policy, identity claims, session controls.                                       | High: Entra ID + Intune first proof.                                                      | High: core dependency for runtime trust decisions.                                                      |
| IGA / identity governance                       | SailPoint / IGA                                                                                                                                                                                                                                                                               | Privileged identity state, access review/certification state, entitlement context, identity governance risk where available.                              | Decision evidence, review/restriction recommendation, recertification or governance follow-up request.                                | Access governance, certification campaigns, entitlement lifecycle, separation-of-duty policy.                                            | Medium later: governance context after identity/posture proof.                            | Medium/high after runtime identity posture model stabilizes.                                            |
| Cloud IAM                                       | AWS IAM, Google Cloud IAM                                                                                                                                                                                                                                                                     | Cloud principal, role, policy, session, federation, and privilege context where authorized.                                                               | Decision evidence, review/restrict recommendation, audit context.                                                                     | Cloud identity policies, roles, permissions, federation, enforcement, and cloud control-plane actions.                                   | Low later: not part of the first proof.                                                   | Medium later after enterprise IAM/UEM proof.                                                            |
| Healthcare access management                    | Imprivata Enterprise Access Management, Mobile Access Management, Mobile Device Access, Medical Devices Access Management, Patient Access, Privileged Access Security                                                                                                                         | Shared-device, clinical access, badge, workstation, privileged-access, and workflow context if a future integration is pursued.                           | Review/audit context, decision recommendations, escalation signals.                                                                   | Healthcare access workflows, product-specific controls, customer deployments, certifications.                                            | Low: future candidate only.                                                               | Medium later if healthcare design partners validate need.                                               |
| UEM/MDM posture                                 | Intune, Jamf, Fleet, Workspace ONE                                                                                                                                                                                                                                                            | Device ID, compliance state, ownership, OS/version, encryption, jailbreak/root, policy state, last check-in.                                              | Normalized posture signal, decision/audit record, remediation recommendation.                                                         | Device enrollment, compliance policy, profile deployment, device actions.                                                                | High: Intune/Entra first; Jamf Apple-depth second.                                        | High: Microsoft first, Jamf next for Apple-heavy environments.                                          |
| Operational Health / DEX                        | ControlUp, Nexthink, Riverbed Aternity, Lakeside SysTrack, TeamViewer DEX, Tanium, Ivanti Neurons, Microsoft Intune / Endpoint Analytics, Microsoft Defender for Endpoint, CrowdStrike, SentinelOne, Datadog, Splunk, Azure Monitor, ServiceNow, Jira Service Management, PagerDuty, Opsgenie | Endpoint health, DEX/user-experience metrics, monitoring alerts, API/service health, ITSM state, incident/alert severity, ownership, and routing context. | Allow, step-up, deny, restrict, alert, ticket, escalate, remediation request, owner route, operator notification, and audit evidence. | DEX, RMM, EDR, SIEM, monitoring, observability, ITSM, and endpoint platforms remain systems of record and execute their native controls. | Medium follow-on: after Entra/Intune, Identity Trust, and Jamf/broader UEM posture paths. | High later: private-core connector work for real health, alerting, API, ITSM, and routing integrations. |
| ITSM                                            | ServiceNow, Jira Service Management                                                                                                                                                                                                                                                           | Incident/change context, ticket status, assignment, maintenance windows.                                                                                  | Ticket creation/update, evidence, approval request, remediation task.                                                                 | Service workflow, change management, ticket lifecycle.                                                                                   | Medium: document after first proof.                                                       | Medium after audit/remediation flow stabilizes.                                                         |
| SIEM/SOAR                                       | Microsoft Sentinel, Splunk                                                                                                                                                                                                                                                                    | Security alerts, risk signals, correlated events, incident context.                                                                                       | Audit events, decision events, enrichment, SOAR handoff.                                                                              | Detection engineering, alert correlation, retention, incident response.                                                                  | Medium: important for audit story, not first connector.                                   | Medium after identity/posture proof.                                                                    |
| NAC/network                                     | Cisco ISE, Aruba/ClearPass                                                                                                                                                                                                                                                                    | Network session, VLAN, device network posture, location hints.                                                                                            | Restrict/deny/review recommendation, audit event, policy context.                                                                     | Network admission, segmentation, enforcement.                                                                                            | Low/medium: future shared-device context.                                                 | Medium later for deeper enforcement paths.                                                              |
| Endpoint telemetry                              | Defender, CrowdStrike, FleetDM                                                                                                                                                                                                                                                                | Device risk, sensor state, vulnerability/exposure, process or endpoint alerts where appropriate.                                                          | Decision/audit event, review request, remediation recommendation.                                                                     | Endpoint detection/response, host telemetry, agent management.                                                                           | Medium: useful signal category after MDM proof.                                           | Medium after posture normalization exists.                                                              |
| Physical/shared-device context                  | Badge, QR/NFC, Kontakt.io / RTLS                                                                                                                                                                                                                                                              | Badge tap, QR/NFC scan, asset/location signal, proximity or shared-device workflow context.                                                               | Session context, review/evidence note, access decision input.                                                                         | Physical access system, RTLS infrastructure, device inventory.                                                                           | Low/medium: important for frontline story, not first proof.                               | Medium if design partners need location/shared-device validation.                                       |
| Dock/edge shared-device events                  | Docks, charging stations, smart cabinets, kiosks, return stations, optional edge gateways                                                                                                                                                                                                     | Dock/undock events, slot state, wrong-slot return, return overdue, charging fault, dock online/offline, location and device identifiers.                  | Runtime decision event, operator/admin alert, ticket/audit event, remediation recommendation.                                         | Dock firmware, hardware state, charging behavior, accessory certification, local safety controls.                                        | Low/medium: start with simulated DockBridge event API after posture proof.                | Medium later if one dock/vendor adapter is validated.                                                   |
| Agentic control surfaces / MCP-style connectors | Cisco Cloud Control-style agentic operations platforms, MCP-style tool surfaces, connector marketplaces                                                                                                                                                                                       | Governed operational signals, scoped tool/action requests, simulation context, approval state, action metadata where a future approved connector exists.  | Decision/audit event, policy evaluation, signed action request, approval requirement, simulation result.                              | Agent workspace, source-system APIs, marketplace governance, execution tooling, vendor platform controls.                                | Low: market-signal documentation only; not a first proof.                                 | Medium later after Intune/Entra, Jamf/Fleet/Workspace ONE, DockBridge, and operator mobile proofs.      |

## First proof: Entra ID + Intune identity/posture

The first concrete proof should validate the combined identity trust and UEM/MDM posture path before broader connector claims. The public-safe plan is documented in [Intune / Entra posture proof](INTUNE_ENTRA_POSTURE_PROOF.md), the identity roadmap is documented in [Identity Trust Layer strategy](IDENTITY_TRUST_LAYER_STRATEGY.md), and Microsoft sequencing is documented in [Microsoft Graph and MCP strategy](MICROSOFT_GRAPH_AND_MCP_STRATEGY.md). It uses a user/device identifier, Microsoft Graph / Entra ID / Intune identity, device-compliance, and enrollment context or deterministic fixture data, a normalized SignalGrid identity/posture model, explicit decision mapping, and an audit record to prove that external identity plus posture can become a runtime trust decision input.

The proof is not a production rollout, compliance guarantee, Microsoft replacement claim, or autonomous remediation path. Microsoft Entra ID remains the source of record for identity and Conditional Access context, while Microsoft Intune remains the source of record for device management and compliance context; SignalGrid consumes the resulting identity and posture signals for runtime trust evaluation.

| Proof element                      | Expected evidence                                                                                                                                                                                                                                                                                                                                                   | Boundary                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Identity/device/compliance lookup  | Sandbox, fake, or deterministic fixture containing user/device ID, group or role, MFA or Conditional Access context where available, compliance state, management state, enrollment source, ownership type, enrollment mode, management channel, device-limit state, ABM/ADE linkage, supervision, last check-in, OS/platform, and assignment context if available. | No customer data, production secrets, or production tenant dependency in the public repo.                             |
| Normalized identity/posture signal | `userId`, `deviceId`, `sourceSystem`, `groupOrRole`, `mfaStatus`, `conditionalAccessResult`, `managedState`, `complianceState`, `postureFreshness`, `riskIndicators`, `observedAt`, `rawReference`, `confidence`, and `decisionImpact`.                                                                                                                             | Normalization does not override or replace the Microsoft source record.                                               |
| Decision mapping                   | Authenticated identity plus compliant and fresh posture maps to an allow candidate; high-risk identity plus stale posture maps to step-up/review; privileged role plus unknown device maps to deny/review; failed access review plus shared-device session maps to deny/restrict.                                                                                   | Identity and posture are decision inputs, not replacements for IAM, IGA, MFA, Conditional Access, or MDM enforcement. |
| Audit record                       | Source system, lookup time, normalized identity/posture context, decision outcome, reason code, and optional operator/admin note.                                                                                                                                                                                                                                   | Audit evidence for the proof only; no compliance guarantee.                                                           |

## Operational Health / DEX layer

The Operational Health / DEX layer is documented in [Operational Health / DEX Layer Strategy](OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md). It consumes endpoint performance, health, monitoring, alerting, digital employee experience, API/service health, and ITSM signals, then correlates those signals with identity, device posture, session context, RTLS/DockBridge context, and workflow state.

Candidate signals include online/offline state, last check-in age, CPU/memory/disk pressure, battery or thermal health, boot/login duration, app or service crashes, network/VPN/Wi-Fi/DNS health, EDR/AV disabled state, missing patches, posture freshness, Teams/UC quality indicators, VDI/DaaS health, health endpoint status, uptime, latency percentiles, error rate, webhook delivery failure, stale sync, and API authentication failure.

SignalGrid may route ITSM tickets, email notifications, mobile operator alerts, Slack/Teams/PagerDuty/Opsgenie notifications, posture refresh requests, MDM sync requests, EDR investigation requests, endpoint isolation requests, owner-team routes, and audit evidence. These remain routed requests or governed actions; public Review Hub docs should not claim autonomous production remediation or replacement of DEX, RMM, EDR, SIEM, monitoring, observability, ITSM, UEM, or endpoint platforms.

## Jamf / Apple-specific posture connector path

Jamf is not just another UEM in the SignalGrid roadmap. It is the follow-on Apple-specific posture and management-depth path after the Microsoft Intune / Entra first proof. This matters for Apple-first frontline and healthcare environments where iOS/iPadOS shared devices, macOS admin workstations, Apple Business Manager / Automated Device Enrollment, Declarative Device Management, Managed Device Attestation, Platform SSO, APNs, configuration profiles, and Self Service workflows shape device trust.

SignalGrid could consume Jamf signals such as:

- Device inventory.
- Compliance and security posture.
- Apple Business Manager / Automated Device Enrollment context.
- Configuration profile status.
- Declarative Device Management state.
- Managed Device Attestation or hardware attestation where available.
- Platform SSO context where available.
- Jamf Self Service and remediation status.
- APNs communication health.
- Apple OS/platform version and update readiness.

Jamf remains responsible for Apple device lifecycle management, app/profile deployment, inventory collection, Apple-specific management frameworks, Self Service workflows, and device security enforcement. SignalGrid would normalize Jamf posture and context into runtime decision inputs, combine that Apple posture with identity, session, location, workflow, and operational signals, determine allow / step-up / deny / review / remediation-routing candidates, record audit evidence, and hand off actions back to Jamf or other systems where appropriate.

The sequence remains conservative: Microsoft Intune / Entra is the first concrete proof; Jamf is a high-value follow-on proof for Apple-heavy shared-device and frontline environments; Fleet / Workspace ONE / broader UEM paths follow after that. Review Hub does not claim a current Jamf partnership, integration, certification, production deployment, or replacement claim.

## macOS endpoint posture — the grid-collected path (built, fixture-backed)

Where an Apple UEM (Jamf, Intune) is present, SignalGrid consumes its posture via that vendor's API — the `api` acquisition path. But many Macs are **not** enrolled, and no cloud API hands you a Mac's live security state faithfully in real time. That is the `grid_collected` path (see [Signal sourcing](SIGNAL_SOURCING.md)): SignalGrid reads the endpoint itself, **read-only**, and does the lifting.

The `macos-posture` connector (`lib/integrations/src/integrations/macos-posture`) implements exactly this. It ingests a read-only posture report from the companion open-source [`signalgrid-mcp`](https://github.com/DanFashauer/signalgrid-mcp) server — SIP, FileVault, Gatekeeper, firewall, MDM enrollment, auto-update settings, and whether XProtect definitions are readable — and normalizes it into one endpoint-hardening posture the fabric fuses (`fromMacosPosture` → a `device_posture` signal on the unified action ladder).

When the report includes the optional system-extension inventory (from the read-only `signalgrid_system_extensions` tool), the connector also folds in a **stranded / conflicting security-agent** signal: a security extension still registered after its app is gone (it blocks reinstall of protection) → `weakened`/restrict; two enabled endpoint-security extensions (a conflict) → `weakened`/restrict; a section provided but unreadable → `unverified`/step-up. An **absent** section is simply not assessed (it never penalizes a device for a signal it didn't claim).

It is fail-safe by construction, mirroring the MCP server's own discipline:

- A hardening control the collector reports **off** → the device is `weakened` and the verdict restricts.
- A control whose state **could not be read** (needs elevation, missing binary, timeout) → `unverified`, which *raises* the assurance bar (step-up). Unknown ≠ off, and unknown ≠ on — an unreadable Mac is **never** fused as compliant.
- A Mac with **no report at all** is a blind spot (`unknown`), never `hardened`.

Proven fully offline by `pnpm run proof:macos-posture` (deterministic, no device access, no network). Live calls are gated exactly like every other connector: fixture mode unless a beta/prod tier sets `SIGNALGRID_LIVE_INTEGRATIONS=true` and a bridge token. SignalGrid changes no macOS setting — every signal is read-only, and this is not a vendor partnership or certification claim.

**The task plane joins the grid.** The task-exception dimension normalizes
frontline task-system exceptions — short pick / empty or wrong-location bin /
inventory discrepancy, failed or bypassed scan verification, an executing worker
or device that differs from the assigned one, RF transaction errors, stalled
flow — into one vendor-neutral posture. The WMS/task system stays the system of
record; SignalGrid consumes, decides, and routes. Vocabulary is grounded in
primary-source-verified surfaces (Oracle WMS Cloud task lifecycle and cycle-count
triggers; SAP EWM exception codes, queryable via its warehouse-task OData
service) with vendor codes carried verbatim in a passthrough audit field, never
in the enum. Integrity-class exceptions (assignment mismatch, bypassed
procedure) restrict and route to security operations; inventory-class alert and
route to operations — the worker is never punished for the warehouse's inventory
problem. Proven offline by `pnpm run proof:task-exception` (195 checks): 1,728
normalized states + 127,400 raw wire reports enumerated, exactly 5 granting
shapes, each individually asserted coherent; four self-contradiction relations
(including the `not_applicable` mirror caught in a sibling dimension's review,
designed in from birth here) each backed by a fixture that fails if the relation
is deleted; registered with the mutation guard from its first commit. Read-only,
fixture-backed, gated like every connector; no partnership or certification is
claimed.

**Aligned to Apple's canonical schema.** Each normalized posture field carries its provenance in [`apple/device-management`](https://github.com/apple/device-management) (Apple's MIT-licensed, machine-readable MDM + Declarative Device Management schema, pinned at version 26.4): `sip` → `SystemIntegrityProtectionEnabled`, `fileVault` → `FDE_Enabled` (+ DDM `diskmanagement.filevault.enabled`), `firewall` → `FirewallSettings.FirewallEnabled`, and so on — plus the Managed Device Attestation leaf-cert OIDs (e.g. the attested SIP status `1.2.840.113635.100.8.13.1`) reserved for a future hardware-rooted attestation tier. On-device-only signals with no MDM/DDM key (Gatekeeper, XProtect, system extensions) are declared as such rather than given a fabricated key. `pnpm run proof:macos-apple-schema` (53 checks, offline) asserts every posture field is mapped, every referenced key is in the pinned Apple catalog, and — since two subsystems pin this same upstream — that `macos-posture` and `ddm-connector` name the SAME release, an invariant `ddm-connector` stated in a comment but nothing enforced. So a schema change on a new OS release surfaces as a failing check instead of silent drift, and so does reconciling only one of the two alignments. Aligning to these names is adoption of a public standard, not a code dependency or vendor partnership.

## OT / IIoT edge-device posture — the factory floor (built, fixture-backed)

The manufacturing floor is the purest case for the `grid_collected` path. A PLC, RTU, HMI, or brownfield machine cannot run an agent, exposes no vendor API, and speaks Modbus / OPC-UA / DNP3 — so SignalGrid reads what an **edge gateway** can observe about the device (read-only) and turns it into one posture the fabric fuses. Where even the gateway can't see it, that is a gap, never a green.

The `ot-posture` connector (`lib/integrations/src/integrations/ot-posture`) normalizes an edge-gateway report — firmware currency, patchability (brownfield/EOL), network segmentation (a device on a **flat** network reachable from IT is a Purdue-model violation), unauthenticated-protocol exposure, and gateway liveness — into an OT device-trust verdict (`fromOtPosture` → an `ot_posture` signal on the unified action ladder).

Fail-safe by construction, matched to the plant-floor stakes:

- a **flat network**, an **unauthenticated OT protocol reachable beyond the cell**, or an **end-of-life / unpatchable** device that can never be secured → `restrict` (the risk is structural — contain it);
- a **stale gateway** (we're blind to the device) or any **unreadable** control → `step_up` (never trust silence);
- an unrecognized value normalizes to the safe `unknown`; a device **no gateway sees** is a blind spot, never `secure`.

Proven fully offline by `pnpm run proof:ot-posture` (37 checks, no plant access, no network). Live calls are gated exactly like every other connector: fixture mode unless a beta/prod tier sets `SIGNALGRID_LIVE_INTEGRATIONS=true` and a bridge token. SignalGrid changes no device setting — every signal is read-only, and this is not a vendor partnership or certification claim.

## Factory-floor workflows — automating the plant (built, fixture-backed)

The OT posture connector answers *how trustworthy is this industrial device?*; the factory workflow pack (`lib/flows/src/factory.ts`) is what the Grid **does** about it — the same allow / step-up / restrict / deny discipline applied to plant-floor actions, owner- and accountability-governed:

- **PLC firmware update** — staging is automated; the actual push is **dual-approval**; an emergency rollback is a safety-netted downtime override (last-known-good image + auto-revert + line-stop interlock) so a bad flash never bricks the line.
- **Production line command** — reading status is automated; issuing a command needs **admin approval**; an e-stop override is safety-netted.
- **OT exposure containment** — monitor is automated; restrict is admin-approved; **segment/quarantine is dual-approval** (it can stop a line).

Proven by `pnpm run proof:factory-flows` (16 checks, fully offline): the pack validates as governance-complete config, covers its factory situations at health, and **fails safe** — an ungettable OT signal propagates to a coverage gap (never a false green), surfaced as `required_signal_unavailable`. The riskiest plant actions can never auto-run.

## IAM / access-governance — the runtime authorization dimension (built, fixture-backed)

Identity and Access Management is five pillars — identity lifecycle, authentication, authorization, governance, and privileged access. SignalGrid already covers the authentication pillar (the `identity-risk` connector normalizes IdP sign-in risk and MFA state) and touches physical custody (`rtls-custody`, badge-binding) and endpoint secrets (`credential-exposure`). The `access-governance` connector (`lib/integrations/src/integrations/access-governance`) closes the loop for a **shared, badge-checked-out session** by answering the one runtime question none of those do: *is THIS principal actually allowed to do THIS, and is that grant still governed?*

It normalizes an IGA/PAM bridge's already-evaluated state for the identity bound to the session — account-lifecycle standing (active vs a **Leaver**/disabled/orphaned account still transacting), entitlement scope (least-privilege vs over-broad vs out-of-scope), access-certification freshness and **segregation-of-duties**, and privileged-access state (**standing vs just-in-time**, plus whether an elevated session is monitored) — into one authorization/governance verdict (`fromAccessGovernance` → an `access_governance` signal on the unified action ladder). It consumes the evaluated governance state; it does **not** re-pull raw directory group membership (the `graph`/`uem` connectors own that read).

Fail-safe by construction, matched to a shared frontline session's stakes:

- a **Leaver** or **disabled** account still transacting → `escalate` (that identity should no longer be able to act at all);
- an **orphaned** account, an **out-of-scope** or **decertified** entitlement, a **segregation-of-duties conflict**, an **expired JIT window** still in use, or an **unmonitored privileged session** → `restrict` (the grant is ungoverned — contain it);
- an **over-privileged** (not least-privilege) role, a **stale / never-attested** certification, or **standing** (not JIT) privilege → `step_up` (governance drift);
- a governance state **relayed from a sync older than the caller's posed age bound** → `step_up` (intake ledger row 42: the IGA plane is cadence-based, so a bridge whose upstream HR/SCIM sync silently broke keeps truthfully relaying its last evaluation — affirmative values, aged; the answer may be right, but it is old. The row-26 caller-posed shape: source-reported `observedAt` + `maxGovernanceReadAgeSeconds` + `referenceTime`, no clock in any decision path, unposed forecloses nothing — and worst-concern-wins keeps stale **bad** news outranking: a `leaver_pending` relayed stale still escalates);
- an unrecognized value normalizes to the safe `unknown`, and any unreadable governance signal steps up; a principal **no IGA source observes** is a blind spot (`unknown`), never `authorized`.

Proven fully offline by `pnpm run proof:access-governance` (75 checks, no directory access, no network — incl. the 18,000-combination brute-force of the widened input space, the 54,000-combination re-enumeration with the recency axis posed (a grant additionally requires a fresh governance read), and the intake-row-27 lifecycle axis: `lifecycleStage` gives the J and M the leaver slice never carried; a recent transfer with over-privileged or recert-due entitlements is `mover_stale_entitlement` → alert with its own queue-readable reason, a new hire already holding standing privilege is `joiner_over_provisioned` → alert, a clean transition is a visible monitor — never a grant, never a nag — and an unreported stage forecloses nothing, so pre-axis bridges keep their behavior). Live calls are gated exactly like every other connector: fixture mode unless a beta/prod tier sets `SIGNALGRID_LIVE_INTEGRATIONS=true` and a bridge token. SignalGrid changes no entitlement — every signal is read-only, and this is not a vendor partnership or certification claim.

## Hardware-rooted device attestation — the assurance dimension (built, fixture-backed)

Every other posture signal SignalGrid fuses is, at bottom, **self-reported**: an MDM agent, a grid probe, or an EDR sensor tells us the device is healthy, and we trust the reporter. A tampered device can lie to its own agent. Managed Device Attestation closes that gap — the attested facts (SIP, Secure Boot, kext policy, OS version, serial) are signed by the **Secure Enclave** and delivered in an X.509 chain that validates to Apple's Enterprise Attestation Root. The `device-attestation` connector (`lib/integrations/src/integrations/device-attestation`) consumes an attestation-bridge record whose DER chain has already been verified to that root (the leaf OIDs `1.2.840.113635.100.8.*` are the same ones pinned in `macos-posture`/`ddm-connector`'s Apple schema) and folds it into one **assurance** verdict (`fromAttestation` → an `attestation` signal on the unified action ladder).

The assurance model is the whole point — a cryptographic proof outranks any self-report, in both directions:

- a **fresh, root-verified** attestation proving a healthy state (SIP on, Secure Boot full, no third-party kexts) is the **only** path that *grants* the top tier → `attested_hardened`/`none` — you cannot argue with the Secure Enclave;
- every verdict backed by a fresh, root-verified chain is marked `hardwareRooted` — including the proven-bad ones below (the chain is genuine regardless of whether the news is good); `hardwareRooted` means "a real hardware attestation stands behind this verdict," **not** "attested-healthy," so it is never a substitute for the action;
- a **proven** bad state is the strongest negative SignalGrid can raise: attested **SIP disabled** → `escalate` (`attested_compromised`), attested **permissive** Secure Boot → `restrict` (`attested_reduced`);
- a **reduced** Secure Boot level or an attested **third-party kext** allowance → `step_up` (governance drift, cryptographically confirmed);
- an **expected-but-unverifiable** chain (stripped, replayed, or failed to validate) or a **stale** attestation → `step_up` — a missing proof is a tamper signal, never a grant;
- hardware **provably not attestation-capable** (Intel Macs, no Secure Enclave) → `not_attestable`/`none` — it **abstains**: attestation is an assurance *upgrade*, not a universal requirement, and the baseline posture is gated by the other dimensions. The abstain is granted **only** to a *self-consistent* report (declares incapable **and** carries no chain or attested facts); a report that claims `attestable:false` yet still presents a verified chain is malformed/tampered — it never abstains, it fails closed (a conflicting chain proving SIP off still `escalate`s; a conflicting "clean" chain is floored at `step_up`, never the top tier);
- an unrecognized value normalizes to the safe `unknown`, a non-boolean flag becomes `null` (never a fabricated `true`), and a device no attestation source covers is a blind spot (`unknown`/`step_up`), never attested-secure.

Proven fully offline by `pnpm run proof:device-attestation` (60 checks, no network, no keys). Live calls are gated exactly like every other connector: fixture mode unless a beta/prod tier sets `SIGNALGRID_LIVE_INTEGRATIONS=true` and a bridge token. The trust boundary is deliberate: an upstream read-only bridge performs the X.509 chain verification to Apple's Enterprise Attestation Root and decodes the leaf OIDs; **SignalGrid consumes that already-verified record** — it normalizes and decides on it, and does not itself perform the crypto, issue certificates, or mint attestations. Every signal is read-only, and this is not an Apple partnership or certification claim.

## SSO session-binding — the shared-device identity dimension (built, fixture-backed)

Single Sign-On has become the enterprise identity control layer, but SSO's failure mode on a **shared, badge-checked-out frontline device** is different from the desk-bound case none of SignalGrid's other identity dimensions catch. `identity-risk` scores the *sign-in* (Entra ID Protection / Okta ThreatInsight risk); `access-governance` answers *is this principal authorized*. Neither asks the shared-device question: **is the live SSO session sitting on THIS tablet actually the current badge-holder's, is it MFA-backed, and is it still fresh?** The single worst frontline failure is a **leftover session** — the previous shift's nurse walked away and their Okta/Entra session is still live on the cart, so the next person silently inherits someone else's authenticated identity.

The `sso-session` connector (`lib/integrations/src/integrations/sso-session`) normalizes an IdP session-state bridge's already-evaluated view of the session bound to the current device session — its state (active / expired / none), its **binding** (is the session subject the checked-out badge-holder, a *different* principal, or attributable to nobody), its authenticator **assurance** (phishing-resistant / MFA / single-factor), its **freshness**, and — intake ledger row 24 — its **account scope with credential-level attribution**: on a SHARED account (a nurse-station or line-terminal principal) the subject IS the account by design, so the subject comparison can never identify a person; attribution moves to the registered holder of the CREDENTIAL that authenticated (the DigitalPersona v4.4.0-class multiple-device-bound-passkeys pattern). A shared session attributed by the holder's own credential is a first-class bound session; one opened with someone else's credential is a mismatch (escalate); a live shared session with NO credential attribution is its own visible state — `unattributed_shared` → step_up ("the account authenticated" is not "this person is identified"; re-auth as yourself, never a lockout, because the shared pattern is legitimate and its anonymity is the defect) — into one session-binding verdict (`fromSsoSession` → an `sso_session` signal on the unified action ladder). It consumes the evaluated session state; it never mints, refreshes, or revokes a token (that stays with the IdP).

Fail-safe by construction, matched to a shared frontline session's stakes:

- a **leftover session** whose subject ≠ the current badge-holder is the strongest negative: a **live** one → `escalate` (someone else's authenticated identity is on the device); an expired-but-cached one → `restrict` (still contain the leftover);
- an **active session bound to no known holder** → `restrict` (contain it);
- a session **bound** to the current holder but backed only by a **single factor**, **near or past its expiry**, or with an **unreadable** assurance/freshness → `step_up` (re-authenticate to a stronger, fresher session);
- **no active session** is the baseline (`no_session` / `none`) — authentication is gated by the workflow, not penalized here;
- only a **bound, MFA-backed, fresh** session with **positively-confirmed IdP reachability** (`idpReachable === true`) grants the top tier (`bound_strong` / `none`, marked `subjectBound`); the IdP being **unreachable**, reachability **unreported** (`null`), or the binding **unknown** never grants — it steps up; an unrecognized value normalizes to the safe `unknown`, never a fabricated `bound`/`active`.

It also fails closed on self-contradictory or unverifiable reports: a `bound` label is trusted only with **corroborating subject evidence** — both subjects readable and equal; two readable subjects that **differ** normalize to `mismatched`, and a `bound` label with a missing/unreadable subject (a lookup failure or error string) is downgraded to `unknown` so an evidence-free "bound" can never grant. The locally-determinable concerns (a subject mismatch, an active unbound session) are evaluated **before** the IdP-outage downgrade, so an IdP being unreachable can never soften a leftover from `escalate` to `step_up`; and a **near-expiry** bound session raises the bar rather than passing as a calm monitor.

Proven fully offline by `pnpm run proof:sso-session` (88 checks, no network, no keys — incl. the 4,608-combination brute-force of the widened input space: an unattributed shared session falls out of the allow path in every cell). Live calls are gated exactly like every other connector: fixture mode unless a beta/prod tier sets `SIGNALGRID_LIVE_INTEGRATIONS=true` and a bridge token. SignalGrid reads and decides on the evaluated session state — it changes no session and mints no tokens; every signal is read-only, and this is not an Okta / Microsoft / Ping partnership or certification claim.

## OAuth-consent / workload identity — the delegated-access dimension (built, fixture-backed)

The IAM landscape's "allow an app to access another app" problem (OAuth 2.0) is distinct from every other identity dimension SignalGrid fuses: `identity-risk` scores the sign-in, `sso-session` checks the live session, `access-governance` answers what the **human** is entitled to. None of them ask what **third-party apps and workload identities can do ON BEHALF OF** that human via a delegated OAuth grant. On a shared, badge-checked-out device the session inherits the badge-holder's identity — so a live **illicit consent grant** (the classic consent-phishing attack, where a user is tricked into granting a malicious app broad access), an **over-scoped** third-party app, an **unverified-publisher** app, or a **service principal with a long-lived unmanaged secret** is a session-relevant risk that would otherwise be invisible.

The `oauth-consent` connector (`lib/integrations/src/integrations/oauth-consent`) normalizes an OAuth/consent-governance bridge's already-evaluated view of the **riskiest delegated grant** on the session's principal (Microsoft Entra enterprise apps / OAuth grants, Okta OAuth, Google Workspace app access) — grant presence, consent type (**admin-consented** vs the **user-consented** phishing vector), publisher verification, scope breadth, and workload-credential hygiene — into one governance verdict (`fromOAuthConsent` → an `oauth_consent` signal on the unified action ladder). It consumes the evaluated grant state; it **revokes nothing** (that stays with the IdP).

Fail-safe by construction, matched to a shared frontline session's stakes:

- the **illicit consent** signature (a **user**-consented, **unverified**-publisher app with **broad/full** scope) is the strongest negative → `escalate`;
- a **full-access** grant that is not admin-governed → `restrict` (contain the broad delegated access); an admin-consented full-access grant, a merely **broad** scope, an **unverified** publisher, or an **unmanaged workload secret** → `step_up`;
- the **only** paths that contribute a grant are a positively-confirmed clean state — a **known** consent type (admin- or user-consented) + verified publisher + least scope + managed/no workload, **or** no grants at all — **and only with the IdP confirmed reachable** (`idpReachable === true`); an **unknown** consent type (like any other unknown field) never grants, and the IdP unreachable or **unreported**, or an unknown grant state, all step up;
- an unrecognized value normalizes to the safe `unknown`, never a fabricated `present`/`verified`/`admin`.

Proven fully offline by `pnpm run proof:oauth-consent` (65 checks, no network, no keys). Live calls are gated exactly like every other connector. SignalGrid reads and decides on the evaluated grant state — it revokes no grant and changes no consent; every signal is read-only, and this is not a Microsoft / Okta / Google partnership or certification claim.

## Token binding / proof-of-possession — the replayable-token dimension (built, fixture-backed)

`sso-session` asks whether the live session is the current badge-holder's, MFA-backed, and fresh. This dimension asks an RFC-level question about that same session's **access token**: is it **sender-constrained** — cryptographically bound to a key held on THIS device (**DPoP**, RFC 9449; or **mutual-TLS**, RFC 8705) — or a plain **bearer** token that anyone who copies it can replay from anywhere? On a shared, badge-checked-out device a bearer access token left in shared storage is replayable by the next user or by a token thief off the device; a proof-of-possession token bound to a hardware key in the Secure Enclave / TPM cannot be presented from another machine. The single worst signature this catches is a bound token whose PoP key belongs to a **different** device — a token minted elsewhere and presented here (an exfiltrated/stolen bound token).

The `token-binding` connector (`lib/integrations/src/integrations/token-binding`) normalizes a token-inspection bridge's already-evaluated view of the session's token — its binding mechanism (DPoP / mTLS / bearer), where the proof-of-possession key lives (attested **hardware** vs exportable **software** vs none), whether the token is **audience-restricted**, and whether the key/cert is bound to **this** device — into one token-binding verdict (`fromTokenBinding` → a `token_binding` signal on the unified action ladder). It consumes the evaluated binding state; it never mints, refreshes, binds, or revokes a token (that stays with the IdP / resource server).

Fail-safe by construction, matched to a shared frontline session's stakes:

- a bound token whose PoP key belongs to **another device** (a stolen bound token) is the strongest negative → `escalate`;
- an **unbound bearer** token (or one with no PoP key) is replayable → `restrict` (contain — require a sender-constrained token / re-auth);
- a sender-constrained token that is **weakened** — an exportable **software** key, an **unattested** "hardware" key, or a token that is **not audience-restricted** — or whose binding we cannot read, or whose bridge was unreachable → `step_up`;
- the **only** path that contributes a grant is a positively-confirmed sender-constrained token — DPoP or mTLS, an **attested hardware** key, audience-restricted, bound to **this** device, with the bridge **reachable** — every other state, and every unknown/unreported field, raises the bar;
- an unrecognized value normalizes to the safe `unknown`, and a self-contradictory `bearer`-token-with-a-`hardware`-key report is forced to `keyProtection: none` (fail closed) so it can never read as a protected key.

Proven fully offline by `pnpm run proof:token-binding` (52 checks, no network, no keys) — including a brute-force enumeration of the **entire 1,296-combination** normalized input space asserting action `none` is emitted for *exactly* the positively-confirmed sender-constrained tokens (0 mismatches), via the shared grant-safety harness. Live calls are gated exactly like every other connector. SignalGrid reads and decides on the evaluated binding state — it mints and binds no tokens; every signal is read-only, and this is not a partnership or certification claim.

## Physical access-control (PACS) — the badge/door dimension (built, fixture-backed)

SignalGrid's identity dimensions reason about the *logical* session (`sso-session`, `oauth-consent`, `token-binding`) and `rtls-custody` reasons about where the *device* physically is. Neither asks the question a badge reader at the door answers: **did the person now holding this shared device legitimately badge into this controlled area, are they authorized to be here right now, and is the door itself secure?** On a shared, badge-checked-out frontline device this ties the physical world to the grid — a person actively **denied** or whose credential is **revoked** at the door, a **tailgating** (anti-passback) breach, a **forced** door, or a badge-holder who does not match the checked-out device holder are all physical signals the logical layer cannot see.

The `pacs-access` connector (`lib/integrations/src/integrations/pacs-access`) normalizes a physical access-control system's already-evaluated view of the controlled entry the device sits behind — the access-log result (**granted/denied**), the credential type (biometric / card / mobile / pin), the **credential technology** the reader actually verified (cryptographic — PKOC/Aliro/DESFire-class challenge–response — vs. a replayable **static identifier** read: 125 kHz prox, CSN-only, magstripe), the holder's **authorization** against the access rules + time zones (authorized / out-of-schedule / out-of-zone / revoked), the **anti-passback** state, the physical **door state** (secured / forced / held-open), and whether the PACS holder matches the checked-out device holder — into one physical-access verdict (`fromPacsAccess` → a `pacs_access` signal on the unified action ladder). The signal shape is vendor-neutral and fits the read-only surfaces of Control iD / ZKTeco-class biometric door & turnstile controllers, HID Wiegand/OSDP readers, and ZKBio / Verkada-class cloud access control. It consumes access-log + rule + alarm state; it **opens no door, unlocks no turnstile, and revokes no credential** (those stay with the PACS).

Fail-safe by construction, matched to a shared frontline session's stakes:

- a **denied** entry, a **revoked** credential, or a PACS holder who does **not** match the checked-out device holder is the strongest negative → `escalate`;
- an anti-passback (**tailgating**) violation, or a **forced** door, is a physical breach → `restrict` (contain);
- an entry **out of schedule / out of zone**, or a door **held open**, → `step_up`; anything unreadable, or the bridge unreachable, → `step_up` (never trust silence);
- the **only** path that contributes a grant is a positively-confirmed clean entry — **granted**, **authorized**, anti-passback **ok**, at a **secure** door, with the PACS identity **matching** the checked-out holder, on a **known** credential, with the bridge **reachable** — every other state, and every unknown/unreported field, raises the bar;
- a self-contradictory report (a `granted` label whose two subjects differ) is forced to `identityMatched: false` (fail closed) so it can never grant;
- the **recency axis** (intake row 26): the caller may pose a per-workflow event-age bound and reference instant — an entry older than the bound is `stale_evidence` → step_up (a confirmed badge-in is not evidence of a CURRENT entry forever), a posed-but-unanswerable bound (no readable event time or reference, a future-dated event, a garbled pose) raises as unknown, and an unposed bound forecloses nothing;
- **reader/controller health** (intake row 26), distinct from bridge reachability: an explicit `offline` controller behind an entry steps up (the evidence plane may be blind) and `degraded` is a visible monitor — affirmative-only, so an unreported health never forecloses and pre-axis bridges keep their behavior;
- the **mixed-estate axis** (intake row 21): a "granted" backed by a clonable static-identifier read and one backed by a cryptographic credential are different facts, and the caller may POSE a per-workflow technology floor — a read below it → `step_up` `CREDENTIAL_BELOW_FLOOR` (a stronger challenge, deliberately **never** restrict/deny: modernization is evolutionary, and the legacy estate is graded, not condemned); a posed floor the PACS could not answer → `step_up` (silence is not a cryptographic credential); an UNPOSED floor is `unassessed` and forecloses nothing, so a deployment adopts the axis at its own pace.

Proven fully offline by `pnpm run proof:pacs-access` (92 checks, no network, no door control) — including a brute-force enumeration of the **entire 97,200-combination** normalized input space, graded twice: unposed (the technology axis forecloses nothing) and under a posed cryptographic floor (the allow path additionally demands a cryptographic read — exactly one third of the unposed grants — with 0 mismatches both ways), via the shared grant-safety harness. Live calls are gated exactly like every other connector. SignalGrid reads and decides on the evaluated access state — it changes no door and revokes no credential; every signal is read-only, and this is not a vendor partnership or certification claim.

## Agentic / non-human identity — the "who is actually acting" dimension (built, fixture-backed)

Every other identity dimension in the fabric assumes a **person** is acting: `sso-session` asks whose session is live, `pacs-access` asks who badged in, `access-governance` asks what that human is entitled to. None of them ask the question that matters once AI agents and service accounts begin acting on a shared frontline device: **is this action being taken by a human at all — and if it is being taken by a non-human identity, is that identity governed?**

The `agent-identity` connector (`lib/integrations/src/integrations/agent-identity`) normalizes an agent-governance bridge's already-evaluated view of the actor behind an action — its **type** (human / AI agent / service account), its presence in the **agent/NHI registry**, the **lifetime** of the credential backing the action (short-lived / long-lived / standing), its **scope** (least-privilege / over-scoped / unscoped), the **human-in-the-loop approval** state, and whether the actor's activity is being **recorded** — into one governance verdict (`fromAgentIdentity` → an `agent_identity` signal on the unified action ladder). It registers no agent, mints no token, and revokes no access.

This is distinct from `oauth-consent`, which asks about the *credential hygiene* of a workload ("is its secret managed?"). This dimension asks about an identity **taking an action in a live session right now**.

Fail-safe by construction, treating a non-human identity like a privileged access request:

- an **unregistered** non-human identity (a shadow agent absent from the inventory), an **expired** approval (approval lapsed but access persisted — the non-human equivalent of a leaver still holding a key), or a **standing** never-expiring credential is the strongest negative → `escalate`;
- an **over-scoped** or entirely **unscoped** agent, one acting **unrecorded** (no audit trail), or one **never approved** → `restrict` (contain);
- a **long-lived** credential or a **pending** approval → `step_up`; anything unreadable, or the bridge unreachable, → `step_up`;
- exactly **one** state contributes a grant: a non-human identity confirmed **fully governed** — registered + short-lived + least-privilege + approved + recorded — with the bridge confirmed reachable. A positively-confirmed **human** actor contributes `monitor`, not `none`;
- a **human** actor is still not judged on the agent-governance fields that cannot apply to a person — registry membership, agent approval, agent recording — but that no longer buys a grant. Privilege/scope **is** deferred — `access-governance` models entitlement scope and standing elevation. **Credential lifetime is not deferred**, and is judged here for every actor including a human: `token-binding` models proof-of-possession (binding, key protection, attestation, audience restriction) and carries no TTL field at all, so nothing else in the fabric can express "this credential never expires". Only an *asserted* lifetime concern counts — silence still defers.

Because that fast-path once *granted* without reading those fields, its safety rested entirely on whether the `"human"` claim could be trusted — which is why it no longer grants at all (see below). The normalizer voids the claim in exactly two situations, and deliberately **not** in a third:

- **the report is malformed** — any known field present but unparseable, or any key the connector does not recognize. This is the case a guard written against the *normalized* values cannot see: the allowlist has already folded `"lapsed"`, `["standing"]` and `"ERR: upstream timeout"` into `unknown`, and the boolean parser has folded `"true"` and `1` into `null`, so an assertion we failed to read is otherwise indistinguishable from silence. Presence, not parsed value, is what makes something an assertion;
- **the report asserts governance state no person can hold** — membership in the agent/NHI registry, or an agent-approval workflow governing this actor;
- but **not** the truthful human answers. `agentRegistered: false`, `approvalState: "none"`, an unrecorded session, and a broadly-scoped human privilege are all accurate things to say about a person, and a bridge that emits one uniform row shape per actor will populate those columns for people. Punishing an honest bridge for answering accurately would make the dimension unusable in practice.

An actor whose label was voided or unreadable is reported as `actorClassification: "unclassified"` — never as a confirmed machine. A consumer reading the connector verdict directly should route NHI triage on `actorClassification !== "human"` rather than `nonHumanActor`, which is the strictly-positive "confirmed non-human" and is `false` on every agent-shaped posture whose label we could not read. Note that the fused `ComposableSignal` carries only `{kind, posture, action, reason}` — downstream of `fromAgentIdentity` the agent-shaped postures themselves are the routing key, and `actorClassification` is not currently propagated.

**Why the human branch does not grant.** This dimension trusts the bridge's actor classification, and a bridge that simply lies — reporting a clean, well-formed `"human"` for an AI agent — cannot be caught by cross-checking the other fields. That was survivable while the lie had to be consistent *and* well-formed; it was not survivable as the basis of a **grant**. Six consecutive adversarial reviews each found a different route into the label-only grant — a self-contradictory report, a value we could not parse, a key in a spelling we ignore, a key on the prototype. Each fix closed a route and the next review found another, because the door itself was the problem.

A confirmed human is now reported `human_actor` / `monitor`. That composes to the same healthy `ok` tier, so a clinician on a ward device is not impeded; what changes is that this dimension no longer *asserts* a clean bill of health it never verified. Confirming that a person is a person is the job of the dimensions that check evidence — `sso-session` (whose session is live), `pacs-access` (who badged in), `access-governance` (what they are entitled to). This one reports what it actually knows.

The residual limit is now narrow and honest: a bridge that lies about the actor label still avoids the agent-governance judgements, so a mislabelled agent is monitored rather than escalated. It is no longer *granted*, which is the property that matters. Trustworthy actor attribution still has to come from the bridge — this dimension now says so rather than papering over it.

Proven fully offline by `pnpm run proof:agent-identity` (143 checks, no network), 0 mismatches on all three enumerations:

- **normalized space (17,280 states)** — every value the normalizer can emit, against the evaluator alone. Action `none` is emitted for *exactly* the fully-governed non-human identity — two states, one per non-human actor type — and never on an actor label alone or a report flagged malformed, which the evaluator refuses independently so the allow path does not *depend* on the claim having been voided;
- **raw wire space (870,912 reports)** — the same fields carrying the values a real bridge emits: junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects, absent keys, and a snake_case aliased extra key. This is the pass that exercises the parse layer; its clean predicate is written as a positive allowlist of raw wire values (the contract a bridge must satisfy) rather than as the negation of the guard;
- **parse fidelity (same raw space)** — asserts `reportIntegrity` itself against an independent allowlist. This third pass exists because the first two only ever observe *grant-ness*, and most malformed values already normalize to a denying sentinel — so an individual integrity condition could be deleted with both passes still reporting zero mismatches. Mutation testing found exactly that, and each previously-invisible condition is now caught.

Live calls are gated exactly like every other connector. SignalGrid reads and decides on the evaluated governance state — it grants no agent access and revokes none; every signal is read-only, and this is not a vendor partnership or certification claim.

## Device-management health / config drift — the "is management still real" dimension (built, fixture-backed)

The fabric already asks whether a device is **hardened** (`macos-posture`: is FileVault on, is the firewall up) and whether it was **compliant** at some evaluation (`intune-entra-posture`). Neither asks the management-plane question that decides whether either answer is still worth anything: **is this shared device still under EFFECTIVE management, and is it actually on the baseline it was assigned?**

A ward iPad that stopped checking in three weeks ago reports its last-known compliance state forever. A device whose enrollment silently failed, or that was retired in the MDM but never physically collected, looks fine in a posture snapshot and is in fact ungoverned. Config drift is the same failure one step earlier: the baseline was assigned, the device is enrolled and checking in, but the profiles on it no longer match what was intended. **This dimension is what gives the other device signals an expiry.**

The `device-management-health` connector (`lib/integrations/src/integrations/device-management-health`) normalizes a management-plane bridge's already-evaluated view — check-in freshness on **both delivery channels** (see below), **remediation health**, **policy drift** (on-baseline / drifted), **compliance coverage** (is any policy even in scope, since "compliant" is vacuous otherwise), **enrollment state** (enrolled / failed / retired), and whether the management plane was **reachable** — into one verdict (`fromDeviceManagementHealth` → a `device_management_health` signal on the unified action ladder). It enrolls no device, assigns no policy, pushes no profile, and wipes nothing.

Fail-safe by construction:

- a **retired** or **failed** enrollment, or a device **no compliance policy covers**, means the management plane is not actually governing it → `restrict` (contain), each with a critical finding;
- a **detected, unremediated defect** → `alert` — a confirmed fact about the device rather than a gap in what we know, so it outranks every `step_up` below;
- **config drift**, a device that has **never** checked in or whose check-in has gone **stale** on *either* channel, a remediation script that could not run, or a self-contradictory channel report → `step_up`;
- anything unreadable, the plane unreachable, or a report we could not parse → `step_up`;
- the grant requires **all seven** positively confirmed — fresh on the MDM channel, fresh (or confirmed absent) on the agent channel, remediation-healthy (or confirmed unassigned), on baseline, covered by a policy, enrolled, and the plane confirmed reachable. Worst-concern-wins.

### The two delivery channels

"Did the device check in?" reads as one question in every MDM console and is two independent facts underneath it. Triggering a sync on an Intune-managed device starts two paths that succeed and fail separately:

| Channel | Carries | Reported by |
| --- | --- | --- |
| **MDM** | Configuration profiles, compliance policies, the settings catalog. OMA-DM on Windows, the Apple MDM protocol on Apple platforms. | `lastSyncDateTime` — the number a console shows |
| **Agent** | Windows, via the Intune Management Extension: Win32 app delivery, PowerShell scripts, and Remediations. macOS, via the Intune agent: shell scripts, custom attributes, and DMG/PKG installs — **not** Remediations, which Microsoft documents as Windows-only. | nothing a console surfaces prominently |

On `lastSyncDateTime`, Microsoft Graph documents only "the date and time that the device last completed a successful sync with Intune" and names no channel. The MDM-scoped reading is operationally right — the IME documentation states that a console Sync initiates an MDM check-in but does not force an IME check-in, and that the IME check-in is independent — but it is an inference from behaviour, not a documented guarantee, and is recorded here as one. The IME's own cadence is a documented check-in roughly every 8 hours plus push wake-ups.

A device can be perfectly fresh on the MDM channel while its agent has not run for weeks: profiles and compliance evaluation stay current, and every app install, script and remediation queued in that window silently does not happen. A single `checkInFreshness` field reported "fresh" for exactly that device — the console's number standing in for a fact it does not cover, which is the same cached-answer failure this dimension exists to catch, one layer further in. The fields are therefore split (`mdmCheckInFreshness`, `agentCheckInFreshness`) and the grant confirms both.

`agentCheckInFreshness` carries a fifth value, `not_applicable`, and it is load-bearing rather than a convenience: **iOS/iPadOS has no Intune Management Extension**, so on a ward iPad every *device-management* workload rides the MDM channel already judged. (App Protection Policies are a genuinely separate non-MDM channel on iOS, which is why that qualifier is there rather than an unqualified "every".) Without it the exact fleet this product targets could never be confirmed healthy. It must be **asserted** — an omitted field normalizes to `unknown` and denies, so a bridge cannot grant by silence. `remediationHealth` carries the same value for the same reason, plus the benign and common "no remediation is assigned to this device" (unlike compliance coverage, Remediations are an opt-in add-on, so their absence is not itself a finding).

Because `not_applicable` is a positive claim, it can also be a **false** one, and the pair is cross-checked. A report asserting the agent channel does not exist — *or has never once run* — while also reporting a remediation state only a run of that channel could produce is self-contradictory, and self-contradictory input never grants (`CHANNEL_REPORT_INCONSISTENT`). Silence is not contradiction: "no agent channel" plus an unreported remediation state is an honest description of a platform with neither, and reads as an ordinary unknown.

The decisive part is what the evaluator does *next*: on a contradictory report it does not judge the disbelieved half **at all**. The first draft raised the contradiction and then went on to grade the remediation fields anyway, which was wrong twice over. `issues_detected` alerts, and `alert` outranks the contradiction's `step_up`, so the contradiction was never the headline — the shipped claim that "the operator's next action is to fix the bridge mapping, not the device" was false on every such report. Worse, the verdict then carried `remediation_issues_detected` in `criticalFindings`, a field documented as *confirmed known-bad facts*, sourced from exactly the half of the report it had just declared unbelievable. An adversarial review measured it, **before this fix**, at 21,168 reports asserting a critical finding while simultaneously flagging `channel_consistency` — a count that is now zero and is quoted here as the size of the defect, not as a live figure. A dimension does not get to disbelieve a claim and cite it in the same breath. The proof now audits the entire raw space for that pattern: across all **127,008** self-contradictory reports, not one cites the disbelieved claim.

The normalizer still does not resolve the contradiction by rewriting either value — it reports both and the evaluator raises it, so the operator can see which side of the bridge mapping to fix. Exactly **three** channel shapes grant: live agent + remediations healthy, live agent + no remediation assigned, and no agent channel at all. That count is pinned in the proof, so a fourth route into the grant is a test failure rather than a silent widening.

The old single `checkInFreshness` key is now **unrecognized**. A bridge still emitting it is marked malformed and denied rather than half-read as an MDM-only check-in — failing loudly is the only way its author finds out which channel they meant.

Two rules carry the discipline. **Report integrity** is tracked separately from field values: a field present but unparseable, or an unrecognized key, is an *assertion we could not read*, which the allowlist would otherwise fold into the same `unknown` sentinel as silence. The evaluator refuses to grant on a malformed report independently of the normalizer. And every field is read **own-property-only** — an inherited value is the prototype's claim, not this report's, so a report with zero own keys asserts nothing and cannot grant. The unrecognized-key *scan*, by contrast, deliberately walks the whole prototype chain (bounded, so a Proxy returning a fresh prototype each call cannot hang it), and beyond the report's own level it flags **any** key — including one we recognize. A correctly-spelled inherited `agentRegistered` is a stronger assertion than a misspelled one, not a weaker one, and since values are read own-only it would otherwise be asserted by the report and read by nobody. Collapsing the two once reopened exactly that hole. A hostile Proxy can still hide a key from its `ownKeys` trap while continuing to answer `getOwnPropertyDescriptor`, and be believed — a Proxy can always lie about its own shape. That limit is now *asserted* in the proof rather than only described here, so the disclosure cannot drift away from the behaviour; what the checks buy is that hiding *values* costs it the grant, and that an honest-but-sloppy adapter fails closed. Two narrower holes found by the same review are closed: a report that **is** `Object.prototype` was never scanned at all, because the walk's stop condition `o !== Object.prototype` was evaluated before the first iteration and conflated "the chain terminus" with "the report", so a polluted prototype normalized to clean and granted; and the seven field reads were unguarded, so an own **accessor that throws** escaped as a bare `Error` rather than the typed connector error every other unreadable shape produces.

An earlier draft also carried a *consistency guard* with two clauses: it demoted `on_baseline`/`covered` to `unknown` when the device had never checked in, and demoted `covered` when enrollment had failed or been retired. Both were removed. Measured over the full raw space the removal changes the recommended action on **zero** reports and grant-ness on **zero** (a never-checked-in or unenrolled device already denies on its own); it changes the reason code on **zero** reports and would shrink `unknownSignals` on 114,432 — a counterfactual about a guard that no longer exists, re-derived from the current raw space rather than carried over — a real reduction in reported uncertainty, though nothing downstream reads that field, since `fromDeviceManagementHealth` fuses only `{kind, posture, action, reason}`. (Those last two figures read *eight* and *1,788* until an adversarial review re-derived them: they were the pre-split measurements, quoted against a raw space that the channel split had made 64× larger. The reason-code count is now zero because the candidate reorder makes `MDM_CHECKIN_NEVER` win the tie regardless. Numbers stated as measurements have to be re-measured when the thing they measure changes, and these were not.) What the guard cost was decisive: by rewriting `policyDrift` it made `MDM_CHECKIN_NEVER` unreachable at the wire layer entirely, so the dimension's motivating case could not be named by its own verdict. A guard that buys no safety and costs the operator the reason is not worth having.

The reorder that replaced it has its own smaller version of that trade, and the channel split widened it: on **6,759** of the 1,354,752 raw reports a device whose drift normalizes to `drifted` reports the generic `MANAGEMENT_STATE_UNKNOWN` rather than `POLICY_DRIFTED`, because something judged earlier — a channel freshness, a remediation state — was itself unreadable. Grant-ness is unaffected on every one of them; what is lost is the specificity of the reason. That is stated here rather than left for a reader to find.

The same review found a larger and undisclosed instance of it, since fixed. `MANAGEMENT_UNREACHABLE` was raised **last**, so an *asserted* "the management plane did not answer for this device" lost the `step_up` tie to any generic `MANAGEMENT_STATE_UNKNOWN` from a single unreadable field: it headlined **9** of the raw reports while **225,792** of them carried an explicit `managementReachable: false`. An asserted negative losing to an unknown is the inverse of what worst-concern-wins is for, so the explicit `false` is now judged near the top as the known-bad fact it is, and headlines **18,246**. It does not headline all 225,792, and should not: a retired enrollment still outranks it on severity, and an unreadable envelope or a self-contradictory report is a better diagnosis than "the plane was quiet". The unreported (`null`) case stays where it was — a field the bridge never mentioned is a gap like any other.

Proven fully offline by `pnpm run proof:device-management-health` (162 checks, no network), 0 mismatches on all three enumerations via the shared grant-safety harness: the **normalized space (21,600 states)** against the evaluator alone, the **raw wire space (1,354,752 reports)** carrying the values a real bridge emits — junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects, absent keys, and a snake_case aliased extra key — and a **parse-fidelity pass** over that same space asserting `reportIntegrity` against an independent allowlist. Exactly three raw reports grant — one per consistent channel shape — so the seven-way confirmation is provably tight. The third pass is what makes the integrity conditions provable at all: grant-ness alone cannot see them, since every malformed value already normalizes to a denying sentinel. The whole set is mutation-tested rather than assumed: **11** deliberate weakenings of the normalizer and evaluator were each applied and reverted, and every one is now caught. Two of them — deleting either of two terms in the consistency guard — previously left the proof green, which is precisely the load-bearing-but-unproven state the third pass exists to prevent, so each term now has a fixture of its own. Live calls are gated exactly like every other connector: fixture mode unless tier is beta/prod **and** `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** `DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN` is set. SignalGrid reads and decides on the evaluated management state; every signal is read-only, and this is not a vendor partnership or certification claim.

## Link usability — "associated" is not "usable" (built, fixture-backed)

The fabric already asks whether a device was **admitted** to the network. `network-nac` models 802.1X authentication state, the segment/VLAN it landed on, NAC policy compliance, and which switch port or access point it attached to. That answers the question at the **point of connection**. It does not ask the question that decides whether the answer is worth anything a second later: **is the link this device is sitting on actually carrying traffic?**

The failure is a documented one on shared frontline fleets. A handheld or cart moves between access points, the association survives, and nothing gets through. The client shows connected. The console shows connected. The transactions time out. On a warehouse floor it reads as "spotty Wi-Fi in an area with good coverage"; underneath it is usually a **sticky client** holding a weak AP past its roam threshold, or a roam that completed at the radio layer while DHCP or DNS did not.

**Why this belongs in a trust fabric and not a monitoring product.** Every other dimension grants on freshness — `device-management-health` requires `managementReachable === true`, `agent-identity` requires `bridgeReachable === true`. A bridge that answers over a link like this returns a **stale read wearing a fresh timestamp**. It is the same defect as reading one check-in number for two delivery channels, one layer further down: a console number standing in for a fact it does not cover. This dimension is what gives the *other* dimensions' reachability claims an expiry.

The `link-usability` connector (`lib/integrations/src/integrations/link-usability`) normalizes a wireless controller's or cloud dashboard's already-evaluated view — **association state**, the **connection ladder** the device's recent attempts actually reached, **roam capability**, observed **roam behaviour**, a bridge-supplied **latency band**, and whether the controller was **reachable** — into one verdict (`fromLinkUsability` → a `link_usability` signal on the unified action ladder). It joins no network, steers no client, changes no radio setting, and deauthenticates nobody.

It deliberately does **not** re-model what `network-nac` owns. Authentication and segmentation stay there; overlapping them would produce two verdicts on one fact. This one starts after admission.

The primitive that makes it possible is that wireless dashboards report the ladder as **separate rungs** rather than one boolean — a Meraki-class API exposes distinct association, authentication, DHCP and DNS counters across its wireless connection-stats endpoints. That separation is exactly what distinguishes "connected" from "working", because a client can clear association and then fail at DHCP or DNS. (Which *specific* endpoint carries the five-field failure schema is a detail worth getting right, and an earlier draft of [API_SIGNAL_DISCOVERY](API_SIGNAL_DISCOVERY.md) did not — see the correction recorded there.)

Fail-safe by construction:

- a link that is **associated** while the bridge affirmatively reports nothing got through, or that is failing at **DHCP** or **DNS** → `alert`, each with a critical finding. These are confirmed facts about the link, not gaps in what we know;
- **not associated**, a **sticky** or **flapping** client, **degraded** latency, a controller that did not answer, a self-contradictory report, or anything unreadable → `step_up`;
- the grant requires **all six** positively confirmed — associated, carrying traffic, roam behaviour stable (or confirmed absent), roam capability reported, latency nominal, and the controller confirmed reachable. Worst-concern-wins.

**The severity inversion is the point.** `associated_only` outranks `not_associated`, which looks backwards until you ask what each does to the rest of the fabric. A device that is plainly offline is *honest*: it is visible, and every other dimension's freshness claim is obviously suspect. A device that reports connected while carrying nothing is the dangerous one, because it keeps manufacturing fresh-looking confirmations for everything downstream. Grading the quiet failure above the loud one is the whole reason this dimension exists.

Two judgement calls are worth stating because they are easy to get wrong in the other direction. **Roam capability is not graded as a defect** — `basic` roaming without 802.11r Fast BSS Transition is not broken, and a dimension that penalised every fleet lacking it would be reporting an architecture preference as a risk. It must still be *reported*, because a field we could not read means we did not fully understand the report, and it must *cohere* with the observed behaviour (below). And **latency is carried as a band, never as a number or a threshold**: what counts as degraded is a property of the site and the workload, so the bridge that knows the site does the banding. A millisecond threshold invented here would be a fabricated fact dressed as a measurement.

The hardened-normalizer pattern is carried in from `device-management-health` and `agent-identity` rather than rediscovered — own-property-only reads wrapped against throwing accessors, a bounded prototype-chain key scan that flags **any** inherited key, `null` as absence in both the enum and boolean paths, `Object.prototype` excluded as a report body, and `reportIntegrity` tracked apart from field values and independently denied on. So is the lesson about self-contradictory reports: a device reported not associated cannot have reached a rung above association, and one reported associated cannot be at the `not_associated` rung. Both directions raise `LINK_REPORT_INCONSISTENT`, and — the part that was paid for in review elsewhere — the **disbelieved half is then not judged at all**, because a dimension does not get to disbelieve a claim and cite it in the same breath.

A second contradiction lives in the same six fields and was missed in the first draft. `roamCapability: not_applicable` asserts there is no roaming domain; `roamHealth` reports observed roaming *behaviour*. A report claiming both is self-contradictory exactly as association-versus-progress is — and adversarial review found that **three of the six shapes that granted were incoherent in precisely this way**. It mattered beyond taxonomy: `roamCapability` is deliberately not graded, so `not_applicable` was a free pass through the only check that field has, and it is exactly the value a bridge hardcodes for "we do not model this" — semantically the nearest thing to `unknown` on the wire, while being the one spelling that granted. That inverted this dimension's own rule that silence denies. Both directions now raise `LINK_REPORT_INCONSISTENT`, and as with the ladder, the disbelieved claim is not judged at all.

The same review found the mirror-image defect in ordering. An **asserted** `not_associated` with the progress ladder silent — an ordinary shape when a controller has no client entry — reported the generic `LINK_STATE_UNKNOWN`, because the association branch sat *after* the ladder's `unknown` block and lost the tie by being second. Measured: its guard was satisfied 360 times across the normalized space and its candidate won **zero** times. A confirmed fact suppressed by a gap, which is the same inversion `MANAGEMENT_UNREACHABLE` suffered in `device-management-health` and which this dimension had already fixed for `controllerReachable === false` forty lines earlier. The principle had been applied to one asserted negative and not the other; it now applies to both.

Proven fully offline by `pnpm run proof:link-usability` (154 checks, no network), 0 mismatches on all three enumerations via the shared grant-safety harness: the **normalized space (6,480 states)**, the **raw wire space (217,728 reports)** carrying the values a real bridge emits, and a **parse-fidelity pass** over that same space asserting `reportIntegrity` against an independent allowlist. Exactly **three** shapes grant — one per coherent roam pair — and that count is pinned **over the enumerated wire space**, so a fourth route within it is a test failure rather than a silent widening. That qualifier is load-bearing and was missing: the proof itself demonstrates a route outside the enumeration, since a Proxy that lies in `ownKeys` while still answering `getOwnPropertyDescriptor` keeps its values readable and grants. The proof also audits the whole raw space for the cite-a-disbelieved-claim pattern on both contradiction relations: across **20,160** ladder-contradictory and **19,440** roam-contradictory reports, not one cites the disbelieved half. `linkUsable` is separately asserted to agree with `action === "none"` on every one of the 6,480 normalized states — a mutation widening it survived until that check existed. Live calls are gated exactly like every other connector: fixture mode unless tier is beta/prod **and** `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** `LINK_USABILITY_ACCESS_TOKEN` is set. SignalGrid reads and decides on the evaluated link state; every signal is read-only, and this is not a vendor partnership or certification claim.

## Entra PIM activation — the one surface where SignalGrid *decides* (built, offline-proven)

Every other dimension in this catalog is read-only and outbound: SignalGrid consumes a vendor's evaluated state and composes a verdict something else may act on. This one is inbound, and the difference is the commercial point.

Microsoft Entra Privileged Identity Management supports a **custom extension** on role activation: when an engineer activates an eligible role, PIM calls a REST API you own and **enforces the answer**. Three outcomes are defined — `Denied`, `Approved` (route to the approver group), `AutoApproved` (activate immediately, time-bound). That is a documented control point where SignalGrid is not observing a decision but making one Microsoft obeys. (Preview, via Microsoft Graph beta, covering Entra roles, Azure roles and PIM for Groups — verify the current contract against Microsoft's published documentation before wiring a live tenant.)

`lib/pim-activation` implements the decision. The ladder is **not** the usual severity ladder, and that is deliberate:

- **Denied** is reserved for affirmative, known-bad facts: no valid change ticket, a device the grid has put at the `blocked` tier, or an actor not confirmed to be a person. Denying costs an on-call engineer their elevation mid-incident, so it is never done on a guess — the proof asserts `Denied` is unreachable without a blocking finding;
- **Approved** — a human is asked — is the default, and where every unknown lands. A signal we could not read must neither block a responder nor wave them through;
- **AutoApproved** is the grant, and carries the same discipline the connectors apply to `none`: **all seven** inputs positively confirmed — valid ticket, emergency change, requester verified on the on-call roster, device at `ok`, actor confirmed human, signals confirmed fresh, request parsed clean.

**What this adds over a ticket check** is the middle three inputs, and it reduces to one case: a verified on-call engineer holding a genuine P1 ticket, on a shared device the grid has BLOCKED for badge-custody or baseline reasons, is refused. ServiceNow cannot see that; Conditional Access decides whether a *session* reaches a *resource*, not whether a privileged *role* may be activated right now against physical custody. See [COMPETITIVE_ENTRA](COMPETITIVE_ENTRA.md) — this narrows the honest gap rather than widening the claim.

Proven fully offline by `pnpm run proof:pim-activation` (43 checks, no network), 0 mismatches on all three enumerations: the **normalized space (3,240 states)**, the **raw wire space (100,800 requests)** carrying junk enums, JSON nulls, string-quoted booleans, numbers, arrays, objects, absent keys and an aliased extra key, and a **parse-fidelity pass**. Exactly one state and one raw request auto-approve. Because the caller is external and untrusted, the request normalizer reuses the hardened pattern the connectors arrived at over six adversarial reviews — own-property-only reads, a bounded prototype-chain scan for unrecognized keys, and separately-tracked request integrity. **The tier is not taken on trust.** `deviceRiskTierFromPosture` bridges the fused grid verdict into the activation input, and the proof drives it from real connector verdicts rather than a hand-written field: a retired enrollment and an unregistered agent each fuse to `blocked` and refuse the elevation; a governed agent on a healthy device fuses to `ok` and auto-approves, so the happy path is demonstrably reachable end to end; and worst-concern-wins survives the bridge, so one blocked dimension among healthy ones still refuses.

One case in that bridge is worth calling out because it is a trap. `composeDeviceRisk([])` reports `riskTier: "ok"` with `signalCount: 0`, and it is *right* to — nothing is known to be wrong. But "nothing is known to be wrong" is not "confirmed healthy", and an automatic privileged elevation must rest on the second. A device not yet onboarded, every connector unreachable, or a misrouted device id would otherwise be indistinguishable from one that reported clean across the board. An empty posture therefore maps to `unknown`, and routes to the approver group.

SignalGrid activates no role, mints no token, and writes nothing back to Entra.

## Frontline context signal roadmap

Future healthcare and frontline context signals are documented in [Frontline context signals roadmap](FRONTLINE_CONTEXT_SIGNALS.md). These include Intune enrollment restrictions, device limits, iOS/iPadOS enrollment type, Apple Business Manager / ADE state, supervision, Jamf Pro context, Kontakt.io / RTLS candidate signals, location, staff safety alerts, nurse call events, dock/return-station events, and badge / QR / NFC physical context. They are not first-proof requirements; they become follow-on or future roadmap inputs after the Microsoft posture proof and UEM posture model are grounded.

## Kontakt.io / RTLS candidate integration path

Kontakt.io should be treated as a future RTLS, location, staff-safety, and asset-movement candidate path after the Microsoft posture proof is stable. It fits the physical/shared-device context category because hospital workflows often need room, zone, asset, badge, wearable, patient-flow, staff-safety, location-freshness, and equipment-movement context before deciding whether a shared-device action should proceed.

SignalGrid could consume asset/device location, room or zone presence, staff duress alerts, patient/device movement context where approved, location freshness, dock/return-station context, and workflow event context. SignalGrid could emit runtime decision records, operator mobile alerts, ITSM ticket requests, SIEM/security events, audit evidence bundles, and review/remediation routes. Kontakt.io or another RTLS source remains responsible for RTLS hardware, tags/wearables, the location engine, patient/asset/staff-location telemetry, RTLS infrastructure and calibration, and native platform workflows.

The first proof should be deterministic and fixture-only: no Kontakt.io API calls, no customer data, no live hospital infrastructure, and no partnership claim. Suggested future fixtures include a staff duress alert, wrong-zone shared device, missing shared device, stale location signal, and asset/patient/device proximity event. See [Kontakt.io / RTLS integration notes](KONTAKT_RTLS_INTEGRATION_NOTES.md).

## Agentic operations and MCP-style connector direction

Agentic operations platforms and MCP-style connector patterns are a market signal for SignalGrid, not a current production claim. The relevant pattern is that specialized systems expose governed data and bounded actions through APIs or tool surfaces, while policy, approval, and audit remain in the control path. SignalGrid can apply that pattern narrowly to shared-device and mobile frontline access decisions.

A future connector model may include read-only signal connectors, signed action request connectors, simulation before execution, human approval gates, rollback metadata, and policy-bound permissions. Jamf, Fleet, Workspace ONE, and broader UEM/MDM platforms should be treated as future connector candidates for posture, inventory, management state, compliance freshness, and remediation/action request handoff. Review Hub does not claim current Jamf integration, Cisco Cloud Control integration, MCP implementation, vendor partnership, customer deployment, or autonomous production remediation. See [Agentic connector strategy](AGENTIC_CONNECTOR_STRATEGY.md).

## Imprivata candidate path

Imprivata is documented as a future candidate healthcare access-management integration and partner path only. Review Hub does not claim a current Imprivata partnership, certification, alliance, or validated integration. Before any public claim changes, SignalGrid would need an approved product one-pager, working demo, validated integration proof, concise customer benefit statement, and careful review for production/compliance overclaims.

## The 2026 dimensions — recovery, currency, credential worth, binding, two-person integrity (built, fixture-backed)

Five dimensions added after the sections above, each read-only, fixture-gated, fused into
posture-composition, registered with the mutation guard, and proven offline. Full write-ups
live in their own docs; this catalog entry exists so the list of built dimensions is complete
in one place.

- **Custody beacon** ([CUSTODY_BEACON.md](CUSTODY_BEACON.md)) — asset recovery for the moment
  every *online* custody signal goes dark **with** the device. An independent case-embedded
  beacon fused with reachability separates "powered off in its bay" (`monitor`) from
  "removed and dark" (`escalate`) — a call native Lost Mode cannot make on a shared fleet,
  since it needs the device powered and online. A stale sighting confirms nothing: an
  expired in-zone reading on a dark device is graded as location-unknown, not as benign.
  `proof:custody-beacon` (43 checks).

- **App-update currency** ([APP_UPDATE_CURRENCY.md](APP_UPDATE_CURRENCY.md)) — the honest
  half of "custom OTA updates". An iOS app cannot install or replace itself; distribution
  stays with itms-services / MDM InstallApplication / ABM. What *is* posture: `min_version`
  floors, `force_update`, and install-channel provenance. `proof:app-update` (57 checks).

- **Platform SSO** ([PLATFORM_SSO.md](PLATFORM_SSO.md)) — "passwordless" and "satisfies MFA"
  are not automatic; the **method** decides the credential's worth. Only a user-registered
  Secure Enclave key or smart card is phishing-resistant. A login policy claimed on a method
  that cannot enforce it is config drift, and a policy genuinely in force is graded for
  lockout exposure. `proof:platform-sso` (52 checks).

- **Passkey assurance** ([PASSKEY_ASSURANCE.md](PASSKEY_ASSURANCE.md)) — "a passkey is a
  passkey" is the misconception, and the line falls at **attestation**, not at
  synced-vs-device-bound: an unattested device-bound passkey carries no more device
  provenance than a synced one. A synced credential's custody is unknowable by
  construction — no administrator can query where it synced — so it forecloses the grant
  rather than lowering it. User verification discouraged is possession-only, a known-false
  reliance that restricts. `proof:passkey-assurance` (74 checks).

- **Outbound emitters under discipline** — the six delivery families (`itsm`, `siem`, `syslog`,
  `telemetry`, `webhooks`, `caep-events`) each carry the same unanimous live-call gate as every
  read connector: dev/alpha never emit; beta/prod need `SIGNALGRID_LIVE_INTEGRATIONS=true`, a
  per-family credential, and an INJECTED transport this repository does not ship. The fixture
  emitter records what WOULD have been sent with a literal `delivered: false` on every entry —
  after the syslog family was found returning `status:'sent'` for events it silently dropped,
  the surface is shaped so that claim is unrepresentable. Routing (`response-accountability`)
  stays a verdict; emission stays an act behind this gate. `proof:emitter-discipline` (51 checks).

- **CAEP / Shared Signals session-signal emitter** — the sixth family, and the outbound half of
  continuous access evaluation (intake ledger row 17, built on the owner's keep-going): telling
  COOPERATING applications that a session's context changed — presence expired, posture dropped,
  a credential changed, assurance moved. The formatter builds an **UNSIGNED SET claims set**
  (RFC 8417 shape, the five OpenID CAEP event types as an allowlist, event URIs never guessed);
  signing is a JWT operation needing keys this public repository must not hold, so producing a
  transmissible SET is the injected transport's job in a private deployment — and the proof pins
  that no string in the output is even JWT-shaped. The subject is an `opaque` PSEUDONYM with the
  same raw-identifier tripwire as the gateway projector (an email-shaped subject refuses);
  `iat`/`event_timestamp` come from SUPPLIED instants and `jti` from an upstream decision id —
  no clock, no randomness. The fabric's reason codes travel as `reason_admin`, so the auditable
  why crosses with the event. `proof:caep-events` (17 checks).

- **Benchmark selection** ([BENCHMARK_SELECTION.md](BENCHMARK_SELECTION.md)) — a baseline answer is
  meaningless without the question that produced it. `BaselineState` records `aligned` and nothing
  about which benchmark, at what version, from whose content, covering how much. Graded against a
  committed snapshot of the published CIS catalog: 454 entries, 447 distinct titles, 7 superseded
  rows. Title is the identity — the catalog files one Windows Server STIG version under a different
  family from its successor, so a family-keyed index reports the stale row as current. A third-party
  implementation of CIS-aligned checks is never represented as official CIS content, and a tool that
  merely labels its checks "CIS" establishes nothing, and a run older than the operator's stated
  age bound cannot confirm anything today (all three temporal inputs supplied, never sampled).
  Titles and versions only — CIS rule content is licensed and is not reproduced.
  `proof:benchmark-selection` (82 checks).

- **Shift context** ([SHIFT_CONTEXT.md](SHIFT_CONTEXT.md)) — right person, wrong time is still the
  wrong decision context. The labor plane (UKG, Dayforce, ADP and peers) already records whether a
  worker is scheduled now, on the clock, and where the shift places them; nothing consumed it.
  Scheduled-but-clocked-out is off-the-clock work or someone else's badge (step_up); operating while
  neither scheduled nor punched in steps up rather than restricts (an emergency call-in is
  legitimate, and a challenge resolves it); an unscheduled clock-in is visible, never blocked. The
  schedule standing is DERIVED from the reported window at a caller-supplied reference instant — no
  clock in any decision path — and the site question is graded only when the caller poses it.
  Reading a schedule is not managing one: GET-only, no punch writes, nothing payroll-adjacent.
  `proof:shift-context` (50 checks).

- **Bootstrap credential** — the auth plane's provenance reading (intake ledger row 17's queued
  candidate; Entra Temporary Access Pass and its peers are the reference shape). A temporary
  bootstrap pass may reach ONLY authenticator enrollment or recovery: a bootstrap session on an
  operational workflow restricts (a step-up would let the suspect credential answer for itself);
  expired-but-in-use restricts; a pass minted broad or issued on location evidence ALONE alerts —
  issuance defects are operator-scale; reusable or unbounded-lifetime passes step up, visibly
  weaker than the mechanism promises. Lifetime is DERIVED from the reported issued/expires
  instants at a caller-supplied reference instant — no clock in any decision path — and the
  workflow class is POSED by the caller: silence never widens enrollment-only. The clean state is
  a STANDING strong credential and only that; a perfectly-used bootstrap pass still reads
  monitor, because a temporary credential is an elevated state, not a clean one. Reading a
  credential record is not managing one: no pass is issued, revoked, or extended.
  `proof:bootstrap-credential` (35 checks).

- **Challenge capability** — the answerable step-up (intake ledger row 23; HID DigitalPersona's
  AD/LDS + Web Client inventory and Entra's authentication-methods registry are the reference
  shapes). The fabric's remedy doctrine chooses step_up over lockouts everywhere, and every one
  of those verdicts silently assumed the challenge could be ANSWERED — a step-up posed to a
  device with no enrolled method, no reader, or a dead local agent is a deny wearing a step_up
  label. A bridge reports, per method (fingerprint / face / card-tap / PIN / OTP / security-key
  allowlist): credential ENROLLED for the worker, AUTHENTICATOR present on the device, local
  CLIENT healthy. The caller POSES which methods its workflow's step-up would accept; unposed is
  `unassessed` and forecloses nothing. READY demands one accepted method positively affirmed on
  all three axes; UNANSWERABLE demands EVERY accepted method positively broken (declaring the
  remedy path dead is itself an affirmative claim — silence never makes it) and alerts at
  operator scale: fix enrollment or swap the device BEFORE the doomed challenge; anything less
  determinate is a visible blind spot. Reading a capability inventory is not running a
  challenge: nothing is enrolled, installed, or executed — ceremony execution stays with the
  HOST app. `proof:challenge-capability` (38 checks, incl. the exhaustive 81-cell single-method
  standing sweep: answerable in exactly the all-affirmed cell).

- **SSE egress** — the mandated edge path (intake ledger row 25; Zscaler Client Connector
  device status, Netskope client inventory, and GlobalProtect are the reference shapes).
  `network-nac` stops at LAN admission and `edr-threat` grades the endpoint agent; neither
  asks whether the device's internet/SaaS traffic is actually traversing the deployment's
  mandated SWG/CASB/ZTNA edge — a frontline device with the SSE client bypassed, disabled,
  or never installed browses raw while every console reads "protected". The SSE reports its
  own client's state (trusted allowlist) plus whether the edge AFFIRMATIVELY observes this
  device's traffic — a "tunneled" claim is corroborated, never believed: contradicted →
  step_up with a critical finding, unconfirmed → unknown raises. The caller POSES whether
  the edge is mandated for this device; unposed is `unassessed` and forecloses nothing (an
  air-gapped terminal or out-of-mandate BYOD device is never nagged). Disabled and
  never-installed are affirmative operator-scale defects (alert — the setup-bypassed
  precedent); a bypass is visible and steps up (a bypass rule can be deliberate policy);
  silence on a mandated path steps up. Reading an edge's device status is not steering
  traffic: nothing is routed, toggled, or rewritten. `proof:sse-egress` (32 checks, incl.
  the exhaustive 45-cell standing sweep in both poses: protected in exactly one cell,
  unposed always quiet).

- **Policy binding** ([POLICY_BINDING.md](POLICY_BINDING.md)) — membership **is** the policy.
  Intune dynamic groups, Fleet teams, ABM/DDM profiles, Jamf smart groups, PACS access
  levels, Entra CA groups, WMS queues, EDR policy groups and SignalGrid's own per-vertical
  bundles are one mechanism under many names, and a wrong binding applies the wrong policies
  silently. A second axis grades whether the bound policy ACTS: Conditional Access in
  report-only, a compliance policy whose only noncompliance action is "notify", and ASR in
  audit mode all leave a perfectly-bound device ungated, so `bound_correctly` requires
  `enforcing` and an absent enforcement answer raises rather than granting.
  `proof:policy-binding` (46 checks).

- **Dual control** ([DUAL_CONTROL.md](DUAL_CONTROL.md)) — two-person integrity for the
  highest-blast-radius actions: two distinct identities, distinct credential instances, user
  verification, action binding, role, co-presence, clean parse. `proof:dual-control`
  (58 checks).

## DockBridge candidate integration

SignalGrid DockBridge is a future dock/edge integration strategy for shared-device physical events. The first proof should be software-only: a simulated `POST /api/dock/events` contract and demo flow that turns dock state into SignalGrid runtime decisions and audit records (the implemented path is now `POST /api/v1/connectors/{id}/sync`). Real dock hardware, MFi work, or vendor-specific adapters should come later only if the simulated workflow validates customer value.

DockBridge should reduce workstation-centered orchestration where possible, but it should not be claimed as a replacement for Apple Configurator, MDM/UEM, Imprivata GroundControl, or platform-managed device operations.

## Endpoint-management, NAC, entitlement and provisioning proofs

These four proofs cover the families brought under connector discipline most
recently. Their documented counts are enforced by `pnpm run check:proof-counts`,
which runs each proof and fails the build when a number here disagrees with what the
proof reports — the numbers below are therefore evidence, not claims.

- **`proof:uem` (50 checks)** — the read-only MDM/UEM dimension across Intune, Jamf
  and Workspace ONE. Includes a **1,440-state exhaustive sweep** whose grant path is
  pinned to *exactly 9* fully-confirmed states, four isolated live-call-gate refusals,
  and a source scan asserting no vendor-API call. `personal` ownership on an
  unsupervised device grades `monitor`, not a grant: vendors report personal ownership
  as a residual bucket rather than a positive confirmation.
- **`proof:nac` (32 checks)** — Cisco ISE and Aruba ClearPass endpoint identity,
  read-only. Hostile-identifier cases are asserted against the **filter builder**, not
  merely the validator, and fixture lookups are scoped to the identifier kind so a
  certificate query cannot be answered by a MAC match. The normalizers now take **no
  identifier at all**: `normalizeIseEndpoint` once received the caller's query and wrote
  it into the returned record's identity fields — reporting "ISE says this endpoint's
  MAC is X" when ISE had said no such thing. That was fixed by review and then covered
  by *nothing*: reverting the fix left this proof passing at the identical count. The
  dead parameters are removed so the echo is unrepresentable rather than merely absent,
  and the reads-from-the-response property is now asserted for both vendors.
- **`proof:entitlement-binding` (57 checks)** — whether a grant is *reviewable*, not
  merely correct. Includes a **1,200-state sweep** with the clean path pinned to
  *exactly 18*, plus coherence checks that reject a report contradicting itself.
- **`proof:device-resolver` (14 checks)** — the injection boundary. `deviceResolver`
  typed its NAC adapter map as `any`, so the read-only `NACAdapter` interface was not
  enforced at the one call site that consumes it. TypeScript alone cannot close this:
  structural typing means an object carrying `lookupEndpoint` **and**
  `quarantineEndpoint` satisfies the interface, and excess-property checking never
  applies to a value arriving through a variable. So an adapter exposing any
  device-action method is now REFUSED at runtime, at injection, through both the
  constructor and `addNACAdapter` — a check only one of two entry points performs is a
  check with a door beside it. Source faults are reported rather than swallowed: a
  bare `catch { return null }` made an unreachable UEM indistinguishable from "no such
  device".
- **`proof:config-scope` (48 checks)** — tenant scoping for the connector
  *configuration* stores. Both `uem/store.ts` and `nac/store.ts` keyed their entry on a
  flat constant (`"uem:config"`, `"nac:config"`) in a repository where every other
  persisted reader is keyed on `(id, tenant_id)`. **Severity, stated honestly: nothing
  called them.** No tenant's connector selection was ever readable by another, because
  no code path ever read one — this was a latent trap, not a live exposure, and the fix
  was cheap precisely because there were no callers to migrate, so `tenantId` could be
  made a *required* leading parameter rather than an optional one nobody passes. Two
  design points carry the weight. First, the store **refuses rather than normalizes**:
  trimming and lowercasing an id is a many-to-one map, so `"Acme"` and `"acme"` would
  land in one bucket — the bug wearing the fix's clothes. Second, the process-local
  fallback is scoped too; scoping only the Redis key would have fixed nothing for any
  deployment without `REDIS_URL` set, which is this package's documented default. The
  id rule is an **allowlist** (`/^[A-Za-z0-9._-]{1,128}$/`), so the characters nobody
  thought of are refused by default rather than enumerated by someone who tried.
- **`proof:network-nac` (37 checks)** — 802.1X / NAC access posture, read-only. The
  device's network SEGMENT is now evaluated against an operator-supplied policy rather
  than merely carried: an unexpected VLAN steps up, a segment the operator marked
  high-consequence (management / security / OT) restricts, and a policy that cannot be
  applied because the source reported no segment forecloses. Where NO policy is
  supplied the segment is not graded and the verdict says so — it reports
  `AUTHENTICATED_SEGMENT_UNVERIFIED` rather than claiming a trusted segment it never
  checked. Matching is trimmed and case-insensitive, because the same VLAN arrives
  spelled differently from NAC, RADIUS and switch inventories.
- **`proof:response-accountability` (82 checks)** — the ITSM "watermelon": green
  outside, red inside. A concern reported RESOLVED while the underlying state still
  shows it present is the finding, and it is asserted to outrank every green process
  metric on the same record — because a watermelon is green on every other axis by
  construction. A closure nobody re-checked is its own state (`monitor`), distinct
  from both a verified fix and a proven-false one, because that is where a watermelon
  hides. The ceiling is `alert`: every finding here is a PROCESS failure, and the
  worker on the device did not close the ticket, so this dimension raises its voice
  and never raises the bar on a worker. Routing is a pure longest-match lookup that
  decides WHO to tell; it never delivers — delivery is the outbound-emitter surface,
  which remains an explicit owner decision.

  **A watermelon was found inside the watermelon detector, after it shipped.** The
  verdict fold was *seeded* with `RESPONSE_VERIFIED_RESOLVED` — documented as "Owned,
  timely, and verified gone" — so "no candidate fired" silently became "the concern is
  confirmed gone". `closed_unresolved` had been added to the resolution union with no
  candidate covering it, so the seed spoke for it: a record closed with **no fix claim at
  all**, with the concern **confirmed still present**, returned posture
  `resolved_verified`, action `none`. It is the same unearned-affirmative defect this
  repository has now found three times — Jamf's hardcoded `compliant: true`, ISE's
  hardcoded `status: "registered"`, and this one; the first two were fixed here and the
  third was shipped here. The affirmative verdict is now guarded structurally rather than
  by adding a case, so it is unreachable without `underlyingConcernStillPresent === false`
  — for every resolution value present *and future*, since a new union member is exactly
  how this arrived. Two reasons the 43-check proof and its 576-state sweep missed it, both
  fixed: the `closed_unresolved` assertion tested only what the verdict *was not*
  (`!== "WATERMELON_…"`), licensing every other wrong answer; and the sweep's own
  `justified` oracle blessed `closed_unresolved` **unconditionally**, so the check named
  "ZERO unjustified clean verdicts" agreed with the bug. An assertion is only as good as
  the belief behind it. Clean states 7 → **5** (the two that left were the defect);
  watermelon states unchanged at 24.

  **The same defect had a twin in the timeliness helper.** `deriveAcknowledgement`
  returned `acknowledged_within_target` when the caller supplied **no target** — a claim
  of compliance with a target that does not exist, so an acknowledgement 27 hours late
  graded identically to one answered inside a five-minute window. Declining to invent a
  threshold was right; the state it fell back to was not. And the check guarding it read
  `check("NO TARGET means timeliness is not graded", … === "acknowledged_within_target")`
  — a **name that described the correct behaviour above an assertion pinning the wrong
  one**. When a test's name and its assertion disagree, the assertion wins silently.
  There is now a distinct `acknowledged_ungraded` state (kept apart from `unknown`,
  because the fact is known and only the policy is missing) reported at `monitor` via
  `ACKNOWLEDGEMENT_TARGET_UNSTATED` — since the clean verdict claims the response was
  *timely*, and that word must not land on a record nobody measured. Sweep 576 → **720**
  states (a fifth acknowledgement value); watermelons 24 → **30**, the detector's reach
  growing with the space rather than shrinking; clean still **5**.

  **Resolution timing — the only three ITSM KPIs this dimension can carry honestly.**
  From a 19-KPI service-management set, 11 were already covered elsewhere in the repo and
  5 are out of scope (rates, means and trends over a ticket corpus the fabric does not
  hold, which would need a wall clock a decision path must not read). The residual three
  — SLA achievement, mean time to restore, and backlog aging — collapse to **one**
  caller-supplied `elapsedSinceRaisedSeconds` graded against one caller-supplied
  `resolutionTargetSeconds`. One field, two readings, chosen by `resolution`: closed, it
  is time-to-close; open, it is the concern's current age. They are the same clock read
  at different moments, so two fields would invite a record that disagrees with itself.
  A breach reports `RESOLUTION_TARGET_MISSED` when closed and `BACKLOG_AGED_BEYOND_LIMIT`
  when open — same number, different remedy, never collapsed — both at `monitor`, because
  **a slow fix is not a false one** and `alert` stays reserved for someone claiming a
  problem went away that did not. `ResponseTimeliness` keeps three absences apart
  (`ungraded` = no policy, `unmeasured` = no clock, `unknown` = a broken value, which is
  reported rather than skipped since an unreadable clock is not a met target). Unlike the
  acknowledgement axis, `ungraded` raises nothing — the clean verdict claims the
  *acknowledgement* window and says nothing about resolution speed, so nothing is
  overstated, and reporting it would put every record without a resolution SLA into
  permanent `monitor`. Sweep 720 → **3,600** states (720 × 5 timing states); clean 5 →
  **15** (5 × the 3 timing states that raise nothing); watermelons 30 → **150** (30 × 5,
  timing free) — pinning that a watermelon which *also* blew its SLA is still reported as
  the watermelon rather than downgraded to a missed target.

  **Evidence provenance — the USER CONFIRMATION box.** Every IT support flow chart gates
  ticket closure on a user confirming the fix. `underlyingConcernStillPresent` documented
  itself as *"supplied by the caller from a fresh read of the same signal that raised the
  concern"* — and documented was all it was. Nothing stopped a caller populating it from
  what the user said, so the fabric would issue its strongest verdict on its weakest
  evidence. `resolutionEvidence` makes the provenance a field: `signal_recheck`,
  `user_confirmation`, `none`, `unknown`. A closure on a user's word reports
  `RESOLVED_ON_USER_CONFIRMATION_ONLY` at `monitor` — the same rung as "nobody looked" and
  deliberately no worse, because a user confirming is strictly more evidence than nobody
  looking and a desk that closes on confirmation is running a normal process. What it
  cannot do is earn the word *verified*: the user attests the symptom, and the concern was
  raised by a signal nobody re-read. A coherence gate rejects records that claim a
  re-check without a result, or carry a result while claiming none.

  **A negative control deleted part of this fix within minutes of it being written.** The
  first draft also added an evidence clause to the earned-affirmative guard; a control
  that removed that clause passed the entire proof, proving it unreachable — the coherence
  gate always fires first on those states. Keeping it would have read as defence in depth
  while being decoration, so it was removed and the coherence gate is now asserted by name
  as the load-bearing mechanism. Sweep 3,600 → **14,400** states; watermelons 150 → **600**
  (evidence free — `alert` outranks every rung this axis raises); clean 15 → **42**, of
  which twelve are the same three *open* states counted four times, because closure
  evidence does not apply to a record that has not been closed.
- **`proof:provisioning-order` (42 checks)** — zero-touch step ordering, with four
  vendor reference pipelines (Windows Autopilot + Intune, Apple ABM/ADE, Android
  Zero-Touch, Jamf PreStage) expressed in one neutral model and asserted to validate.

SignalGrid performs none of this itself: it reads evaluated state and decides. Zero-touch
provisioning requires the vendor's own enrollment program on organisation-registered
hardware, and no application can grant itself that. These are read-only, fixture-backed
dimensions — not live integrations, and not a compliance or certification claim.
