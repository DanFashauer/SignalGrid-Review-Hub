# SignalGrid Autopilot Control Plane

The SignalGrid Autopilot Control Plane is the public-safe automation layer for turning one user input into one scoped Review Hub phase. It is automation and reporting scaffolding only: it does not add live vendor integrations, live Microsoft Graph calls, secrets, tenant data, device actions, or unsupervised production remediation.

## Purpose

Autopilot reduces manual PR-by-PR coordination. A user can provide a PR number, workflow URL, screenshot, link, market note, vendor finding, or short summary. Automation classifies the input, updates the backlog, selects the next eligible phase, runs evidence checks, and prepares compact status for owner review.

## Operating model

```text
One input
  → Intake Bot classification
  → backlog parking or phase assignment
  → Builder Bot scoped PR plan
  → Evidence Bot validation report
  → Pitch Bot readiness refresh
  → owner merge or owner decision
```

Autopilot keeps one implementation phase per PR. It may park several inputs, but it should not implement multiple unrelated phases in a single change set.

## User handoff format

Use short handoffs instead of long Codex summaries:

- `@GitHub PR #__`
- `@GitHub run <workflow URL>`
- `New input: <link/screenshot/summary>`
- `Build next phase`

## Bot roles

- **Intake Bot** classifies new material into product, signal, connector, proof, dashboard, platform, pitch, blocked, or parking-lot categories.
- **Builder Bot** converts the highest-priority eligible backlog item into one scoped PR.
- **Evidence Bot** runs gate checks, summarizes changed files and risk lane, uploads artifacts, and optionally posts one compact PR comment.
- **Pitch Bot** maintains buyer, partner, investor, and design-partner readiness materials from validated public Review Hub state.

## Risk lanes

- **GREEN**: docs-only, low-risk automation notes, parking-lot updates, or evidence summaries. Owner can merge after validation.
- **YELLOW**: workflows, scripts, runtime UI, proof harnesses, fixtures, connector models, or any approval-gated behavior. Owner approval is required before merge.
- **RED**: live integrations, secrets, tenant/customer data, PHI/PII, device writes, source-system writes, unsafe allow paths, or unapproved production-style remediation. Block by default in Review Hub.

## Evidence requirements

Every phase should record changed scope, risk lane, expected validation, public-safety posture, artifacts expected, owner action, merge recommendation, and next phase. Evidence should prefer named workflow artifacts and compact reports over long manual summaries.

## Owner approval boundaries

The owner must decide funding direction, pitch positioning, partnership or buyout posture, risky live integrations, lab tenant use, design-partner readiness, and any merge for YELLOW or RED lanes.

## Next-phase selection rules

1. Select the highest-priority backlog item whose dependencies are complete.
2. Prefer fixture-backed or docs-only work over live integration work.
3. Do not combine unrelated product, workflow, and pitch phases.
4. Keep blocked live-integration ideas parked until owner approval and a safe private-test context exist.
5. Require proof coverage updates when simulator decision behavior changes.
