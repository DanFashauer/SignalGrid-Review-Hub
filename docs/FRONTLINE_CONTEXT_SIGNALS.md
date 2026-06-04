# Frontline Context Signals Roadmap

Frontline and healthcare shared-device workflows need more than identity and basic device compliance. SignalGrid should treat those additional signals as future context inputs after the Microsoft Intune / Entra posture proof is grounded.

## Sequence

1. Intune / Entra posture proof.
2. Jamf Apple-specific posture proof.
3. Fleet / Workspace ONE / broader UEM proofs.
4. RTLS, staff safety, and location context.
5. DockBridge simulated events.
6. Operator mobile workflow.
7. MCP / agentic connectors later.

## Signal categories

| Signal category                                                        | What SignalGrid could consume                                                                                                                   | Runtime decision effect                                                                                                                         | Sequence                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Intune device limits and enrollment restrictions                       | Device enrollment status, enrollment restriction reason, device-limit state, management eligibility, and source reference.                      | Route unknown or restricted enrollment state to step-up/review; prevent treating an unmanaged or blocked device as compliant.                   | First proof extension after the base Intune / Entra posture scaffold. |
| iOS/iPadOS enrollment type and Apple Business Manager / ADE state      | Supervision state, ADE/ABM enrollment path, shared-device enrollment type, ownership context, and last management check-in.                     | Increase confidence for managed shared devices; route BYOD or mismatched enrollment paths to review for high-risk workflows.                    | Follow-on UEM proof.                                                  |
| Jamf Pro Apple inventory, policy, compliance, and Self Service context | Apple inventory, management profile state, smart-group compliance, policy result freshness, and Self Service remediation availability.          | Use Jamf posture and compliance freshness as an Apple-focused normalized posture input after Microsoft proof.                                   | Follow-on UEM proof.                                                  |
| Declarative Device Management / Managed Device Attestation             | DDM declaration state, device attestation posture, hardware attestation where available, profile/application declaration status, and freshness. | Increase trust confidence for Apple-managed devices or route missing/stale attestation to step-up/review for sensitive workflows.               | Jamf Apple-specific posture proof.                                    |
| Platform SSO / APNs / Apple update readiness                           | Platform SSO context where available, APNs communication health, Apple OS/platform version, update readiness, and update deferral state.        | Add Apple-specific identity/device freshness context to access decisions and route unhealthy communication or update-blocked devices to review. | Jamf Apple-specific posture proof.                                    |
| Fleet / Workspace ONE UEM posture                                      | Inventory, management state, policy results, OS version, encryption status, and last-seen/check-in freshness.                                   | Convert UEM posture into the same normalized SignalGrid posture model used by the Microsoft proof.                                              | Follow-on UEM proof.                                                  |
| RTLS / location context                                                | Device, staff, patient, or equipment location zone; stale location timestamps; room/department context; and confidence.                         | Require step-up/review when a device or badge is outside the expected unit, department, or workflow location.                                   | Future roadmap after UEM posture.                                     |
| Staff safety alerts                                                    | Active duress alerts, panic button events, safety incident state, and escalation ownership.                                                     | Prioritize operator alerting, preserve access where needed for safety, or route high-risk actions to human review.                              | Future roadmap.                                                       |
| Nurse call / escalation events                                         | Active call state, escalation tier, assigned responder, unit, and elapsed time.                                                                 | Allow or prioritize emergency workflow access while recording evidence and routing exceptions for review.                                       | Future roadmap.                                                       |
| Patient/staff/equipment location context                               | Matched patient room, staff assignment, equipment location, transport state, and stale/missing indicators.                                      | Validate that a shared device or operator is in the expected context for a workflow before allowing sensitive action.                           | Future roadmap.                                                       |
| Dock / return station events                                           | Device docked, undocked, wrong-slot return, overdue return, charging fault, dock offline, and signed event metadata.                            | Trigger posture/session review, operator alerting, or audit evidence when a shared device leaves or returns to controlled storage.              | DockBridge simulated event proof after posture proof.                 |
| Badge / QR / NFC physical-context events                               | Badge tap, QR scan, NFC handoff, station identifier, timestamp, and device/session correlation.                                                 | Correlate user, device, and physical handoff context before allowing shared-device workflow access.                                             | Future roadmap and operator mobile workflow.                          |

## Guardrails

- Keep Intune / Entra posture as the first concrete proof.
- Treat Jamf as the Apple-specific posture follow-on proof, then Fleet, Workspace ONE, and broader UEM paths as additional follow-on proofs.
- Keep RTLS, staff safety, nurse call, location, DockBridge, badge, QR, and NFC signals future-facing until simulated and validated.
- Do not claim healthcare compliance certification.
- Do not use customer data, production tenant data, secrets, protected health information, or real patient/staff identifiers in public fixtures.
- Do not claim replacement of IAM, UEM/MDM, RTLS, nurse call, staff safety, EHR, ITSM, SIEM, NAC, or dock/hardware systems.
