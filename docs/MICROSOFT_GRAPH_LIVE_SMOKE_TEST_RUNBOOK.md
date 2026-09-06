# Microsoft Graph Live Smoke Test Runbook

## Purpose

This runbook documents the future local-only, PC-only procedure for a read-only Microsoft Graph sandbox smoke test. It is a scaffold only: Review Hub does not run live authentication, does not call Microsoft Graph in CI, and does not store live credentials or tenant data.

## Operator boundary

Run this only from a private local PC environment when a sandbox tenant is available. Do not run it from Review Hub CI, public preview environments, shared machines, or mobile-only automation sessions.

## Required local configuration

Store live sandbox credentials outside the repository whenever possible. If an operator must keep a local environment file in the repo root for a PC-only smoke test, use only an explicitly ignored filename such as `.signalgrid.local.env` or `.microsoft-graph-smoke.local.env`; `.env`, `.env.local`, and `.env.*.local` are also ignored as a defensive guardrail. Use the placeholders documented in `docs/env/MICROSOFT_GRAPH_ENV_EXAMPLE.md`.

Required placeholder names:

- `GRAPH_TENANT_ID_PLACEHOLDER`
- `GRAPH_CLIENT_ID_PLACEHOLDER`
- `GRAPH_AUTH_MODE_PLACEHOLDER`
- `GRAPH_SCOPE_PLACEHOLDER`

(A fifth line, `SIGNALGRID_SANITIZE_OUTPUT` set to true, stood here until 2026-09-06. Nothing reads it — sanitization of generated output is not a switch, and a variable nothing reads is a control that does not exist. See `docs/env/MICROSOFT_GRAPH_ENV_EXAMPLE.md`.)

Use sandbox values only. Never commit any local env file or copied values from it. Before staging changes, run `git status --short --ignored` and confirm any local Graph env file is ignored rather than listed as an untracked committable file.

## Read-only smoke-test sequence

1. Confirm the tenant is a sandbox tenant and contains no customer, patient, production, or private employee data intended for publication.
2. Confirm the app registration or auth path has least-privilege read-only permissions only.
3. Confirm no write-capable Microsoft Graph, Intune, device action, app deployment, Conditional Access, account-management, or remediation permissions are present.
4. Authenticate locally.
5. Check Microsoft Graph API health or availability using a safe read-only path.
6. Read only safe, non-sensitive posture fields from one or more sandbox records.
7. Sanitize the response before saving any output.
8. Convert the sanitized response into deterministic fixture-style records.
9. Compare the sanitized output shape with:
   - `fixtures/microsoft-graph/identity-device-posture.json`
   - `fixtures/microsoft-graph/graph-api-health.json`
10. Discard raw live output after verification.

## Sanitization rules

Before any output is committed or shared, remove:

- Tenant IDs.
- User principal names.
- Emails.
- Phone numbers.
- Device serial numbers.
- IMEI, MEID, and ICCID values.
- Object IDs.
- Any other stable live identifier.

Replace all identifiers with fixture IDs and preserve only normalized posture categories such as compliance state, registration category, management category, health category, freshness category, and permission/health status.

## Allowed output shape

The only acceptable follow-up artifact is deterministic, sanitized fixture-style output that mirrors the existing Microsoft Graph sandbox fixtures. Use fixture identifiers such as `fixture-user-001`, `fixture-device-001`, or similarly fake values rather than live identifiers.

## Non-goals and blocked actions

Do not perform or test:

- Intune policy changes.
- Device lock, wipe, quarantine, retire, delete, or remote action.
- Account disablement.
- Conditional Access changes.
- App deployment.
- Intune template import.
- Live remediation.
- Production tenant access.
- Production readiness, compliance, certification, partnership, replacement, or autonomous-remediation claims.

## Follow-up PR rule

After a successful PC-only test, the follow-up PR may include only sanitized fixture updates, deterministic proof updates if needed, and runbook notes. It must not include raw logs, live responses, screenshots with tenant data, `.env` files, secrets, tenant IDs, client IDs, object IDs, UPNs, emails, phone numbers, serial numbers, IMEI, MEID, or ICCID values.

## Signal-source parking lot

Future signal-source catalog work should organize candidate signal owners and decision impact for:

- Autopilot provisioning state.
- Intune MDM/MAM state.
- PowerShell detection/remediation patterns as approval-gated future actions.
- Microsoft 365 admin and service-health portals.
- IAM/IGA access governance.
- Network policy and fabric systems such as Cisco ACI, Cisco, and Arista.
- IT role and ownership routing.

This parking lot does not implement integrations, live calls, remediation, or write actions.
