# Codex task template

Copy this template into Codex Web for mobile-first Review Hub tasks.

## Project

SignalGrid / SignalGrid-Review-Hub

## Mode

Cloud Codex, mobile-first workflow. Create a branch, make the requested changes, run validation, commit, and open or update a pull request. Do not merge.

## Goal

Describe the single outcome for this PR.

## Scope

List the files, docs, proof harnesses, or public-safe fixtures Codex may change.

## Guardrails

- Follow `AGENTS.md`.
- Public-safe fixtures only.
- No secrets, tenant IDs, customer data, PHI, or PII.
- No real vendor/API calls.
- No production-ready claims.
- No compliance/certification claims.
- No partnership/alliance claims.
- No replacement claims.
- No autonomous production remediation claims.
- High-risk actions remain simulated and approval-required.
- Existing enterprise systems remain systems of record.

## Files to change

- `path/to/file`
- `path/to/other-file`

## Validation

Run the applicable commands from `docs/VALIDATION_COMMANDS.md`, including:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
git diff --check
```

Document any environment limitation instead of hiding it.

## PR body requirements

Include:

- Summary
- What changed
- Validation
- Public-safety note
- Remaining risks
- Owner decision needed, if any

## Do-not-do list

- Do not add product scope beyond the requested task.
- Do not add integrations unless explicitly requested.
- Do not add live calls, secrets, tenant IDs, or customer data.
- Do not weaken deterministic proof coverage.
- Do not bypass approval gates.
- Do not change simulator decision logic unless explicitly requested.
- Do not merge the PR.

## Stop condition

Stop after the branch is committed and the PR is opened or updated with validation notes. If the task requires live auth, local secrets, or private environment checks, stop and mark it as a PC test gate.
