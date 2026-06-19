# Green / Yellow / Red Merge Policy

This policy classifies scoped phase PRs by risk. It supports fast review of safe work while keeping risky work approval-gated.

## GREEN

A PR can be green only when all of these are true:

- Docs only.
- Public-safe fixtures only.
- No workflow changes.
- No proof logic changes.
- No runtime behavior changes.
- All CI is green.
- No Codex P1/P2 comments remain unresolved.
- Unsafe-claim scan is clean.

## YELLOW

A PR is yellow when it includes any of these:

- GitHub Actions changes.
- Proof logic changes.
- Dashboard/UI behavior changes.
- Scripts.
- Fixture model expansion.
- New deterministic decision rules.
- Any change that affects CI, artifacts, or emulator output.

Yellow-lane work requires explicit human approval before merge.

## RED

A PR is red when it includes or enables any of these:

- Live API calls.
- Authentication.
- Secrets.
- Tenant, customer, PHI, or PII data.
- Device actions.
- MDM, PACS, IAM, or source-system writes.
- Remediation outside simulation and approval gates.
- Production, compliance, partnership, replacement, or autonomous-remediation claims.
- Anything that could affect real systems.

Red-lane work requires explicit human approval before implementation and merge. In the public Review Hub, convert red items into public-safe documentation or fixture-backed plans whenever possible.
