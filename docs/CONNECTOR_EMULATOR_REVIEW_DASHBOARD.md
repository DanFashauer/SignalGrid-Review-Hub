# Connector Emulator Review Dashboard

The Connector Emulator Review Dashboard is a static Review Hub UI section for visually inspecting the cloud connector emulator harness without local PC setup, a hosted runtime, live vendor accounts, enterprise licenses, or privileged credentials.

## What reviewers can inspect

The dashboard summarizes the synthetic connector scenarios from `fixtures/connectors/emulator` and presents:

- Scenario title, group, and covered domains.
- Expected decision: `allowCandidate`, `deny`, `restrict`, `stepUp`, or `approvalRequired`.
- Deterministic reason code.
- Route owner category, severity, destination placeholder, and verification expectation.
- Approval-gate and simulated-first status for high-risk remediation cases.
- A simple decision flow: signals → evaluation → decision → route → verification.
- Guardrail indicators for unsafe-allow prevention, approval requirements, route ownership, and verification expectations.
- Evidence metadata for `pnpm run proof:connector-emulator`, the **Connector Emulator Smoke** workflow, the `connector-emulator-results` artifact, and the deterministic proof hash.

## Public-safety boundaries

The dashboard is synthetic and fixture-backed only. It does not make live API calls, does not authenticate to vendor systems, and does not include secrets, tenant IDs, client IDs, customer data, PHI, or PII.

The dashboard is not live integration evidence, not production-ready, not compliance certification, not a vendor partnership, does not replace systems of record, and does not demonstrate autonomous production remediation.

## Reviewer workflow

1. Open the Review Hub UI.
2. Navigate to **Connector Emulator**.
3. Review the scenario cards, decision colors, owner routes, and verification expectations.
4. Compare the evidence panel with the latest `pnpm run proof:connector-emulator` output or the **Connector Emulator Smoke** GitHub Actions run artifact.
5. Treat the dashboard as review evidence for deterministic public-safe behavior, not as live integration proof.

## Validation command

```bash
pnpm run proof:connector-emulator
```

The proof writes sanitized results to `artifacts/connector-emulator/results.json` and emits a deterministic hash for review comparison.
