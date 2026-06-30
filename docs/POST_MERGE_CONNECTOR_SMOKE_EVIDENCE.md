# Post-Merge Connector Smoke Evidence Automation

This phase makes routine Connector Emulator Smoke evidence collection automatic after merges to `SignalGrid_Alpha`.

## Classification

- Phase type: workflow automation / smoke evidence automation
- Risk lane: YELLOW
- Reason: the change updates GitHub Actions workflow behavior while keeping the proof harness deterministic and fixture-backed.

## Automated trigger

`Connector Emulator Smoke` now runs on every push to `SignalGrid_Alpha`. A merged pull request creates that push event, so routine post-merge evidence no longer depends on a repository owner manually starting `workflow_dispatch`.

The manual path remains available for targeted checks. Manual runs preserve the selected `scenarioGroup` input. Push-triggered runs default to `all`.

## Evidence artifacts

Each successful run uploads two artifacts:

| Artifact | Path | Purpose |
| --- | --- | --- |
| `connector-emulator-results` | `artifacts/connector-emulator/results.json` | Sanitized deterministic connector emulator proof output. |
| `connector-emulator-smoke-evidence` | `artifacts/connector-emulator/evidence.json` | Small workflow evidence manifest for post-merge review. |

The evidence manifest records:

- workflow name
- run ID
- run attempt
- event name
- branch
- head SHA
- scenario group
- connector emulator result artifact name
- evidence artifact name
- proof command
- public-safety posture

The manifest intentionally omits live credentials, tenant IDs, customer data, PHI/PII, live API results, and production integration details.

## Public-safety posture

This automation runs the existing deterministic connector emulator proof and existing proof suite only. It does not add live integrations, live Microsoft Graph calls, authentication, secrets, tenant IDs, customer data, PHI/PII, device actions, autonomous remediation, or production-readiness claims.

## Review usage

After a merge to `SignalGrid_Alpha`, reviewers can inspect the resulting `Connector Emulator Smoke` run and download:

1. `connector-emulator-results` for deterministic proof output.
2. `connector-emulator-smoke-evidence` for workflow metadata tying the evidence to the run, branch, SHA, and scenario group.

A later docs-only evidence PR can cite the GitHub-generated run and artifact metadata without requiring a separate manual workflow dispatch step.
