# Phase Automation Orchestrator

The Phase Automation Orchestrator is a public-safe operating model for turning user-provided summaries, screenshots, links, vendor findings, Codex outputs, and GitHub validation results into scoped SignalGrid Review Hub phases.

It is process scaffolding only. It does not add live integrations, authentication, secrets, tenant data, customer data, PHI/PII, production device actions, or blind auto-merge.

## Operating model

```text
Input
  → classify
  → phase backlog
  → scoped task
  → implementation PR
  → CI validation
  → Codex review
  → ChatGPT validation
  → merge lane
  → next phase
```

1. **Input**: the user provides a screenshot, link, finding, Codex summary, GitHub Actions result, vendor observation, or manual QA note.
2. **Classify**: Codex maps the input to the intake classes in `docs/INTAKE_CLASSIFICATION_GUIDE.md` and records the proposed risk lane.
3. **Phase backlog**: Codex updates `docs/PHASE_BACKLOG.md` with the proposed deliverable, dependencies, validation, and notes.
4. **Scoped task**: Codex chooses one narrow phase and avoids bundling unrelated work.
5. **Implementation PR**: Codex implements only that phase with public-safe fixtures and documentation unless explicitly approved otherwise.
6. **CI validation**: GitHub Actions and local commands validate typecheck, build, proof harnesses, unsafe-claim scans, and diff hygiene.
7. **Codex review**: Codex review comments are triaged, with P1/P2 comments blocking fast green-lane readiness. The phase gate should inspect the PR/base diff when branch context is available, and otherwise fall back to the local worktree.
8. **ChatGPT validation**: ChatGPT review classifies readiness, checks public-safety posture, and confirms whether the lane is green, yellow, or red.
9. **Merge lane**: green work can be prepared for fast owner merge; yellow and red work require explicit human approval.
10. **Next phase**: the backlog identifies the next recommended scoped phase.

## Automation posture

“Self-approval” means Codex can classify, implement, run validation, request review, and report merge readiness. It does **not** mean blind auto-merge.

- Green-lane items can be prepared for fast merge by the repository owner.
- Yellow-lane items require explicit human approval before merge.
- Red-lane items require explicit human approval before implementation and merge, and should generally remain blocked in this public Review Hub unless converted to fixture-backed documentation or tests.
- Blind auto-merge is not enabled by default.
- Any future auto-merge must be opt-in, restricted to green-lane PRs, blocked by failing CI, and blocked by Codex P1/P2 review comments.

## Current seed signals

The backlog is seeded with public-safe observations from recent work: rf IDEAS-style credential-reader patterns, LocknCharge/FUYL-shaped smart-locker identity and custody workflows, Apple open-source platform strategy, GitHub Actions Node 20/Node 24 maintenance warnings, Connector Emulator Smoke workflow success, and a future manual full-product smoke screen.

## Next recommended phase

**Add Credential Reader Signal Model** is the next recommended implementation phase after this PR.

That future phase should use rf IDEAS-style badge and credential reader signals plus LocknCharge/FUYL-shaped smart locker identity/custody workflows as public-safe signal patterns. It must not claim live integration, partnership, certification, or production support.
