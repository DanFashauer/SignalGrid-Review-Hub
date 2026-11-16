# Consolidation records
> **SUPERSEDED 2026-08-19 — do not execute.** The Phase 6 cutover these records prepared plans the OPPOSITE of the current decision (`docs/PHASE6_CUTOVER_RUNBOOK.md` carries the same banner): `SignalGrid-Review-Hub` is the maintained tree and `DanFashauer/SignalGrid` is legacy, retirement-pending. Kept as a dated record (issues snapshot 2026-07-14); nothing here is pending.


Auditable artifacts produced during the Phase 6 cutover.

- `issues-snapshot.json` — point-in-time snapshot of open issues across the
  consolidation sources, written by `scripts/cutover/00-triage-issues.sh` (a
  pre-filled version from the live issues on 2026-07-14 is committed here). This
  is the record of what existed before the sources were archived; migrate the
  keepers into the home repo and keep this file for provenance.
- `MIGRATION_CHECKLIST.md` — human-readable, pre-filled triage: the migrate/close
  decision per open issue with ready-to-run `gh` commands. As of cutover prep the
  entire migration is one issue (`SignalGrid-Review-Hub#38` → `SignalGrid`);
  `DEV` and old `SignalGrid` have zero open issues.
