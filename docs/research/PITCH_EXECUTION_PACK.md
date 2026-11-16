# Pitch Execution Pack

> **SUPERSEDED 2026-09-06 — do not send from this file.**
> The live outreach surface is `docs/outreach/` (claim-scanned on every push). This pack's
> whole subject was converting `docs/research/STRATEGIC_BUYER_PARTNER_PITCH_PACK.md` (itself
> superseded 2026-09-06) into outbound material, and it routed the reader in the present tense
> to two further superseded send surfaces (`OUTREACH_EMAIL_TEMPLATES.md` and
> `FIRST_CALL_TALK_TRACK.md`, both superseded 2026-08-23); kept for provenance only.
> `scripts/check-send-copy-banner.mjs` holds the rule.
> Dated record: until 2026-09-06 this pack listed those three documents as things to send and
> run, called the Connector Emulator Dashboard (a `demo_only` surface) and the credential-reader /
> smart-locker narrative (deferred families) a "validated asset boundary" with no status word,
> and said "current proof is synthetic and fixture-backed" — the sentence DR-013 retired.
> Those lines were rewritten that day; the entries below now name the live equivalents.

This pack converted the merged Strategic Buyer / Partner Pitch Pack (superseded 2026-09-06) into outbound-ready, public-safe materials. It is designed for factual first conversations, partner design reviews, and diligence preparation without adding production, compliance, partnership, acquisition, valuation, legal, or financial claims.

## Pack contents

- [Executive One-Pager](../EXECUTIVE_ONE_PAGER.md): concise buyer-facing summary.
- [Outreach Email Templates](OUTREACH_EMAIL_TEMPLATES.md): **superseded 2026-08-23 — do not send from that file**; the live drafts are [`docs/outreach/TEMPLATES.md`](../outreach/TEMPLATES.md).
- [First-Call Talk Track](FIRST_CALL_TALK_TRACK.md): **superseded 2026-08-23 — do not send from that file**; the live call rules are [`docs/outreach/OPERATING_RULES.md`](../outreach/OPERATING_RULES.md) and the target criteria [`docs/outreach/TARGETS_CRITERIA.md`](../outreach/TARGETS_CRITERIA.md).
- [Demo Script for Partners](../DEMO_SCRIPT_FOR_PARTNERS.md): walkthrough using only current validated Review Hub assets.
- [Diligence Checklist](DILIGENCE_CHECKLIST.md): assets, send list, questions, validation next steps, and control terms.

## Intended use

Use this pack to prepare one scoped conversation at a time:

1. Choose the audience category.
2. Use the matching outreach template from `docs/outreach/TEMPLATES.md` (the templates this pack once pointed at are superseded).
3. Send only public-safe docs that fit the audience.
4. Run the call under `docs/outreach/OPERATING_RULES.md` (the first-call talk track this pack once pointed at is superseded).
5. Demo only validated assets.
6. Record follow-up questions and classify them into the phase backlog before creating new work.

## Current validated asset boundary

The demo and diligence flow may reference the Review Hub, the Connector Emulator Dashboard (a `demo_only` surface per `scripts/launch-profile.mjs` — never presented as shipping product), the Credential Reader / Smart Locker Dashboard narrative (`pacs-access` / `custody-beacon` — deferred families, design targets, not Limited GA), Connector Emulator Smoke evidence (from that same `demo_only` surface), the Autopilot Control Plane, and the Strategic Buyer / Partner Pitch Pack (superseded 2026-09-06 — do not send). These are public-safe assets backed by deterministic fixtures and documentation; the status words are the boundary.

## Guardrails

This pack explicitly does not claim:

- Production readiness.
- Compliance certification, attestation, or regulatory approval.
- Current vendor partnership, alliance, marketplace certification, or endorsement.
- Replacement of IAM, MDM, UEM, PACS, SIEM, ITSM, credential-reader, locker, or other systems of record.
- Autonomous production remediation.
- Live integrations, real Microsoft Graph calls, real vendor API calls, customer data, tenant data, PHI, PII, secrets, or credentials.
- Valuation, legal, financial, acquisition, investment, revenue, or exit guarantees.

Public proof is deterministic and fixture-backed; live open-source proof (Fleet, Keycloak, RADIUS/NAC) exists in the lab — see DR-013 in `docs/DECISION_RECORDS.md`, `docs/FLEET_LIVE_INTEGRATION.md`, `docs/KEYCLOAK_LIVE_INTEGRATION.md` and `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`. Paid-platform integrations require separate private/sandbox validation, owner approval, safe test boundaries, and public-safety review before they are described as supported.

## Merge lane

This is a GREEN docs-only pitch execution phase as long as it changes documentation only and does not add scripts, workflows, dashboards, fixtures, live integrations, auth, customer data, PHI/PII, financial promises, valuation claims, legal claims, production readiness claims, certification claims, partnership claims, or acquisition claims.

## Level 10 execution addendum

For the Level 10 Autopilot Completion Program, use the executive one-pager, the live `docs/outreach/TEMPLATES.md` drafts (the founder, strategic-partner, design-partner and investor/acquirer emails and the first-call talk track this line once named are superseded — see the banner), the partner demo script, the diligence checklist, founder-control preference, partner/acquirer questions, and the what-not-to-claim guardrails as the default pitch sequence. Keep all outreach public-safe and evidence-backed.
