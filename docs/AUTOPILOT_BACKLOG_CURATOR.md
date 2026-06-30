# Autopilot Backlog Curator

The Autopilot Backlog Curator keeps `docs/PHASE_BACKLOG.md` usable as the single public-safe phase queue.

## Responsibilities

- Verify there are no duplicate active phase IDs.
- Verify new inputs are parked or assigned.
- Verify each phase has risk lane, status, validation, and notes.
- Recommend the next eligible phase from backlog state.
- Preserve the one-phase-per-PR rule.

## Script

`pnpm run autopilot:backlog-check` runs a lightweight table check and prints the next backlog candidate. It does not create branches, modify files, call vendors, or merge PRs.
