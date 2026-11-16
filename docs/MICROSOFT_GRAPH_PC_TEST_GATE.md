# Microsoft Graph PC Test Gate

## Purpose

This gate prepares a PC-only path for validating a read-only Microsoft Graph sandbox connection later. It bridges the current fixture-backed Microsoft Graph proof toward a controlled local smoke test without adding live authentication, secrets, tenant identifiers, client identifiers, or live responses to Review Hub.

The gate exists so a future PC session can follow a documented checklist instead of improvising with Microsoft Graph, Entra, or Intune-style data.

## Current state

Review Hub currently includes a public-safe Microsoft Graph sandbox proof with:

- A fixture-backed Microsoft Graph signal model.
- Deterministic fake fixtures under `fixtures/microsoft-graph/`.
- `pnpm run proof:microsoft-graph-sandbox` for local deterministic validation.
- No live Microsoft Graph calls.
- No committed credentials, tokens, tenant IDs, client IDs, customer data, PHI, or PII.

## PC-only gate rule

Live Microsoft Graph testing must happen only on a local PC or similarly private operator-controlled environment with local `.env` values that are never committed.

Do not commit:

- Secrets.
- Tenant IDs.
- Client IDs.
- Tokens.
- Live responses.
- Logs containing tenant data.
- Screenshots containing tenant data.
- Customer, patient, employee, or user-identifying data.

Review Hub CI must remain fixture-backed and must not run live authentication or real Microsoft Graph calls.

## Read-only first scope

The first PC-only smoke test may only verify that:

1. Authentication succeeds against a sandbox tenant.
2. Least-privilege read-only scopes are present.
3. Microsoft Graph API health can be checked.
4. One or more safe, non-sensitive device or user posture fields can be read from a sandbox tenant.
5. Responses can be sanitized into deterministic fixture format compatible with the existing proof model.

The smoke test must not perform write actions.

## Explicit non-goals

This gate does not authorize or implement:

- Intune policy changes.
- Device lock, wipe, quarantine, or remote action.
- Account disablement.
- Conditional Access changes.
- App deployment.
- Intune template import.
- Live remediation.
- Production tenant use.
- Production-ready, compliance, certification, partnership, replacement, or autonomous-remediation claims.

## Go/no-go checklist

Before any live PC-only smoke test, confirm:

- [ ] Sandbox tenant only.
- [ ] Least-privilege read-only permissions only.
- [ ] No write permissions granted.
- [ ] Local `.env` only.
- [ ] No customer data.
- [ ] No production data.
- [ ] No screenshots with tenant data.
- [ ] No logs committed.
- [ ] Saved output is sanitized by inspection: no tenant IDs, UPNs, device serials or object IDs appear in the saved fixture. (Sanitization is not a switch — `docs/MICROSOFT_GRAPH_LIVE_SMOKE_TEST_RUNBOOK.md` records the removed variable; until 2026-09-06 this box read "Sanitized output is enabled", a control nothing implemented.)
- [ ] Output maps back to deterministic fixture shape before it is considered for a follow-up PR.

## Expected sanitized output targets

A successful local run should produce sanitized fixture-style output matching the shape of:

- `fixtures/microsoft-graph/identity-device-posture.json`.
- `fixtures/microsoft-graph/graph-api-health.json`.

Only sanitized fixture updates may be proposed later.

## After the PC test

If the PC-only smoke test succeeds, create a follow-up PR containing only:

- Sanitized fixture updates.
- Proof updates if the deterministic fixture shape needs to change.
- Runbook notes describing what was validated without exposing live identifiers.

Do not include secrets, tenant IDs, client IDs, object IDs, tokens, live responses, logs, screenshots with tenant data, or private environment values.
