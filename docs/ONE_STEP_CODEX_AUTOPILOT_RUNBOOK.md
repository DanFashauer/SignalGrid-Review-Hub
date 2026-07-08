# One-Step Codex Autopilot Runbook

After the Autopilot Evidence Bot PR lands, the owner can give Codex one short command:

```text
Build next phase
```

## Meaning of `Build next phase`

Codex should:

1. Inspect open PRs, current workflows, scripts, docs, and backlog state.
2. Select the highest-priority eligible backlog item.
3. Create one scoped PR only.
4. Run the SignalGrid Autopilot Evidence Bot validation path or its local equivalent.
5. Request review with evidence and public-safety notes.
6. Stop for owner approval.

## What it must not mean

The command must not authorize Codex to:

- merge without owner approval
- create live integrations
- use secrets
- touch customer data
- handle PHI/PII
- claim production readiness
- bundle multiple unrelated epics into one PR
- bypass approval gates
- perform production device actions
- perform autonomous remediation

## Next v0.2 sequence

The Evidence Bot should recommend this sequence for future scoped PRs:

1. Production-shaped tenant/auth scaffold
2. Tenant-scope all DB-backed routes
3. Security middleware baseline
4. Normalized signal model
5. Decision engine v1
6. Policy versioning
7. Durable audit ledger
8. Microsoft connector sandbox scaffold
9. Smart-locker / physical custody scaffold
10. Operator UX completion
11. Working concept demo
12. Deployment/staging readiness

## Working concept target

The backlog is driving toward a fixture-backed demo named **Frontline Smart Locker Trust Decision**. A frontline worker needs a replacement shared device, authenticates, Microsoft sandbox posture confirms identity/device state, smart-locker custody fixtures confirm bay/device handoff state, and SignalGrid evaluates policy to return allow, step-up, restrict, or deny.

Every decision must show identity evidence, device posture evidence, custody evidence, policy version, matched rules, outcome, and audit event chain. This remains fixture-backed until the owner explicitly moves it into a private safe-test environment.
