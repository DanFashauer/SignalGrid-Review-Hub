# Target Buyer / Partner Matrix

Use categories, not unsupported named-company claims.

| Category | Why they care | What SignalGrid adds | Likely partnership path | Proof assets to show | Questions to ask | Guardrails |
|---|---|---|---|---|---|---|
| Identity security | Trust decisions span identity and operational context. | Cross-signal explanation and approval evidence. | Co-demo or design-partner validation. | Simulator and connector emulator proofs. | Which identity signals lack operational context? | Do not claim IAM/IGA replacement. |
| IAM / IGA / NHI | Access, entitlement, and non-human identity context can be fragmented. | Normalized evidence and decision rationale. | Read-only evidence enrichment concept. | Intune/Entra posture and simulator proof. | Where do approvals need better evidence? | Systems of record stay authoritative. |
| MDM / UEM | Device posture alone may not explain workflow risk. | Adds workflow, custody, and verification context. | Fixture-backed demo extension. | Connector emulator and grid proof. | What device actions require approvals? | No live MDM writes; custody is a deferred family, not Limited GA. |
| Healthcare workflow/shared-device | Shared devices and role workflows create custody ambiguity. | Custody-aware trust timeline. | Design partner dry run. | Smart-locker and credential-reader docs. | Which workflows create audit pain? | No PHI/PII; custody-aware context is a deferred family. |
| Smart locker / credential-reader hardware | Physical custody signals need software context. | Connects reader/locker signals to decisions. | Hardware narrative and mocked demo. | Credential-reader/smart-locker models. | Which events are reliable custody signals? | No unsupported hardware partnership claim; custody signals are a deferred family (design target). |
| Network/security | Network risk needs identity/device/workflow context. | Evidence routing and verification timeline. | Read-only signal normalization concept. | Simulator proof. | Which network signals change risk? | No NAC/SIEM/SOAR replacement claim. |
| ITSM/SOAR/workflow | Tickets and playbooks need better decision evidence. | Approval-gated routing and audit record. | Workflow integration concept. | Phase PR evidence and simulator docs. | Where are approvals bypassed today? | No autonomous production remediation claim. |
| Healthcare IT integrator | Integrators need explainable, safe workflows. | Packaged demo and staged readiness checklist. | Design-partner or services-led validation. | Real-world testing readiness pack. | What sandbox proof would matter? | No live customer data. |
| Frontline operations platform | Frontline context is often outside identity tools. | Normalized operations-to-trust narrative. | Co-demo or embedded concept. | Demo expansion plan. | Which frontline events should influence trust? | No production deployment claim. |
| Enterprise automation/platform engineering | Automation needs guardrails, approvals, and evidence. | Risk lanes, phase gates, and proof artifacts. | Internal platform demo concept. | Autopilot runbook and scorecard. | What should be auto-routed vs owner-approved? | No blind YELLOW/RED auto-merge. |
