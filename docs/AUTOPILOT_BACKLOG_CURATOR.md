# Autopilot Backlog Curator

> ## ⛔ RETIRED 2026-08-15
>
> The curator script (`autopilot:backlog-check`) is deleted. It read
> [PHASE_BACKLOG](PHASE_BACKLOG.md) — now an archived fossil — ran in neither CI nor
> preflight, compared rows by ID only (so it could not see the table's duplicate
> content), and its standing top recommendation was a phase that a later phase had
> already superseded. Wiring it in would have made a frozen file load-bearing;
> deleting it is the honest end. The live queue is [BUILD_BACKLOG](BUILD_BACKLOG.md).
> This page stays as the record of what the curator was meant to do.

The Autopilot Backlog Curator keeps `docs/PHASE_BACKLOG.md` usable as the single public-safe phase queue.

## Responsibilities

- Verify there are no duplicate active phase IDs.
- Verify new inputs are parked or assigned.
- Verify each phase has risk lane, status, validation, and notes.
- Recommend the next eligible phase from backlog state.
- Preserve the one-phase-per-PR rule.

## Script

~~`pnpm run autopilot:backlog-check` runs a lightweight table check and prints the next backlog candidate.~~ (The script is deleted — see the banner above. Historical description follows.) It did not create branches, modify files, call vendors, or merge PRs.
