# SignalGrid Review Hub Documentation Index

This documentation set explains SignalGrid's public pre-production and post-launch review strategy while keeping the protected core foundation private.

## Core orientation

- [Repository lineage](REPO_LINEAGE.md): explains the public/private repository split and what belongs in each repository.
- [Alpha to public pre-production parity](ALPHA_TO_PUBLIC_PREPROD_PARITY.md): maps DEV Alpha learnings into Review Hub, private core, redesign, deferred, or archive categories.
- [Roadmap to private core](ROADMAP_TO_PRIVATE_CORE.md): defines how validated public concepts move toward protected core implementation.

## Strategy and roadmap

- [SignalGrid real-life simulator](SIGNALGRID_REAL_LIFE_SIMULATOR.md): explains the public-safe deterministic simulator foundation and its runtime trust layers.
- [Operational Trust Orchestration](OPERATIONAL_TRUST_ORCHESTRATION.md): defines the refined category positioning, source-system boundaries, market signal mapping, proof foundation, and public-safe roadmap.
- [SignalGrid app suite plan](SIGNALGRID_APP_SUITE_PLAN.md): defines Operator, Admin, DockBridge, Shared Device Assistant, and Remediation Assistant simulator shells.
- [Simulator event model](SIMULATOR_EVENT_MODEL.md): documents deterministic simulator event types and normalized event shape.
- [Simulator decision engine](SIMULATOR_DECISION_ENGINE.md): documents fixture-based inputs, outputs, rules, and guardrails.
- [Simulator validation runbook](SIMULATOR_VALIDATION_RUNBOOK.md): lists local setup, smoke URLs, expected scenario outputs, and validation commands.
- [Milestone strategy](MILESTONE_STRATEGY.md): uses tags/releases rather than messy repository copies.
- [Mobile and platform strategy](MOBILE_AND_PLATFORM_STRATEGY.md): describes operator mobile, admin companion, PWA, desktop, and endpoint-agent boundaries.
- [Integration catalog](INTEGRATION_CATALOG.md): lists integration categories, first proof direction, and vendor-claim boundaries.
- [Signal Source Catalog](SIGNAL_SOURCE_CATALOG.md): organizes candidate input systems, ownership layers, normalized signal categories, decision impact, and future connector priority.
- [Cloud Connector Emulator Harness](CLOUD_CONNECTOR_EMULATOR_HARNESS.md): documents deterministic cloud connector validation without live vendor access.
- [Connector Emulator Scenarios](CONNECTOR_EMULATOR_SCENARIOS.md): lists synthetic scenario packs, expected outcomes, route owners, and approval gates.
- [Connector Emulator Review Dashboard](CONNECTOR_EMULATOR_REVIEW_DASHBOARD.md): explains the static Review Hub UI for visually inspecting emulator scenarios, decision flow, guardrails, and proof evidence.
- [Intune / Entra posture proof](INTUNE_ENTRA_POSTURE_PROOF.md): defines the first concrete posture-signal proof, normalized model, decision mapping, audit record, and validation checklist.
- [Identity Trust Layer strategy](IDENTITY_TRUST_LAYER_STRATEGY.md): documents IAM/IdP/IGA systems as core SignalGrid signal sources while preserving the Entra ID + Intune first proof.
- [Operational Health / DEX Layer Strategy](OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md): documents endpoint health, API/service health, DEX/user-experience, monitoring, alerting, ITSM routing, remediation-request, and audit-evidence signals as a future SignalGrid layer.
- [Microsoft Graph and MCP strategy](MICROSOFT_GRAPH_AND_MCP_STRATEGY.md): documents Graph / Graph SDK as the first Microsoft identity/posture path and MCP as a later agentic connector direction.
- [Apple Open Source Platform Strategy](APPLE_OPEN_SOURCE_PLATFORM_STRATEGY.md): maps Apple open-source and Apple-participating projects to future SignalGrid Apple platform directions without adding implementation code.
- [Microsoft Graph PC test gate](MICROSOFT_GRAPH_PC_TEST_GATE.md): defines the local-only gate for a future read-only sandbox smoke test without adding live Graph calls to Review Hub CI.
- [Microsoft Graph live smoke test runbook](MICROSOFT_GRAPH_LIVE_SMOKE_TEST_RUNBOOK.md): documents the PC-only procedure, sanitization rules, non-goals, and follow-up PR boundary for future live read-only testing.
- [Frontline context signals roadmap](FRONTLINE_CONTEXT_SIGNALS.md): captures future healthcare/frontline context inputs while preserving the Intune / Entra first-proof sequence.
- [Kontakt.io / RTLS integration notes](KONTAKT_RTLS_INTEGRATION_NOTES.md): documents a future RTLS/location/staff-safety candidate path, fixture-proof boundary, source-system ownership, and guardrails.
- [Agentic connector strategy](AGENTIC_CONNECTOR_STRATEGY.md): documents future MCP-style connector and governed agentic-operations direction without claiming production readiness or partnerships.
- [Visual-code asset strategy](VISUAL_CODE_ASSET_STRATEGY.md): defines how diagrams, Review Hub visuals, and public graphics should remain source-controlled visual code where practical.
- [Ecosystem positioning](ECOSYSTEM_POSITIONING.md): explains where SignalGrid fits relative to IAM, IGA, UEM/MDM, healthcare access, ITSM, SIEM/SOAR, NAC, endpoint telemetry, and dock/edge systems.
- [DockBridge strategy](DOCKBRIDGE_STRATEGY.md): documents future edge/dock event orchestration for shared-device workflows.
- [Hardware partner matrix](HARDWARE_PARTNER_MATRIX.md): maps public-safe candidate hardware categories for Physical Custody, DockBridge, and shared-device trust signals.
- [Beam Mobile partner-candidate brief](BEAM_MOBILE_PARTNER_CANDIDATE_BRIEF.md): frames Beam Mobile as a candidate healthcare shared iPhone/iPad case, battery, charging, and dock layer without claiming partnership or endorsement.
- [Physical Custody signal model](PHYSICAL_CUSTODY_SIGNAL_MODEL.md): defines a vendor-neutral fixture schema and custody decision examples for future DockBridge proof work.
- [Credential Reader Signal Model](CREDENTIAL_READER_SIGNAL_MODEL.md): defines public-safe badge, credential-reader, mobile credential-event, smart-locker, identity-correlation, and custody-correlation signal semantics.
- [Smart Locker Identity & Custody Model](SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md): documents fixture-backed locker, kiosk, dock, bay-assignment, and custody workflow patterns.
- [Configuration/profile orchestration strategy](CONFIG_PROFILE_ORCHESTRATION_STRATEGY.md): outlines AI-assisted remediation scaffolding with approval, validation, test ring, and rollback guardrails.
- [Partner and alliance strategy](PARTNER_AND_ALLIANCE_STRATEGY.md): frames ecosystem paths without claiming current partnerships or certifications.
- [Production path](PRODUCTION_PATH.md): defines conservative gates from public strategy to private-core proof and eventual production readiness.

## Review workflow

- [Repository agent instructions](../AGENTS.md): defines Codex guardrails, public-safety rules, PR validation commands, and review guidelines.
- [Phase Automation Orchestrator](PHASE_AUTOMATION_ORCHESTRATOR.md): defines the input → classify → backlog → scoped PR → validation → review → merge-lane loop.
- [Phase Backlog](PHASE_BACKLOG.md): tracks seeded and future scoped phases, classifications, risk lanes, dependencies, and validation.
- [Intake Classification Guide](INTAKE_CLASSIFICATION_GUIDE.md): classifies new inputs into product, signal, connector, UI, proof, automation, platform, maintenance, blocked, or parking-lot categories.
- [Green / Yellow / Red Merge Policy](GREEN_YELLOW_RED_MERGE_POLICY.md): defines green, yellow, and red merge lanes and approval expectations.
- [Automation Phase Template](AUTOMATION_PHASE_TEMPLATE.md): provides the reusable Codex prompt for one scoped phase at a time.
- [Manual full-product smoke screen](MANUAL_FULL_PRODUCT_SMOKE_SCREEN.md): outlines future manual Review Hub smoke-screen steps and pass/fail notes.
- [Mobile-first Codex workflow](MOBILE_CODEX_WORKFLOW.md): explains the iPhone-first Codex Web → PR → CI → review → GitHub Mobile merge loop.
- [Codex task template](CODEX_TASK_TEMPLATE.md): provides a reusable prompt structure for focused Cloud Codex tasks.
- [Validation commands](VALIDATION_COMMANDS.md): lists the standard install, typecheck, build, proof, unsafe-claim scan, and diff hygiene commands.
- [CI and validation](CI_AND_VALIDATION.md): explains Review Hub CI, required local checks, docs sanity checks, and future branch-protection expectations.
- [Review checklist](REVIEW_CHECKLIST.md): questions for reviewers, design partners, and advisors.
