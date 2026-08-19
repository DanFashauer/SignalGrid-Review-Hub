# Automation Phase Template

Use this prompt for future scoped SignalGrid Review Hub phases.

```text
Project: SignalGrid / SignalGrid-Review-Hub

New input:
<paste screenshot summary, link, finding, automation output, GitHub validation result, or vendor observation>

> **ARCHIVED PROCESS NOTE (2026-08-15).** This template writes into
> [PHASE_BACKLOG](PHASE_BACKLOG.md), which is now an archived fossil — do NOT follow
> step 2 as written. The live queue is [BUILD_BACKLOG](BUILD_BACKLOG.md) and the live
> scope authority is [LAUNCH_PROFILE](LAUNCH_PROFILE.md) with its breadth freeze.
> The template stays as the record of the Autopilot-era loop.

Task:
1. Classify the input using docs/INTAKE_CLASSIFICATION_GUIDE.md.
2. ~~Update docs/PHASE_BACKLOG.md with one backlog row or status update.~~ (Archived — record intake in docs/INTAKE_LEDGER.md / docs/BUILD_BACKLOG.md instead.)
3. Choose one scoped phase only.
4. Implement only that phase.
5. Keep all work public-safe: no live integrations, auth, secrets, tenant/customer/PHI/PII data, device actions, source-system writes, production-readiness claims, compliance/certification claims, partnership claims, replacement claims, autonomous production remediation claims, or blind auto-merge.
6. Run relevant validation, including pnpm run phase:gate and pnpm run phase:summary-check when available.
7. Request review and report readiness.
8. Do not merge unless explicitly allowed by the repository owner and the merge policy.

Expected PR sections:
- Summary
- What changed
- Validation
- Automation workflow note
- Merge-lane policy note
- Merge lane
- Public-safety note
- Remaining risks
```
