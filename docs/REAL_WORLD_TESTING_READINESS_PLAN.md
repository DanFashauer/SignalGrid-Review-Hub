# Real-World Testing Readiness Plan

This plan defines staged readiness without adding live testing implementation.

| Stage | What gets tested | Allowed data | Blocked | Success criteria | Owner approval |
| --- | --- | --- | --- | --- | --- |
| Stage 0: synthetic proof and dashboards | Deterministic fixtures, simulator proofs, dashboards, docs | Public-safe synthetic fixtures | Live vendor calls, tenant data, customer data, PHI/PII | Proofs pass and dashboards explain expected outcomes | Required for merge readiness only |
| Stage 1: internal GitHub Actions smoke evidence | CI, proof harnesses, smoke workflows, artifacts | Repository fixtures and generated reports | External secrets and live integrations | Workflow artifacts are uploaded and reviewable | Required for YELLOW workflow changes |
| Stage 2: local mocked end-to-end demo | Mocked signal flow across identity, device, custody, network, and workflow | Local synthetic records | Real source-system writes or device actions | Demo can be repeated from documented commands | Required before demo expansion |
| Stage 3: sandbox tenant / lab environment | Read-only sandbox signals and sanitized lab posture | Lab-only synthetic or approved sandbox data | Production tenants, customer records, PHI/PII, writes | Read-only signal collection is verified and sanitized | Explicit owner approval required |
| Stage 4: design partner dry run | Design-partner walkthrough and non-production workflow review | Sanitized examples approved for review | Production remediation, unsupported claims | Partner feedback is captured without live-risk exposure | Explicit owner approval required |
| Stage 5: limited pilot | Narrow approved pilot criteria and audit expectations | Approved pilot data under separate private controls | Blind auto-remediation, unapproved system writes, broad rollout | Pilot criteria, rollback, audit, and owner sign-off are defined | Explicit owner approval required |
