# SignalGrid v0.2 Epic Backlog

> ## ⛔ ARCHIVED 2026-08-15 — frozen record, not a queue
>
> Untouched since the repository's root commit. Most of these epics were since built
> (under different names) or deliberately superseded; none of the statuses here can be
> trusted as current. **The live work queue is [BUILD_BACKLOG](BUILD_BACKLOG.md); the
> live scope authority is [LAUNCH_PROFILE](LAUNCH_PROFILE.md).** Nothing below is an
> instruction to build anything. Kept as the record of the v0.2-era plan.

This backlog converts the v0.2 readiness plan into scoped future PRs. It is roadmap/control-plan only and does not implement the epics.

| Epic | Goal | Acceptance criteria | Risk lane | Likely PR sequence | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Repo validation | Keep Review Hub deterministic while v0.2 planning begins. | Standard install, typecheck, build, proof, phase, unsafe-claim, and diff checks pass or document environment limitations. | GREEN | Update validation docs, align CI naming, keep proof commands stable. | Existing proof harnesses. |
| Auth and tenant scaffold | Add production-shaped tenant and auth boundaries without customer data. | Demo tenant exists; tenant context is required for DB-backed routes; auth state is explicit; public-safe mode remains fixture-backed. | YELLOW | Data model proposal, route middleware, demo tenant fixture, tests. | Tenant/security plan. |
| Authorization hardening | Prevent object lookup by ID without tenant context. | Every protected object access checks tenant and role; negative tests cover cross-tenant access. | YELLOW | Inventory routes, add helpers, add denial tests, document patterns. | Auth and tenant scaffold. |
| Microsoft connector scaffold | Create read-only Microsoft Entra ID and Intune connector shape. | Mock/sandbox connector runs; credential references only; no secrets; no writes; connector health visible. | YELLOW | Connector interface, mock provider, normalized signal mapping, health UI. | Auth/tenant scaffold; normalized signal model. |
| Normalized signal model | Define portable posture and context signals. | Microsoft posture, identity, device, workflow, custody, and integration-health signals map to versioned schemas. | YELLOW | Schema docs, fixture updates, validation tests. | Existing simulator/event models. |
| Decision engine v1 | Evaluate the core product question using versioned signals. | Returns `allow`, `step-up`, `restrict`, or `deny`; explains matched rules and evidence used; malformed high-risk input cannot produce unsafe allow. | YELLOW | Policy fixtures, evaluator, proof coverage, review UI. | Normalized signal model; policy versioning. |
| Policy versioning | Track policy versions and active policy pointer. | Active policy is explicit; changes require validation; risky activation requires approval; replay references policy version. | YELLOW | Policy schema, active pointer, activation gate, tests. | Decision engine v1. |
| Durable audit ledger | Preserve decision and action evidence. | Decision records include tenant, actor/system, evidence snapshot, source system, action, reviewability, and retention notes. | YELLOW | Audit schema, append helpers, proof assertions, export notes. | Tenant scaffold; decision engine v1. |
| Operator UX polish | Make the v0.2 loop understandable to an operator. | Dashboard, Decisions, Signals, Policies, Integrations, Audit, and Settings pages explain status and boundaries. | YELLOW | Information architecture, table/detail views, local QA screenshot. | API/data scaffolds. |
| Security middleware | Add baseline app protections. | Rate limiting, request IDs, validation errors, PII-safe logging, secure headers, and safe error handling are documented and tested. | YELLOW | Middleware proposal, implementation, tests, docs. | API layer scaffold. |
| CI/CD hardening | Keep checks reliable for product-shaped work. | Required checks are named, reproducible, and fail on unsafe docs/code regressions. | YELLOW | Script inventory, CI updates, proof artifacts. | Repo validation. |
| Deployment runbook | Define deploy and rollback expectations without claiming production readiness. | Runbook includes environment classes, secrets handling, migration approach, rollback, smoke checks, and incident contacts. | GREEN | Docs-only runbook, then private implementation later. | CI/CD hardening. |
| Investor/demo package | Package v0.2 story without new pitch/social sprawl. | Executive summary, demo script, screenshots, roadmap, security posture, pilot plan, data room index, and diligence checklist are identified and current. | GREEN | Inventory existing assets, fill gaps, owner review. | This readiness plan; pilot criteria. |
