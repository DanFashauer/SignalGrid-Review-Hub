# Pilot Readiness Criteria

A paid pilot should not start merely because Review Hub builds or demos run. It requires private-context controls and explicit owner approval.

## Required checklist

- Real auth is implemented in the private/customer-appropriate context.
- Tenant isolation tests pass, including cross-tenant negative tests.
- Read-only Microsoft connector runs against a customer-approved sandbox or test tenant only.
- Secret handling uses managed storage and never commits credentials.
- Durable audit records decision evidence, source system, policy version, action, actor/system, and review path.
- Backup and restore expectations are documented and tested for pilot data.
- Incident response contacts, severity levels, and escalation paths are defined.
- Pilot agreement and scope boundaries are in place.
- Privacy and security documents are reviewed for the pilot context.
- Customer success criteria are written before pilot start.

## Customer success criteria examples

- Operators can see why a shared-device workflow was allowed, stepped up, restricted, or denied.
- Microsoft posture evidence is fresh enough for the agreed workflow.
- Audit records are reviewable by the agreed customer role.
- False-positive, false-negative, and operator-escalation handling are tracked.
- No write/remediation action occurs without explicit approval and separate scope.
