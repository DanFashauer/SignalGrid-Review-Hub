# Consolidation records

Auditable artifacts produced during the Phase 6 cutover.

- `issues-snapshot.json` — point-in-time snapshot of open issues in the source
  repos (`SignalGrid-Review-Hub`, `DEV`) at cutover, written by
  `scripts/cutover/00-triage-issues.sh`. This is the record of what existed
  before the sources were archived; migrate the keepers into the home repo and
  keep this file for provenance.
