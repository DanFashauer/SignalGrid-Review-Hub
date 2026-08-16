# Phase Automation Orchestrator

The Phase Automation Orchestrator is a public-safe operating model for turning user-provided summaries, screenshots, links, vendor findings, automation outputs, and GitHub validation results into scoped SignalGrid Review Hub phases.

It is process scaffolding only. It does not add live integrations, authentication, secrets, tenant data, customer data, PHI/PII, production device actions, or blind auto-merge.

## Operating model

```text
Input
  → classify
  → phase backlog
  → scoped task
  → implementation PR
  → CI validation
  → automated review
  → ChatGPT validation
  → merge lane
  → next phase
```

1. **Input**: the user provides a screenshot, link, finding, automation summary, GitHub Actions result, vendor observation, or manual QA note.
2. **Classify**: the automation agent maps the input to the intake classes in `docs/INTAKE_CLASSIFICATION_GUIDE.md` and records the proposed risk lane.
3. **Phase backlog**: ~~the automation agent updates `docs/PHASE_BACKLOG.md`~~ **(ARCHIVED 2026-08-15 — that table is a frozen record; the live queue is `docs/BUILD_BACKLOG.md` and intake goes to `docs/INTAKE_LEDGER.md`.)**
4. **Scoped task**: the automation agent chooses one narrow phase and avoids bundling unrelated work.
5. **Implementation PR**: the automation agent implements only that phase with public-safe fixtures and documentation unless explicitly approved otherwise.
6. **CI validation**: GitHub Actions and local commands validate typecheck, build, proof harnesses, unsafe-claim scans, and diff hygiene.
7. **automated review**: automated review comments are triaged, with P1/P2 comments blocking fast green-lane readiness. The phase gate should inspect the PR/base diff when branch context is available, and otherwise fall back to the local worktree.
8. **ChatGPT validation**: ChatGPT review classifies readiness, checks public-safety posture, and confirms whether the lane is green, yellow, or red.
9. **Merge lane**: green work can be prepared for fast owner merge; yellow and red work require explicit human approval.
10. **Next phase**: the backlog identifies the next recommended scoped phase.

## Automation posture

“Self-approval” means the automation agent can classify, implement, run validation, request review, and report merge readiness. It does **not** mean blind auto-merge.

- Green-lane items can be prepared for fast merge by the repository owner.
- Yellow-lane items require explicit human approval before merge.
- Red-lane items require explicit human approval before implementation and merge, and should generally remain blocked in this public Review Hub unless converted to fixture-backed documentation or tests.
- Blind auto-merge is not enabled by default.
- Any future auto-merge must be opt-in, restricted to green-lane PRs, blocked by failing CI, and blocked by automated P1/P2 review comments.

## Current seed signals

The backlog is seeded with public-safe observations from recent work: rf IDEAS-style credential-reader patterns, LocknCharge/FUYL-shaped smart-locker identity and custody workflows, Apple open-source platform strategy, GitHub Actions Node 20/Node 24 maintenance warnings, Connector Emulator Smoke workflow success, and a future manual full-product smoke screen.

## Autopilot extension

The SignalGrid Autopilot Control Plane extends this loop so the user can hand off a PR number, workflow URL, screenshot, link, or short command instead of a long automation summary. The Autopilot layer is documented in `docs/SIGNALGRID_AUTOPILOT_CONTROL_PLANE.md`, with intake classification in `docs/AUTOPILOT_INTAKE_BOT.md`, PR evidence reporting in `docs/PHASE_PR_EVIDENCE_BOT.md`, backlog checks in `docs/AUTOPILOT_BACKLOG_CURATOR.md`, and command syntax in `docs/AUTOPILOT_COMMAND_GUIDE.md`.

## Next recommended phase

The next recommended implementation phase should come from the highest-priority eligible backlog item after the Autopilot Control Plane lands. Live-integration ideas remain parked until owner approval and a safe private-test context exist.
