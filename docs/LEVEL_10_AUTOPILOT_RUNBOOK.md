# Level 10 Autopilot Runbook

This runbook defines the hands-off operating model for moving SignalGrid Review Hub toward public-safe Level 10 readiness without requiring long pasted summaries from the owner.

## Operating model

1. **Owner sends one input**: a PR number, GitHub Actions run URL, screenshot, link, note, market observation, or requested outcome.
2. **Autopilot classifies the input** into one of: product demo, proof evidence, pitch, social, buyer/partner, founder strategy, real-world testing, public-safety, automation, or backlog hygiene.
3. **Autopilot assigns a risk lane**:
   - GREEN: docs, deterministic fixtures, public-safe cleanup, read-only proof updates.
   - YELLOW: pitch, partner, social, UI/demo, workflow, sandbox-readiness, or owner-facing strategy changes.
   - RED: anything involving real environments, private data, legal terms, regulated claims, live writes, or production action.
4. **Autopilot updates the phase backlog** with the classified input, recommended phase, owner dependency, and stop condition.
5. **Autopilot opens one scoped PR per phase** so changes stay reviewable and rollback-safe.
6. **CI/proofs/smoke evidence run** using deterministic commands and public-safe fixtures only.
7. **Phase PR Evidence report is generated** so reviewers can inspect what changed, what passed, and what remains blocked.
8. **ChatGPT reviews GitHub state directly** from PRs, run URLs, files, and artifacts instead of asking the owner to paste long automation summaries.
9. **Owner approves only strategic or risky decisions**, especially YELLOW/RED work, outreach posture, sandbox movement, and any future opt-in automation policy.

## Default classification table

| Input | Default phase | Risk lane | Autopilot action | Owner dependency |
|---|---|---|---|---|
| PR number or run URL | Evidence review | GREEN/YELLOW | Inspect files, CI, proof artifacts, backlog impact. | Approve merge if YELLOW. |
| Screenshot | Market/input classification | YELLOW | Classify, park evidence, propose next scoped phase. | Confirm interpretation. |
| Link or article | Category intelligence | YELLOW | Summarize public-safe implications and update backlog. | Confirm whether to pursue. |
| New demo request | Demo expansion | YELLOW | Update demo plan or create UI follow-up. | Pick target audience. |
| Proof failure | Evidence repair | GREEN/YELLOW | Reproduce, fix deterministic proof, update report. | Approve if scope expands. |
| Real sandbox request | Real-world testing | RED until scoped | Create readiness checklist; do not add live integration. | Explicit owner approval. |

## Stop conditions

Autopilot stops and asks for owner direction when work would require secrets, live API calls, tenant/customer data, PHI/PII, device actions, production writes, legal/valuation terms, vendor endorsement claims, or production/compliance claims.

## Auto-merge posture

Blind auto-merge is not enabled for YELLOW or RED work. GREEN auto-merge may be documented only as a future opt-in policy and only after repository support exists, deterministic checks pass, and the owner explicitly enables it.
