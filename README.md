# SignalGrid Review Hub

SignalGrid is a runtime decision layer and Operational Trust Orchestration platform for shared, mobile, and frontline environments. At the moment a workflow fires it fuses the evidence the deterministic core evaluates today — identity state, device posture, physical custody (DockBridge), security-baseline (CIS) alignment, device owner type, and workflow risk — into a single allow / step-up / restrict / deny decision. Broader signal-source categories (network/cellular, session/shift, and operational SIEM/ITSM signals) are candidate/roadmap, not decision inputs today. See [What SignalGrid Does Today](docs/WHAT_SIGNALGRID_DOES_TODAY.md) for the exact implemented-vs-candidate boundary.

## The operating model: managed as code (GitOps)

SignalGrid is driven the way modern platform teams run everything else —
**declaratively, in version control, through pull requests**, not by clicking
through an MDM console. Device configurations, compliance policies, software
packages, and the decision rules that gate them live as version-controlled files;
changes roll out through review and approval; and the system continuously checks
that the fleet still matches what Git declares (drift detection). This is
Infrastructure-as-Code / GitOps for endpoints, and it is the primary way
SignalGrid is meant to be operated.

What makes it SignalGrid's IaC rather than a generic Terraform/Ansible pipeline
is two things only a trust fabric adds:

1. **The apply is trust-gated.** A declared change rolls out *through the decision
   fabric* — an apply is refused unless a live decision returns `allow` (a
   `restrict` / `deny` / fail-closed `unknown` blocks it), on top of a recorded
   human approval. A rollout can never apply itself.
2. **Drift is a signal.** The gap between declared and observed fleet state feeds
   the self-audit checklist and the posture engine, so configuration drift
   degrades trust the same way a missing security signal does.

Fleet, Microsoft Intune, and Jamf are the declarative **backends** SignalGrid
plans, gates, and drift-checks — it complements a Fleet GitOps repo or a
Terraform+Intune module, and never competes with one. Engine:
[`lib/iac`](lib/iac) · proof: `pnpm run proof:iac` (67 checks) · fixture status:
`GET /api/cp/v1/iac` · full write-up: [`docs/IAC_GITOPS.md`](docs/IAC_GITOPS.md).

## Live demo — build the grid

An interactive, public-safe console with one idea: **you add signals and workflows; the grid evaluates more of what happens.** Every signal lets the grid *see* more; every workflow lets it *assess* more. Toggle signals and workflows on and watch coverage of illustrative situations (lost tablet, compromised sign-in, PHI exfiltration, unmanaged access, config drift, tailgating) climb — each caught only when its workflow is active and the signals it needs are wired, then **evaluated** by the grid, which returns allow / step-up / restrict / deny together with the evidence behind it. SignalGrid decides and explains; it does not act. Carrying out a response belongs to the host app and to the systems of record, and any high-risk response is simulated or approval-required. The more you add, the more of the organization's activity the grid can reason about — not control. It mirrors the **real fusion + orchestration logic** ([`lib/posture-composition`](lib/posture-composition)) on illustrative data — no live tenant, no action taken — the same logic proven end-to-end by `pnpm run proof:fabric-scenario`.

- Source: [`docs/fabric-console.html`](docs/fabric-console.html) (self-contained, offline)
- Published at `https://signalgrid.app/fabric.html` once the [Pages workflow](.github/workflows/pages.yml) is run

## What this repository is

**DanFashauer/SignalGrid-Review-Hub** is the public working surface for SignalGrid pre-production planning, post-launch review, public visibility, and external validation. It is where reviewers can understand the product direction, validate the story, inspect public roadmap assumptions, and discuss integration priorities without requiring access to the protected core source repository.

Current stage: **concept / pre-dev — a public, buildable prototype and review/validation surface**, not production software. This consolidated monorepo is the current source of truth; the earlier `DanFashauer/DEV` and `DanFashauer/SignalGrid` (beta) repos are **legacy (pre-dev / concept) and superseded by this repo**. It carries a **dev → alpha → beta → prod** tier layout. See [`docs/REPO_LAYOUT.md`](docs/REPO_LAYOUT.md) for the package/branch structure, the legacy-repo mapping, and the promotion pipeline.

## Runnable simulator foundation

Review Hub includes a local SignalGrid real-life simulator foundation. It uses deterministic fixtures to show how identity, device state and compliance, device posture, operational health, RTLS/location, DockBridge/shared-device events, workflow ownership, integration health, decisions, routed actions, and audit evidence fit together.

Local simulator entry points:

- Review Hub UI: `http://localhost:5173`
- API health: `http://localhost:5174/api/healthz`
- Static integrations: `http://localhost:5174/api/integrations`
- Simulator scenarios: `http://localhost:5174/api/simulator/scenarios`
- Simulator proof: `pnpm run proof:signalgrid-simulator`
- Product core proof (tenancy, policy, decision, evidence, audit): `pnpm run proof:signalgrid-core`
- API contract + integration tests: `pnpm run proof:api-contract` and `pnpm run test:api`
- Product `/v1` API (works without a database): `POST /api/v1/decisions/evaluate` with a demo Bearer key
- Operator Console decision trace: the "Operator Console" section of the Review Hub UI
- Simulator dev suite: `pnpm run dev:simulator`

The simulator is public-safe: no credentials, no tenant IDs, no customer data, no real Microsoft Graph calls, and no real vendor API calls.

## What this repository is not

This repository is not the production SignalGrid core, not a customer deployment package, and not a compliance-certified system. It does not replace existing enterprise systems such as IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM, or NAC. It does not claim current partner certification, partnership, or alliance status with any listed vendor.

## Repository roles

| Repository                          | Role going forward                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `DanFashauer/SignalGrid`            | **Retired.** Legacy beta/POC, superseded by this repo (see line above and `docs/REPO_LAYOUT.md`). Not an active core. |
| `DanFashauer/SignalGrid-Review-Hub` | Public pre-production and post-launch review/validation surface.               |
| `DanFashauer/DEV`                   | Legacy Alpha repository and future Home/profile transition area after cleanup. |
| `DanFashauer/Home`                  | Future personal homepage, resume, and founder profile if created separately.   |

## Relationship to the private SignalGrid core

**The public/private boundary is an OPEN DECISION, not a settled arrangement, and this paragraph used to describe it as settled in a way that contradicted the rest of this same file.** `DanFashauer/SignalGrid` is retired — stated four paragraphs above, and in `docs/REPO_LAYOUT.md`, which this README links as the canonical reference. It is not a protected production core, because no such active repository currently exists: `docs/PRIVATE_CORE_HANDOFF.md` is a blueprint, not an implementation.

So today THIS repository is the single canonical source, and it contains product-shaped runtime logic — real OIDC verification (`lib/enterprise-auth`), durable Postgres persistence (`lib/persistence`, `lib/audit`), gated live vendor transports, and the deterministic decision core. Anyone assessing IP exposure should assess it here.

Choosing between a public-core model (proprietary value in hosted operations, connectors and implementation) and an open-spec-plus-private-SaaS model is a founder decision that has not been made. Until it is, no document should assert that protected implementation lives elsewhere.

## Relationship to DEV and future Home

`DanFashauer/DEV` is treated as a legacy Alpha source of learnings and a future personal Home/profile repository after SignalGrid materials are migrated, summarized, or archived. Review Hub preserves the SignalGrid-specific public strategy so DEV can eventually become a cleaner personal or portfolio surface.

## Current priorities

1. Preserve Alpha learnings.
2. Validate public positioning.
3. Prepare the first integration proof.
4. Document the mobile/operator workflow direction.
5. Support design-partner conversations.

## Level 10 review path

For a fast public-safe review, start with the [Executive One-Pager](docs/EXECUTIVE_ONE_PAGER.md), then review the [Strategic Buyer / Partner Pitch Pack](docs/research/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md), [Level 10 Completion Matrix](docs/LEVEL_10_COMPLETION_MATRIX.md), [Level 10 Autopilot Runbook](docs/LEVEL_10_AUTOPILOT_RUNBOOK.md), Review Hub dashboards, deterministic proof evidence, [Real-World Testing Readiness Plan](docs/research/REAL_WORLD_TESTING_READINESS_PLAN.md), and [Company Operating Pack](docs/COMPANY_OPERATING_PACK.md). The recommended owner flow is: understand the one-pager, inspect proofs, choose the relevant pitch/demo path, confirm public-safety guardrails, and approve only YELLOW/RED or strategic decisions.

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md) for the complete public review package. The honest end-to-end launch sequence — from today's review surface to demo, design partner, paid pilot, and production SaaS — is in [`docs/REALISTIC_LAUNCH_PLAN.md`](docs/REALISTIC_LAUNCH_PLAN.md), and the deterministic, public-safe product core that realizes its tenancy/connector/decision/evidence/audit loop (with a `/v1` API and in-browser Operator Console) is documented in [`docs/PRODUCT_CORE_FOUNDATION.md`](docs/PRODUCT_CORE_FOUNDATION.md), with a [data model](docs/PRODUCT_DATA_MODEL.md), [threat model](docs/PRODUCT_CORE_THREAT_MODEL.md), [security-controls matrix](docs/SECURITY_CONTROLS_MATRIX.md), [`/v1` OpenAPI spec](lib/api-spec/v1-openapi.yaml), a [run & go-live runbook](docs/RUN_AND_GO_LIVE.md), a [private-core hand-off spec](docs/PRIVATE_CORE_HANDOFF.md) for building the production core, the [hardware+software ecosystem flow & Resolution Assistant](docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md) design, and the [DockBridge product connector](docs/DOCKBRIDGE_PRODUCT_CONNECTOR.md) (dock/custody/charging/tamper signals in the decision loop). The v0.2 product-foundation plan starts with [`docs/research/SIGNALGRID_V0_2_READINESS_PLAN.md`](docs/research/SIGNALGRID_V0_2_READINESS_PLAN.md), [`docs/V0_2_EPIC_BACKLOG.md`](docs/V0_2_EPIC_BACKLOG.md) (archived record), [`docs/MICROSOFT_CONNECTOR_FIRST_PATH.md`](docs/MICROSOFT_CONNECTOR_FIRST_PATH.md), [`docs/SECURE_TENANCY_FOUNDATION_PLAN.md`](docs/SECURE_TENANCY_FOUNDATION_PLAN.md), [`docs/PILOT_READINESS_CRITERIA.md`](docs/PILOT_READINESS_CRITERIA.md), and [`docs/research/PRODUCT_REALITY_CHECKLIST.md`](docs/research/PRODUCT_REALITY_CHECKLIST.md). Continue with [`docs/INDEX.md`](docs/INDEX.md) including Operational Trust Orchestration positioning, the simulator foundation, lineage, Alpha parity, milestone strategy, mobile/platform direction, integration catalog, Signal Source Catalog, the first Intune / Entra posture proof, Operational Health / DEX layer strategy, ecosystem positioning, configuration remediation guardrails, partner strategy, roadmap to private core, and reviewer checklist. The Operational Trust Orchestration category definition lives in [`docs/OPERATIONAL_TRUST_ORCHESTRATION.md`](docs/OPERATIONAL_TRUST_ORCHESTRATION.md). The short buyer-facing answer to “why not just use existing IAM/UEM/ITSM tools?” lives in [`docs/ECOSYSTEM_POSITIONING.md`](docs/ECOSYSTEM_POSITIONING.md), the first concrete posture-signal proof is in [`docs/INTUNE_ENTRA_POSTURE_PROOF.md`](docs/INTUNE_ENTRA_POSTURE_PROOF.md), and the cloud-first connector emulator is documented in [`docs/CLOUD_CONNECTOR_EMULATOR_HARNESS.md`](docs/CLOUD_CONNECTOR_EMULATOR_HARNESS.md) with scenario coverage in [`docs/CONNECTOR_EMULATOR_SCENARIOS.md`](docs/CONNECTOR_EMULATOR_SCENARIOS.md) and the dashboard guide in [`docs/CONNECTOR_EMULATOR_REVIEW_DASHBOARD.md`](docs/CONNECTOR_EMULATOR_REVIEW_DASHBOARD.md). Hardware custody strategy lives in [`docs/HARDWARE_PARTNER_MATRIX.md`](docs/HARDWARE_PARTNER_MATRIX.md), [`docs/research/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md`](docs/research/BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md), [`docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md`](docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md), [`docs/CREDENTIAL_READER_SIGNAL_MODEL.md`](docs/CREDENTIAL_READER_SIGNAL_MODEL.md), and [`docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md`](docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md). Review Hub automation is described in [`docs/CI_AND_VALIDATION.md`](docs/CI_AND_VALIDATION.md), the Autopilot Control Plane is in [`docs/SIGNALGRID_AUTOPILOT_CONTROL_PLANE.md`](docs/SIGNALGRID_AUTOPILOT_CONTROL_PLANE.md), phase PR evidence is in [`docs/PHASE_PR_EVIDENCE_BOT.md`](docs/PHASE_PR_EVIDENCE_BOT.md), the buyer/partner readiness pack is in [`docs/research/BUYER_PARTNER_READINESS_PACK.md`](docs/research/BUYER_PARTNER_READINESS_PACK.md), the strategic buyer/partner pitch pack is in [`docs/research/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md`](docs/research/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md), the Level 10 completion matrix is in [`docs/LEVEL_10_COMPLETION_MATRIX.md`](docs/LEVEL_10_COMPLETION_MATRIX.md), the Level 10 Autopilot runbook is in [`docs/LEVEL_10_AUTOPILOT_RUNBOOK.md`](docs/LEVEL_10_AUTOPILOT_RUNBOOK.md), the outbound-ready pitch execution pack is in [`docs/research/PITCH_EXECUTION_PACK.md`](docs/research/PITCH_EXECUTION_PACK.md), the social media pre-announcement packet is in [`docs/research/SOCIAL_MEDIA_PREANNOUNCEMENT_PACKET.md`](docs/research/SOCIAL_MEDIA_PREANNOUNCEMENT_PACKET.md), target categories are in [`docs/research/PITCH_TARGET_CATEGORIES.md`](docs/research/PITCH_TARGET_CATEGORIES.md), the target buyer/partner matrix is in [`docs/research/TARGET_BUYER_PARTNER_MATRIX.md`](docs/research/TARGET_BUYER_PARTNER_MATRIX.md), partnership and acquisition paths are in [`docs/research/PARTNERSHIP_AND_ACQUISITION_PATHS.md`](docs/research/PARTNERSHIP_AND_ACQUISITION_PATHS.md), founder-control requirements are in [`docs/research/FOUNDER_CONTROL_REQUIREMENTS.md`](docs/research/FOUNDER_CONTROL_REQUIREMENTS.md), company operating strategy is in [`docs/COMPANY_OPERATING_PACK.md`](docs/COMPANY_OPERATING_PACK.md), real-world testing readiness is in [`docs/research/REAL_WORLD_TESTING_READINESS_PLAN.md`](docs/research/REAL_WORLD_TESTING_READINESS_PLAN.md), the phase automation loop is in [`docs/PHASE_AUTOMATION_ORCHESTRATOR.md`](docs/PHASE_AUTOMATION_ORCHESTRATOR.md), the archived phase backlog is in [`docs/PHASE_BACKLOG.md`](docs/PHASE_BACKLOG.md) (the live queue is [`docs/BUILD_BACKLOG.md`](docs/BUILD_BACKLOG.md)), intake classification is in [`docs/INTAKE_CLASSIFICATION_GUIDE.md`](docs/INTAKE_CLASSIFICATION_GUIDE.md), merge-lane policy is in [`docs/GREEN_YELLOW_RED_MERGE_POLICY.md`](docs/GREEN_YELLOW_RED_MERGE_POLICY.md), the reusable automation phase prompt is in [`docs/AUTOMATION_PHASE_TEMPLATE.md`](docs/AUTOMATION_PHASE_TEMPLATE.md), validation commands are in [`docs/VALIDATION_COMMANDS.md`](docs/VALIDATION_COMMANDS.md), repo-level agent guardrails are in [`AGENTS.md`](AGENTS.md), Microsoft Graph/MCP sequencing is in [`docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md`](docs/MICROSOFT_GRAPH_AND_MCP_STRATEGY.md), Apple open-source platform strategy is in [`docs/research/APPLE_OPEN_SOURCE_PLATFORM_STRATEGY.md`](docs/research/APPLE_OPEN_SOURCE_PLATFORM_STRATEGY.md), and visual-code process is in [`docs/research/VISUAL_CODE_ASSET_STRATEGY.md`](docs/research/VISUAL_CODE_ASSET_STRATEGY.md).

## License

Open source under the [MIT License](LICENSE). This public Review Hub is
intentionally open — it contains public-safe fixtures, proofs, docs, and review
apps, no secrets or protected core implementation. (Protected production-core
implementation details remain in a separate private repository, as described
above.)

## Security

Everything here is public-safe by design and defended in depth: a deterministic,
fail-closed decision core; a CI safety gate (determinism, secret-pattern scan,
spec/Postman coverage, live-integrations gated off by default); CodeQL, gitleaks,
and a CycloneDX SBOM; and real WebAuthn step-up verification (exact-origin +
User-Verification-required). See [SECURITY.md](SECURITY.md) to report a concern.

## Disclaimer

SignalGrid Review Hub is not production-ready, not compliance-certified, and not a replacement for IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM, NAC, or other source systems. Remediation concepts are simulated, constrained, or operator-approved unless separately validated. No current partner certification, partnership, or alliance status is claimed.
