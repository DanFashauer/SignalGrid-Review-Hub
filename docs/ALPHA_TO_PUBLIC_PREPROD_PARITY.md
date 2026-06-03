# Alpha to Public Pre-Production Parity

This document preserves SignalGrid Alpha learnings from `DanFashauer/DEV` while clarifying what belongs in the public Review Hub, what should remain private/core, what needs redesign, what is deferred, and what should be archived.

## Classification key

- **Reflected here**: public, non-sensitive strategy or documentation that Review Hub should carry.
- **Should remain private/core**: implementation, protected architecture, or sensitive work that belongs in `DanFashauer/SignalGrid`.
- **Needs redesign**: concept is useful but should be reframed before public or core adoption.
- **Deferred**: valid future concept but not part of the first public/pre-production proof.
- **Archived**: historical Alpha material to preserve only as background, not active roadmap.

## Alpha capability mapping

| Alpha capability / learning | Classification | Review Hub treatment |
| --- | --- | --- |
| Runtime decision-layer positioning | Reflected here | Keep as the primary public positioning: SignalGrid evaluates identity, device posture, session context, and operational signals before workflows break. |
| `/api/v1` compatibility API surface | Should remain private/core | Public docs may describe compatibility intent, but endpoint contracts and code-level compatibility should be validated in the protected core. |
| Demo/scenario validation | Reflected here | Capture demo scenarios and reviewer questions publicly while keeping sensitive datasets or implementation private. |
| RC smoke concept | Reflected here | Preserve the idea of release-candidate smoke validation as a public quality gate without claiming production readiness. |
| Claim boundaries | Reflected here | Explicitly state non-production, non-certified, not-a-replacement, and no-current-partner-claim boundaries. |
| Brand system and visual assets | Needs redesign | Preserve useful visual direction, but review for public clarity, asset ownership, accessibility, and consistency before launch use. |
| Launch outreach package | Needs redesign | Keep the need for a concise outreach package, but rebuild around validated positioning and no overclaims. |
| IAM integration concepts | Reflected here | Document IAM as a source/decision input category; first likely targets include Entra ID and Okta. |
| UEM/MDM integration concepts | Reflected here | Document posture ingestion from Intune, Jamf, Workspace ONE, Fleet, or similar systems; do not frame SignalGrid as replacing UEM/MDM. |
| NAC integration concepts | Deferred | Keep Cisco ISE and Aruba/ClearPass as future context sources and action destinations after the first proof. |
| SIEM integration concepts | Deferred | Keep Microsoft Sentinel and Splunk as event/audit destinations or enrichment paths after the first proof. |
| ITSM integration concepts | Deferred | Keep ServiceNow and Jira Service Management as workflow/ticketing paths after the first proof. |
| Audit concepts | Reflected here | Maintain audit record expectations as part of each decision and remediation flow. |
| Location integration concepts | Deferred | Keep badge, QR/NFC, location, and RTLS as shared-device context signals for later validation. |
| iOS/mobile prototype learnings | Reflected here | Preserve mobile operator and admin companion workflows as strategy; implementation should be rebuilt when the platform path is chosen. |
| Admin console concepts | Reflected here | Document console needs such as active sessions, integration health, approvals, and emergency actions. |

## Public parity goal

Review Hub does not need to reproduce every Alpha artifact. It needs to preserve the learnings, clarify what can be discussed publicly, and define which concepts are ready for review versus private implementation.

## Claim boundaries

Alpha material must not be carried forward as proof of production readiness, compliance certification, partner certification, or replacement of IAM/UEM/SIEM/ITSM/MDM/NAC systems. Any remediation story should remain simulated, constrained, or operator-approved until validated.
