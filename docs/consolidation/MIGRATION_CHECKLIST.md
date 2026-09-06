# Issue migration checklist — pre-filled
> **SUPERSEDED 2026-08-19 — do not execute.** The Phase 6 cutover these records prepared plans the OPPOSITE of the current decision (`docs/PHASE6_CUTOVER_RUNBOOK.md` carries the same banner): `SignalGrid-Review-Hub` is the maintained tree and `DanFashauer/SignalGrid` is legacy, retirement-pending. Kept as a dated record (issues snapshot 2026-07-14); nothing here is pending.


Pre-filled from the **live** open issues across the consolidation sources on
2026-07-14 (cutover prep). Machine snapshot: [`issues-snapshot.json`](./issues-snapshot.json).

Re-run `scripts/cutover/00-triage-issues.sh` at cutover to catch any issues opened
between now and then.

## Live state

| Source | Open issues | Fate of repo |
| ------ | ----------- | ------------ |
| `DanFashauer/SignalGrid-Review-Hub` | **1** (#38) | archived |
| `DanFashauer/DEV` | **0** | archived |
| `DanFashauer/SignalGrid` (home) | **0** | becomes home |

Only **one** issue needs migrating. Clean slate otherwise.

## Checklist

### `SignalGrid-Review-Hub#38` — Security: adversarial pentest record + residual hardening backlog
- **Labels:** `security` · **Author:** DanFashauer · **Opened:** 2026-07-14
- **Link:** https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/38
- **Decision:** ✅ **Migrate** → `DanFashauer/SignalGrid`
- **Why:** It's the record of the adversarial pentest (result: no exploitable break)
  *and* the tracker for a small residual low-priority hardening backlog. The backlog
  is still open work, so it belongs in the production repo; the pentest record rides
  along for provenance.

- [ ] Recreate in the home repo (preserve the full body + the `security` label):
  ```bash
  # Copy the body verbatim from the source issue first:
  gh issue view 38 --repo DanFashauer/SignalGrid-Review-Hub --json body --jq .body > /tmp/sg-38-body.md
  printf '\n\n---\nMigrated from https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/38\n' >> /tmp/sg-38-body.md

  gh issue create --repo DanFashauer/SignalGrid \
    --title "Security: adversarial pentest record + residual hardening backlog" \
    --label security \
    --body-file /tmp/sg-38-body.md
  ```
- [ ] Close the source issue with a pointer to the new one (replace `<new-url>`):
  ```bash
  gh issue close 38 --repo DanFashauer/SignalGrid-Review-Hub \
    --comment "Migrated to the consolidated home repo — see <new-url>."
  ```
- [ ] (Optional) Ensure the `security` label exists in the home repo first:
  ```bash
  gh label create security --repo DanFashauer/SignalGrid --color d73a4a --force
  ```

### `DEV` — nothing to migrate
- [x] 0 open issues. Archive directly (`scripts/cutover/04-archive-sources.sh`).

### `SignalGrid` (home) — nothing to reconcile
- [x] 0 open issues.

## Result

One-line migration: recreate `#38` in `DanFashauer/SignalGrid`, close the original
with a pointer, done. This checklist + the JSON snapshot are the provenance record
for what existed before the sources were archived.
