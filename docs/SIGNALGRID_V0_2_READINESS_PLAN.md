# SignalGrid v0.2 Investor / Design-Partner Readiness Plan

## Product reality statement

A repository build is not enough to make SignalGrid real. The current public Review Hub is useful because it demonstrates deterministic proof, synthetic connector evidence, dashboards, and guardrails, but those assets are not production software and do not prove customer deployment readiness.

SignalGrid v0.2 becomes credible when it narrows from broad demo coverage to one product foundation:

- one painful workflow: frontline or shared-device app access that cannot rely on identity alone;
- one trusted decision loop: `allow`, `step-up`, `restrict`, or `deny` before the workflow continues;
- one real connector path: Microsoft Entra ID plus Microsoft Intune, starting sandbox/mock and read-only;
- one secure tenant model: tenant-scoped data, authorization, audit, and public-safe demo mode;
- one pilot/customer story: a design-partner workflow with explicit success criteria;
- one investor narrative: an operational trust control plane for frontline, shared-device, and mobile workflows.

Core product question: **Should this identity, on this device, in this workflow, in this context, be allowed to continue right now?** Every decision must eventually explain why it happened, which signals were used, which policy version applied, what system supplied evidence, what action was taken, and who or what can review it later.

## Reality stages

| Stage | Goal | Required assets | Current status | Gaps | Go/no-go criteria |
| --- | --- | --- | --- | --- | --- |
| Stage 1 — Functional alpha | Prove the loop with deterministic fixtures and public-safe Review Hub flows. | Simulator fixtures, proof commands, review dashboards, synthetic Microsoft posture evidence, public-safety guardrails. | Largely present in Review Hub through fixture-backed proof assets and Level 10 packaging. | Product-shaped auth, durable persistence, tenant-aware routes, and real connector scaffolding are not implemented here. | Go when deterministic proofs pass and docs state synthetic boundaries; no-go if unsafe claims or live integration assumptions appear. |
| Stage 2 — Investor/design-partner ready | Show a focused v0.2 build path around one frontline/shared-device workflow and one Microsoft connector path. | This plan, epic backlog, Microsoft connector first path, tenant/security plan, pilot criteria, investor/design-partner package checklist. | This PR establishes the roadmap/control plan only. | Engineering implementation, design-partner validation, and real sandbox testing remain future work. | Go when the owner can explain the wedge, decision loop, security model, and pilot path without claiming production readiness. |
| Stage 3 — Paid pilot ready | Validate the first customer sandbox workflow with read-only connector evidence and tenant isolation tests. | Real auth, tenant isolation tests, read-only customer sandbox connector, secret handling, durable audit, backup/restore plan, incident response plan, pilot agreement, privacy/security docs. | Not ready in the public Review Hub. | Customer sandbox, private credentials, contractual boundaries, operational support, and security reviews. | Go only after private-context approval, sandbox-only read access, tenant isolation proof, and clear success criteria; no-go if secrets or customer data would enter this public repo. |
| Stage 4 — Production SaaS ready | Operate a secure, supportable SaaS service for multiple tenants. | Production auth, hardened authorization, production data model, monitored connector jobs, durable ledger, deployment runbooks, incident response, support process, privacy/security program. | Future target, not claimed. | Most production controls, compliance program work, scaling, SRE, legal, support, billing, and customer operations. | Go only after owner-approved production architecture, independent security review, operational runbooks, and production readiness gates; no-go for unsupported compliance, certification, partnership, replacement, or autonomous remediation claims. |

## Product architecture target

- **Frontend apps:** Operator web app for dashboard, decisions, signals, policies, integrations, audit, and settings; public demo mode remains fixture-backed.
- **API layer:** Tenant-aware application routes, input validation, rate limiting, request IDs, PII-safe logs, and consistent authorization checks.
- **Data layer:** Tenant-scoped operational tables, normalized signal snapshots, policy versions, decision records, audit events, connector health records, and immutable evidence references where appropriate.
- **Connector layer:** Microsoft Entra ID and Intune read-only connector path first, using sandbox/mock fixtures before any private live read-only testing.
- **Decision layer:** Versioned policy evaluation that returns `allow`, `step-up`, `restrict`, or `deny` with matched rules and evidence snapshots.
- **Audit/evidence layer:** Durable decision and action history that records source systems, policy version, actor/system, inputs, outcome, reviewability, and replay references.
- **Operations layer:** Health checks, connector run status, job history, deployment runbook, incident response hooks, backup/restore expectations, and validation gates.

## Reality guardrails

- Current proof remains synthetic and fixture-backed.
- This PR does not add live integrations, credentials, tenant data, customer data, PHI, PII, or production deployment logic.
- SignalGrid is framed as a normalization, decision, routing, audit, and verification layer; existing enterprise systems remain systems of record.
- High-risk actions remain simulated or approval-required.
- The merge lane for this docs/backlog plan is **GREEN**.

## Next recommended engineering phase

After inspecting the current Review Hub state, the recommended next engineering phase is **Production-shaped tenant/auth scaffold** before Microsoft connector sandbox scaffold.

Reason: the repository already has Microsoft-oriented synthetic proof and connector emulator evidence, but the first product risk for v0.2 is whether every future decision, signal, policy, connector run, and audit event is scoped to a tenant and protected by explicit authorization. Building a tenant/auth scaffold first reduces the risk that a future connector path creates data without a safe tenancy boundary.

Do not implement this engineering phase in this PR.
