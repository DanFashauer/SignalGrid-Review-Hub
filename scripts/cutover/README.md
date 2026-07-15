# Phase 6 cutover scripts

Companion automation for `docs/PHASE6_CUTOVER_RUNBOOK.md`. Run them **from a machine
authenticated as the repo owner** (`gh auth status` green) — they mutate GitHub repos
and settings the sandboxed agent cannot touch.

Every script:

- reads its targets from env vars (defaults in `_env.sh`), so nothing is hardcoded;
- supports **`DRY_RUN=1`** — prints the exact commands without executing side effects;
- is **idempotent** — safe to re-run.

## Order

| # | Script | What it does | Reversible? |
| - | ------ | ------------ | ----------- |
| 00 | `00-triage-issues.sh` | Snapshot open issues from both sources → `docs/consolidation/issues-snapshot.json`; print migration checklist. | read-only |
| 01 | `01-build-consolidated-history.sh` | Build a local `dev` branch = validated consolidation tree, with SignalGrid + DEV histories attached as ancestry (`-s ours`). Verifies the tree is unchanged. | local only |
| 02 | `02-create-tiers.sh` | Create `dev/alpha/beta/prod`, push to the home repo, set `dev` as default. | yes (§9) |
| 03 | `03-protect-and-environments.sh` | Branch protection on all tiers + per-tier environments + tier/gate variables. | yes (§9) |
| 04 | `04-archive-sources.sh` | Archive `SignalGrid-Review-Hub` and `DEV`. **Run only after §8 passes.** | `gh repo unarchive` |

## Usage

```bash
cd scripts/cutover
# Always dry-run first:
DRY_RUN=1 ./01-build-consolidated-history.sh
# Then for real:
./01-build-consolidated-history.sh
```

Override any target inline, e.g.:

```bash
HOME_REPO=DanFashauer/SignalGrid CONSOLIDATION_REF=claude/signalgrid-launch-plan-emxm01 \
  DRY_RUN=1 ./02-create-tiers.sh
```
