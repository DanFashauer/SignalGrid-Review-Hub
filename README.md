# SignalGrid Review Hub

SignalGrid is a runtime decision layer and Zero Trust orchestration platform for shared-device and mobile frontline environments. It evaluates identity, device posture, session context, and operational health signals to determine access outcomes before workflows break.

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

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md) for the complete public review package, including the simulator foundation, lineage, Alpha parity, milestone strategy, mobile/platform direction, integration catalog, the first Intune / Entra posture proof, Operational Health / DEX layer strategy, ecosystem positioning, configuration remediation guardrails, partner strategy, roadmap to private core, and reviewer checklist. The short buyer-facing answer to “why not just use existing IAM/UEM/ITSM tools?” lives in [`docs/ECOSYSTEM_POSITIONING.md`](docs/ECOSYSTEM_POSITIONING.md), and the first concrete posture-signal proof is in [`docs/INTUNE_ENTRA_POSTURE_PROOF.md`](docs/INTUNE_ENTRA_POSTURE_PROOF.md). Hardware custody strategy lives in [`docs/HARDWARE_PARTNER_MATRIX.md`](docs/HARDWARE_PARTNER_MATRIX.md), [`docs/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md`](docs/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md), and [`docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md`](docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md). Review Hub automation is described in [`docs/CI_AND_VALIDATION.md`](docs/CI_AND_VALIDATION.md), the mobile-first Codex operating loop is in [`docs/MOBILE_CODEX_WORKFLOW.md`](docs/MOBILE_CODEX_WORKFLOW.md), reusable Codex task prompts are in [`docs/CODEX_TASK_TEMPLATE.md`](docs/CODEX_TASK_TEMPLATE.md), validation commands are in [`docs/VALIDATION_COMMANDS.md`](docs/VALIDATION_COMMANDS.md), repo-level agent guardrails are in [`AGENTS.md`](AGENTS.md), Microsoft Graph/MCP sequencing is in [`docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md`](docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md), and visual-code process is in [`docs/VISUAL_CODE_ASSET_STRATEGY.md`](docs/VISUAL_CODE_ASSET_STRATEGY.md).

## Disclaimer

SignalGrid Review Hub is not production-ready, not compliance-certified, and not a replacement for IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM, NAC, or other source systems. Remediation concepts are simulated, constrained, or operator-approved unless separately validated. No current partner certification, partnership, or alliance status is claimed.
