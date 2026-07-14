# Automation Phase Template

Use this prompt for future scoped SignalGrid Review Hub phases.

```text
Project: SignalGrid / SignalGrid-Review-Hub

New input:
<paste screenshot summary, link, finding, automation output, GitHub validation result, or vendor observation>

Task:
1. Classify the input using docs/INTAKE_CLASSIFICATION_GUIDE.md.
2. Update docs/PHASE_BACKLOG.md with one backlog row or status update.
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
