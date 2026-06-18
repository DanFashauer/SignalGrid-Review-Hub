# Cloud Connector Emulator Harness

The Cloud Connector Emulator Harness validates SignalGrid connector semantics without live vendor access. It is a deterministic, fixture-backed proof surface for reviewers who do not have Microsoft Intune, Jamf, ServiceNow, PagerDuty, Beam, Cisco, or other enterprise accounts available.

## Purpose

The harness answers whether SignalGrid can normalize connector-shaped signals, make safe candidate decisions, route ownership, preserve audit evidence, and verify deterministic behavior in CI. It does not test real Microsoft Graph tenant behavior and does not make live vendor calls.

## Emulator layers

Scenario packs cover these public-safe layers:

- Microsoft Graph / Intune-shaped posture signals.
- IAM / IGA-shaped identity governance signals.
- MDM / MAM-shaped app and device signals.
- ServiceNow/Jira/PagerDuty-style workflow routing signals.
- Physical custody / DockBridge-style signals.
- Network trust / Cisco ACI-style zone and segmentation signals.
- Security / EDR-style risk signals.

## Proof behavior

Run `pnpm run proof:connector-emulator` to load every fixture in `fixtures/connectors/emulator`, evaluate deterministic trust decisions, and write sanitized proof output to `artifacts/connector-emulator/results.json`.

The proof verifies that:

- Unsafe allow outcomes are not produced for degraded or unknown API health.
- High-risk remediation remains `approvalRequired=true` and simulated first.
- Every route includes `ownerCategory`, `severity`, `destinationPlaceholder`, and `verificationExpectation`.
- Output is stable enough to hash for review evidence.

## Mobile-first GitHub Actions usage

No local PC or Replit instance is required:

1. Open GitHub Mobile or GitHub web.
2. Go to **Actions**.
3. Run **Connector Emulator Smoke**.
4. Select a scenario group, or leave `all` selected.
5. Review the workflow result.
6. Download the `connector-emulator-results` artifact as sanitized evidence.

A future Replit UI may visualize the same deterministic scenarios, but Replit is not required for validation.

## Public-safety boundaries

Emulator output is synthetic. It is not production-ready, not a compliance certification, not a vendor partnership, not live integration evidence, not proof that SignalGrid replaces systems of record, and not autonomous production remediation. Existing enterprise systems remain systems of record.
