# Frontline Context Signals Roadmap

> **SUPERSEDED 2026-09-06 as a sequence — do not follow the order below.**
> Last substantively written 2026-08-03. DR-012 (2026-08-22) made the proof stack
> Fleet-first, and most of the "future" signal categories below exist in the tree as
> fixture-proven connector families — deferred families, Beyond Limited GA, not shipping
> capability — with registered proofs: `rtls-custody`, `location-services`, `platform-sso`,
> `app-update` (all under `lib/integrations/src/integrations/`), `lib/ddm-connector`
> (an `artifacts/api-server` dependency), and `badgeBinding` as a `DecisionEvidence`
> field in `lib/signalgrid-core/src/types.ts`. The Sequence column and the guardrails are
> kept as the dated record they are; `docs/INTEGRATION_CATALOG.md` is the current map.

Frontline and healthcare shared-device workflows need more than identity and basic device compliance. SignalGrid should treat those additional signals as future context inputs after the Microsoft Intune / Entra posture proof is grounded. *(As written 2026-08-03; superseded by DR-012 and by the shipped families named in the banner.)*

## Sequence

1. Intune / Entra posture proof, including enrollment governance context.
2. Jamf Apple-specific posture proof.
3. Fleet / Workspace ONE / broader UEM proofs.
4. RTLS, staff safety, and location context.
5. Kontakt.io / RTLS deterministic fixture proof as a follow-on location and staff-safety signal path.
6. DockBridge simulated events.
7. Operator mobile workflow.
8. MCP / agentic connectors later.

## Signal categories

| Signal category                                                        | What SignalGrid could consume                                                                                                                                                  | Runtime decision effect                                                                                                                                             | Sequence                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Intune device limits and enrollment restrictions                       | Device enrollment status, enrollment restriction reason, device-limit state, management eligibility, and source reference.                                                     | Route unknown or restricted enrollment state to step-up/review; prevent treating an unmanaged or blocked device as compliant.                                       | Included in the Intune / Entra posture proof scaffold.                                                |
| iOS/iPadOS enrollment type and Apple Business Manager / ADE state      | Supervision state, ADE/ABM enrollment path, shared-device enrollment type, ownership context, management channel, device-limit state, and last management check-in.            | Increase confidence for managed shared devices; route BYOD, device-limit issues, stale check-ins, or mismatched enrollment paths to review for high-risk workflows. | Included first through Intune / Entra fixtures; deep Apple-specific expansion remains Jamf follow-on. |
| Jamf Pro Apple inventory, policy, compliance, and Self Service context | Apple inventory, management profile state, smart-group compliance, policy result freshness, and Self Service remediation availability.                                         | Use Jamf posture and compliance freshness as an Apple-focused normalized posture input after Microsoft proof.                                                       | Follow-on UEM proof.                                                                                  |
| Declarative Device Management / Managed Device Attestation             | DDM declaration state, device attestation posture, hardware attestation where available, profile/application declaration status, and freshness.                                | Increase trust confidence for Apple-managed devices or route missing/stale attestation to step-up/review for sensitive workflows.                                   | Jamf Apple-specific posture proof.                                                                    |
| Platform SSO / APNs / Apple update readiness                           | Platform SSO context where available, APNs communication health, Apple OS/platform version, update readiness, and update deferral state.                                       | Add Apple-specific identity/device freshness context to access decisions and route unhealthy communication or update-blocked devices to review.                     | Jamf Apple-specific posture proof.                                                                    |
| Fleet / Workspace ONE UEM posture                                      | Inventory, management state, policy results, OS version, encryption status, and last-seen/check-in freshness.                                                                  | Convert UEM posture into the same normalized SignalGrid posture model used by the Microsoft proof.                                                                  | Follow-on UEM proof.                                                                                  |
| Kontakt.io / RTLS / location context                                   | Device, staff, patient, asset, or equipment location zone; stale location timestamps; room/department context; confidence; and future Kontakt.io-style RTLS source references. | Require step-up/review when a device or badge is outside the expected unit, department, or workflow location.                                                       | Future roadmap after UEM posture.                                                                     |
| Staff safety alerts                                                    | Active duress alerts, panic button events, badge/wearable events, safety incident state, and escalation ownership.                                                             | Prioritize operator alerting, preserve access where needed for safety, or route high-risk actions to human review.                                                  | Future roadmap.                                                                                       |
| Nurse call / escalation events                                         | Active call state, escalation tier, assigned responder, unit, and elapsed time.                                                                                                | Allow or prioritize emergency workflow access while recording evidence and routing exceptions for review.                                                           | Future roadmap.                                                                                       |
| Patient/staff/equipment location context                               | Matched patient room, staff assignment, equipment location, transport state, and stale/missing indicators.                                                                     | Validate that a shared device or operator is in the expected context for a workflow before allowing sensitive action.                                               | Future roadmap.                                                                                       |
| Dock / return station events                                           | Device docked, undocked, wrong-slot return, overdue return, charging fault, dock offline, and signed event metadata.                                                           | Trigger posture/session review, operator alerting, or audit evidence when a shared device leaves or returns to controlled storage.                                  | DockBridge simulated event proof after posture proof.                                                 |
| Badge / QR / NFC physical-context events                               | Badge tap, QR scan, NFC handoff, station identifier, timestamp, and device/session correlation.                                                                                | Correlate user, device, and physical handoff context before allowing shared-device workflow access.                                                                 | Future roadmap and operator mobile workflow.                                                          |

## Guardrails

*(Dated 2026-08-03. The first three bullets are superseded: DR-012 puts Fleet first, and RTLS, location, badge and dock signals are simulated and fixture-proven today as deferred families (not Limited GA) — `proof:rtls-custody`, `proof:location-services`, `proof:live-location`, `proof:ddm-connector`. The remaining bullets stand.)*

- Keep Intune / Entra posture as the first concrete proof.
- Treat Jamf as the Apple-specific posture follow-on proof, then Fleet, Workspace ONE, and broader UEM paths as additional follow-on proofs.
- Keep RTLS, staff safety, nurse call, location, DockBridge, badge, QR, and NFC signals future-facing until simulated and validated.
- Do not claim healthcare compliance certification.
- Do not use customer data, production tenant data, secrets, protected health information, real patient/staff identifiers, proprietary hospital slide content, or vendor logos in public fixtures.
- Do not claim replacement of IAM, UEM/MDM, Kontakt.io or RTLS platforms, nurse call, staff safety, EHR, ITSM, SIEM, NAC, or dock/hardware systems.
- Treat Kontakt.io / RTLS as a future candidate path only: no current partnership, validated integration, patient-care outcome guarantee, or production-ready claim.
