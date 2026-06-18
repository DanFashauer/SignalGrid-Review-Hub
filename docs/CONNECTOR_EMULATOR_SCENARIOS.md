# Connector Emulator Scenarios

The connector emulator scenario packs are synthetic, deterministic fixtures for cloud-first validation.

## Included scenarios

- Healthy identity + compliant device + healthy API = `allowCandidate` with audit evidence only.
- Disabled identity + active session = `deny` and route identity owner.
- Compliant device + degraded Graph health = `stepUp` and route integration owner.
- Noncompliant device + clinical workflow = `restrict` and route UEM owner.
- Missing MAM policy + sensitive app = `restrict` and route app owner.
- Wrong custody zone + shared device = `restrict` and custody alert.
- Network zone mismatch + high-risk app = `stepUp` and route network owner.
- Remediation proposed = `approvalRequired` and simulated first.

## Scenario groups

- `microsoftGraphPosture`
- `workflowRouting`
- `physicalCustody`
- `networkTrust`

Each route must include an owner category, severity, destination placeholder, and verification expectation so reviewers can see who would own the next action without relying on live systems.
