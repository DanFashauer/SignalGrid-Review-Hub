# SignalGrid Autopilot Evidence Bot

The SignalGrid Autopilot Evidence Bot is a YELLOW-lane automation workflow that runs the complete deterministic Review Hub validation suite, writes sanitized evidence artifacts, and can post a compact pull-request status comment.

## What it runs

The bot installs with `pnpm install --frozen-lockfile`, then runs `pnpm run autopilot:evidence`. The script records each command in `artifacts/signalgrid-autopilot-evidence/commands.json` and fails loudly when any required validation fails.

The evidence suite includes typecheck, build, deterministic proof harnesses, phase gates, backlog check, Level 10 audit, unsafe-claim scan, and `git diff --check`.

## Artifacts

The workflow uploads `signalgrid-autopilot-evidence` with:

- `summary.md`
- `summary.json`
- `commands.json`
- `public-safety.json`
- `next-phase.json`

The summary includes repository, branch, commit SHA, event type, PR number when available, run ID, run attempt, command status, risk lane, public-safety status, unsafe-claim scan result, the next recommended PR, remaining risks, and owner action required.

## Pull-request comment

On `pull_request` events, the workflow attempts to update a previous bot comment using a stable marker. If no previous comment exists, it posts a new compact comment. Comment failure is intentionally non-blocking so validation status is not hidden by a GitHub API issue.

## Public-safety boundaries

The bot explicitly blocks or avoids:

- no live Microsoft Graph calls
- no live ForwardPass/FUYL calls
- no live vendor API calls
- no OAuth secrets
- no customer tenant IDs
- no customer data
- no PHI/PII
- no production device actions
- no autonomous remediation
- no production-ready claim
- no compliance/certification claim
- no partnership/endorsement claim
- no acquisition/valuation/legal claims
- no blind auto-merge

## Node version note

This workflow uses Node 22 to match Review Hub CI and Connector Emulator Smoke. The existing Phase PR Evidence workflow currently uses Node 24; standardizing workflow Node versions remains a separate maintenance follow-up.
