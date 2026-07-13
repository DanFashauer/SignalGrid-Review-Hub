# SignalGrid Review Hub

SignalGrid is a runtime decision layer and Operational Trust Orchestration platform for shared, mobile, and frontline environments. It evaluates identity, device posture, operational context, physical custody, workflow ownership, integration health, and risk signals to determine what should happen next before workflows break.

## What this repository is

**DanFashauer/SignalGrid-Review-Hub** is the public working surface for SignalGrid pre-production planning, post-launch review, public visibility, and external validation. It is where reviewers can understand the product direction, validate the story, inspect public roadmap assumptions, and discuss integration priorities without requiring access to the protected core source repository.

Current stage: **public pre-production / review / validation surface**.

## Runnable simulator foundation

Review Hub includes a local SignalGrid real-life simulator foundation. It uses deterministic fixtures to show how identity, device state and compliance, device posture, operational health, RTLS/location, DockBridge/shared-device events, workflow ownership, integration health, decisions, routed actions, and audit evidence fit together.

Local simulator entry points:

- Review Hub UI: `http://localhost:5173`
- API health: `http://localhost:5174/api/healthz`
- Static integrations: `http://localhost:5174/api/integrations`
- Simulator scenarios: `http://localhost:5174/api/simulator/scenarios`
- Simulator proof: `pnpm run proof:signalgrid-simulator`
- Simulator dev suite: `pnpm run dev:simulator`

The simulator is public-safe: no credentials, no tenant IDs, no customer data, no real Microsoft Graph calls, and no real vendor API calls.

## What this repository is not

This repository is not the production SignalGrid core, not a customer deployment package, and not a compliance-certified system. It does not replace existing enterprise systems such as IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM, or NAC. It does not claim current partner certification, partnership, or alliance status with any listed vendor.

## Repository roles

| Repository                          | Role going forward                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `DanFashauer/SignalGrid`            | Private protected source, backup, and core foundation.                         |
| `DanFashauer/SignalGrid-Review-Hub` | Public pre-production and post-launch review/validation surface.               |
| `DanFashauer/DEV`                   | Legacy Alpha repository and future Home/profile transition area after cleanup. |
| `DanFashauer/Home`                  | Future personal homepage, resume, and founder profile if created separately.   |

## Relationship to the private SignalGrid core

The private SignalGrid repository remains the protected source and core foundation. Review Hub documents the public-facing strategy, validation model, milestone plan, and integration assumptions that can be discussed externally. Validated concepts may later move into the private core implementation, while protected implementation details, credentials, customer data, and sensitive deployment logic remain private.

## Relationship to DEV and future Home

`DanFashauer/DEV` is treated as a legacy Alpha source of learnings and a future personal Home/profile repository after SignalGrid materials are migrated, summarized, or archived. Review Hub preserves the SignalGrid-specific public strategy so DEV can eventually become a cleaner personal or portfolio surface.

## Current priorities

1. Preserve Alpha learnings.
2. Validate public positioning.
3. Prepare the first integration proof.
4. Document the mobile/operator workflow direction.
5. Support design-partner conversations.

## Level 10 review path

For a fast public-safe review, start with the [Executive One-Pager](docs/EXECUTIVE_ONE_PAGER.md), then review the [Strategic Buyer / Partner Pitch Pack](docs/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md), [Level 10 Completion Matrix](docs/LEVEL_10_COMPLETION_MATRIX.md), [Level 10 Autopilot Runbook](docs/LEVEL_10_AUTOPILOT_RUNBOOK.md), Review Hub dashboards, deterministic proof evidence, [Real-World Testing Readiness Plan](docs/REAL_WORLD_TESTING_READINESS_PLAN.md), and [Company Operating Pack](docs/COMPANY_OPERATING_PACK.md). The recommended owner flow is: understand the one-pager, inspect proofs, choose the relevant pitch/demo path, confirm public-safety guardrails, and approve only YELLOW/RED or strategic decisions.

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md) for the complete public review package. The honest end-to-end launch sequence — from today's review surface to demo, design partner, paid pilot, and production SaaS — is in [`docs/REALISTIC_LAUNCH_PLAN.md`](docs/REALISTIC_LAUNCH_PLAN.md). The v0.2 product-foundation plan starts with [`docs/SIGNALGRID_V0_2_READINESS_PLAN.md`](docs/SIGNALGRID_V0_2_READINESS_PLAN.md), [`docs/V0_2_EPIC_BACKLOG.md`](docs/V0_2_EPIC_BACKLOG.md), [`docs/MICROSOFT_CONNECTOR_FIRST_PATH.md`](docs/MICROSOFT_CONNECTOR_FIRST_PATH.md), [`docs/SECURE_TENANCY_FOUNDATION_PLAN.md`](docs/SECURE_TENANCY_FOUNDATION_PLAN.md), [`docs/PILOT_READINESS_CRITERIA.md`](docs/PILOT_READINESS_CRITERIA.md), and [`docs/PRODUCT_REALITY_CHECKLIST.md`](docs/PRODUCT_REALITY_CHECKLIST.md). Continue with [`docs/INDEX.md`](docs/INDEX.md) including Operational Trust Orchestration positioning, the simulator foundation, lineage, Alpha parity, milestone strategy, mobile/platform direction, integration catalog, Signal Source Catalog, the first Intune / Entra posture proof, Operational Health / DEX layer strategy, ecosystem positioning, configuration remediation guardrails, partner strategy, roadmap to private core, and reviewer checklist. The Operational Trust Orchestration category definition lives in [`docs/OPERATIONAL_TRUST_ORCHESTRATION.md`](docs/OPERATIONAL_TRUST_ORCHESTRATION.md). The short buyer-facing answer to “why not just use existing IAM/UEM/ITSM tools?” lives in [`docs/ECOSYSTEM_POSITIONING.md`](docs/ECOSYSTEM_POSITIONING.md), the first concrete posture-signal proof is in [`docs/INTUNE_ENTRA_POSTURE_PROOF.md`](docs/INTUNE_ENTRA_POSTURE_PROOF.md), and the cloud-first connector emulator is documented in [`docs/CLOUD_CONNECTOR_EMULATOR_HARNESS.md`](docs/CLOUD_CONNECTOR_EMULATOR_HARNESS.md) with scenario coverage in [`docs/CONNECTOR_EMULATOR_SCENARIOS.md`](docs/CONNECTOR_EMULATOR_SCENARIOS.md) and the dashboard guide in [`docs/CONNECTOR_EMULATOR_REVIEW_DASHBOARD.md`](docs/CONNECTOR_EMULATOR_REVIEW_DASHBOARD.md). Hardware custody strategy lives in [`docs/HARDWARE_PARTNER_MATRIX.md`](docs/HARDWARE_PARTNER_MATRIX.md), [`docs/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md`](docs/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md), [`docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md`](docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md), [`docs/CREDENTIAL_READER_SIGNAL_MODEL.md`](docs/CREDENTIAL_READER_SIGNAL_MODEL.md), and [`docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md`](docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md). Review Hub automation is described in [`docs/CI_AND_VALIDATION.md`](docs/CI_AND_VALIDATION.md), the Autopilot Control Plane is in [`docs/SIGNALGRID_AUTOPILOT_CONTROL_PLANE.md`](docs/SIGNALGRID_AUTOPILOT_CONTROL_PLANE.md), phase PR evidence is in [`docs/PHASE_PR_EVIDENCE_BOT.md`](docs/PHASE_PR_EVIDENCE_BOT.md), the buyer/partner readiness pack is in [`docs/BUYER_PARTNER_READINESS_PACK.md`](docs/BUYER_PARTNER_READINESS_PACK.md), the strategic buyer/partner pitch pack is in [`docs/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md`](docs/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md), the Level 10 completion matrix is in [`docs/LEVEL_10_COMPLETION_MATRIX.md`](docs/LEVEL_10_COMPLETION_MATRIX.md), the Level 10 Autopilot runbook is in [`docs/LEVEL_10_AUTOPILOT_RUNBOOK.md`](docs/LEVEL_10_AUTOPILOT_RUNBOOK.md), the outbound-ready pitch execution pack is in [`docs/PITCH_EXECUTION_PACK.md`](docs/PITCH_EXECUTION_PACK.md), the social media pre-announcement packet is in [`docs/SOCIAL_MEDIA_PREANNOUNCEMENT_PACKET.md`](docs/SOCIAL_MEDIA_PREANNOUNCEMENT_PACKET.md), target categories are in [`docs/PITCH_TARGET_CATEGORIES.md`](docs/PITCH_TARGET_CATEGORIES.md), the target buyer/partner matrix is in [`docs/TARGET_BUYER_PARTNER_MATRIX.md`](docs/TARGET_BUYER_PARTNER_MATRIX.md), partnership and acquisition paths are in [`docs/PARTNERSHIP_AND_ACQUISITION_PATHS.md`](docs/PARTNERSHIP_AND_ACQUISITION_PATHS.md), founder-control requirements are in [`docs/FOUNDER_CONTROL_REQUIREMENTS.md`](docs/FOUNDER_CONTROL_REQUIREMENTS.md), company operating strategy is in [`docs/COMPANY_OPERATING_PACK.md`](docs/COMPANY_OPERATING_PACK.md), real-world testing readiness is in [`docs/REAL_WORLD_TESTING_READINESS_PLAN.md`](docs/REAL_WORLD_TESTING_READINESS_PLAN.md), the phase automation loop is in [`docs/PHASE_AUTOMATION_ORCHESTRATOR.md`](docs/PHASE_AUTOMATION_ORCHESTRATOR.md), the phase backlog is in [`docs/PHASE_BACKLOG.md`](docs/PHASE_BACKLOG.md), intake classification is in [`docs/INTAKE_CLASSIFICATION_GUIDE.md`](docs/INTAKE_CLASSIFICATION_GUIDE.md), merge-lane policy is in [`docs/GREEN_YELLOW_RED_MERGE_POLICY.md`](docs/GREEN_YELLOW_RED_MERGE_POLICY.md), the mobile-first Codex operating loop is in [`docs/MOBILE_CODEX_WORKFLOW.md`](docs/MOBILE_CODEX_WORKFLOW.md), reusable Codex task prompts are in [`docs/CODEX_TASK_TEMPLATE.md`](docs/CODEX_TASK_TEMPLATE.md) and [`docs/AUTOMATION_PHASE_TEMPLATE.md`](docs/AUTOMATION_PHASE_TEMPLATE.md), validation commands are in [`docs/VALIDATION_COMMANDS.md`](docs/VALIDATION_COMMANDS.md), repo-level agent guardrails are in [`AGENTS.md`](AGENTS.md), Microsoft Graph/MCP sequencing is in [`docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md`](docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md), Apple open-source platform strategy is in [`docs/APPLE_OPEN_SOURCE_PLATFORM_STRATEGY.md`](docs/APPLE_OPEN_SOURCE_PLATFORM_STRATEGY.md), and visual-code process is in [`docs/VISUAL_CODE_ASSET_STRATEGY.md`](docs/VISUAL_CODE_ASSET_STRATEGY.md).

## Disclaimer

SignalGrid Review Hub is not production-ready, not compliance-certified, and not a replacement for IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM, NAC, or other source systems. Remediation concepts are simulated, constrained, or operator-approved unless separately validated. No current partner certification, partnership, or alliance status is claimed.
