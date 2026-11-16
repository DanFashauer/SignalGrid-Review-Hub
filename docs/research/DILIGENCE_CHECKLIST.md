# Diligence Checklist

Use this checklist for strategic partner, design partner, investor, or potential acquirer conversations. Keep the packet public-safe and avoid production, compliance, partnership, acquisition, legal, valuation, or financial guarantee claims.

## Product proof assets

- Review Hub documentation map.
- Connector Emulator Dashboard (a `demo_only` surface per `scripts/launch-profile.mjs` — never presented as shipping product).
- Credential Reader / Smart Locker Dashboard narrative (`pacs-access` / `custody-beacon` — deferred families; design target, not Limited GA).
- Connector Emulator Smoke evidence (from that same `demo_only` surface).
- Autopilot Control Plane.
- Strategic Buyer / Partner Pitch Pack — superseded 2026-09-06, do not send; provenance only.
- Pitch Execution Pack — superseded 2026-09-06, do not send; provenance only.
- Deterministic, fixture-backed proof commands (`proof:*` in `package.json`) for simulator, posture, grid, Microsoft Graph sandbox, and connector emulator validation.

## Docs to send

- `docs/EXECUTIVE_ONE_PAGER.md`.
- `docs/research/PITCH_EXECUTION_PACK.md` — superseded 2026-09-06; do not send. Sequence a conversation with `docs/outreach/OPERATING_RULES.md` and `docs/outreach/TARGETS_CRITERIA.md` instead.
- `docs/research/OUTREACH_EMAIL_TEMPLATES.md` — superseded 2026-08-23; do not send. The live drafts are `docs/outreach/TEMPLATES.md`.
- `docs/research/FIRST_CALL_TALK_TRACK.md` — superseded 2026-08-23; do not send. Call preparation follows `docs/outreach/OPERATING_RULES.md`.
- `docs/DEMO_SCRIPT_FOR_PARTNERS.md` for demo alignment.
- `docs/research/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md` — superseded 2026-09-06; do not send. Provenance only.
- `docs/research/BUYER_PARTNER_READINESS_PACK.md`.
- `docs/research/FOUNDER_CONTROL_REQUIREMENTS.md` when founder-control expectations are relevant.
- `docs/research/REAL_WORLD_TESTING_READINESS_PLAN.md` when staged validation is relevant.

## Questions to ask partner/acquirer

- Which shared, mobile, custody, or frontline workflow is most painful today?
- Which systems are the systems of record for identity, device posture, custody, workflow, and audit evidence?
- Which signals can be reviewed safely in a private sandbox without customer data, PHI, PII, or production access?
- Which approval gates are mandatory before any operational action?
- What evidence would make the orchestration model credible without claiming replacement of existing systems?
- Which stakeholders should review product, security, partnership, and technical validation boundaries?

## Technical validation next steps

- Confirm a private/sandbox boundary before any live integration work.
- Define read-only fixture-to-sandbox mapping for the first signal category.
- Identify safe sample events and sanitization requirements.
- Keep high-risk actions simulated or approval-required.
- Define proof commands or evidence artifacts for the private validation step.
- Record non-goals, prohibited data, and rollback/stop conditions before testing.

## Business/role/control terms to clarify

- Whether the path is design partnership, strategic partnership, OEM/embedded collaboration, investment, acquisition with founder/product leadership, or another structure.
- What founder CEO, product, or creative-control role would be preserved.
- Which product direction and public-safety guardrails are non-negotiable.
- Which customer, distribution, support, security, and validation responsibilities would sit with each party.
- Which terms require legal, financial, or advisor review outside this public Review Hub.

## Guardrails

SignalGrid Review Hub is not production-ready, not compliance-certified, not a current vendor partnership, and not a replacement for IAM, MDM, UEM, PACS, SIEM, ITSM, credential-reader, locker, or other systems of record. It does not claim autonomous production remediation. Public proof is deterministic and fixture-backed; live open-source proof (Fleet, Keycloak, RADIUS/NAC) exists in the lab — see DR-013 in `docs/DECISION_RECORDS.md`, `docs/FLEET_LIVE_INTEGRATION.md`, `docs/KEYCLOAK_LIVE_INTEGRATION.md` and `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`. Paid-platform integrations require separate private/sandbox validation, owner approval, and safe test boundaries.
