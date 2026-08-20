# The audit ledger detects edits, not deletions

**Role:** `data-persistence-engineer` (activated 2026-08-20)
**Lab:** PostgreSQL 16 in a container, `@workspace/audit` writing through its real
Postgres backend. Every number below was measured, not reasoned about.

---

## The claim that sent this shift out was false

The role was queued on: *"The chain is gated; the RESTORE path is only described."*

It is not. `proof:backup-restore` has been exercising the whole path on real
Postgres in CI all along. Run live against this lab:

```
16/16 assertions passed
```

…including the ones that matter most — a **single flipped byte in the archive is
REFUSED**, a **truncated archive is refused and named as truncated**, an **archive
with no manifest is refused rather than assumed good**, and — the negative control
that keeps the other three honest — **a good archive is ACCEPTED**, so the verifier
is not simply refusing everything. The database is genuinely destroyed between
backup and restore, and the proof asserts that too rather than assuming it.

`proof:audit-ledger-pg` likewise passes on real Postgres, and localises a
direct-`UPDATE` tamper to the correct global index *across SQL pagination*.

Recording this because a queue entry that overstates a gap is its own defect: it
spends a shift confirming something already true, and it makes the repository look
weaker than it is. The claim was wrong; the gap next to it was real.

## The real gap

A hash chain binds each record to the one before it. That catches an **edit**
anywhere. It cannot catch a **deletion from the end**, because every surviving link
still recomputes.

Measured, on the live ledger:

| Step | `db:verify-ledger` says | Exit |
| --- | --- | --- |
| 40 records, untouched | `Chain intact` (40 records) | 0 |
| `actor.id` rewritten on record 17, hash untouched | `CHAIN BROKEN at record index 16` + expected/actual hashes | **1** |
| 40 records, `DELETE … WHERE seq > 30` | **`Chain intact`** (30 records) | **0** |

The middle row is the tamper-evidence working exactly as advertised, localised to
the exact index. The last row is ten audit records gone, and the tamper-evidence
tool reporting a clean chain.

Nothing inside the chain knows how long the chain is supposed to be. Only someone
outside it does.

## What was done about it

**Pinned as a proof assertion.** `proof:audit-ledger-pg` now seeds 12 records,
deletes down to 8, and asserts that verification still returns `ok` — a *passing*
assertion describing a known limit. This is deliberate: the only thing worse than
the limit is rediscovering it during an incident, and pinning it means the day
someone adds an external anchor or a monotonic counter, **that assertion fails** and
the doctrine is updated on purpose instead of drifting. 14/14, and both new
assertions were confirmed to fail when the deletion is removed.

**Named in the threat model** as its own Tampering row, rather than left to be
inferred from the row about edits. Its residual column names the real fixes:
external anchoring, WORM storage, and append-only database grants.

**Given an operator answer:** `db:verify-ledger --min-records N`.

```bash
DATABASE_URL=... pnpm run db:verify-ledger -- --min-records 40000
```

The count is an assertion the ledger's **owner** makes, because nothing inside the
chain can make it. It is a flag rather than an unconditional failure because a
first-run deployment has a legitimately empty ledger, and a check that cries wolf on
day one is a check somebody switches off by day three.

## The smaller defect the flag also closes

`db:verify-ledger` **refuses to run at all** without `DATABASE_URL`, on stated
grounds worth quoting:

> a verifier that can green-light the void is worse than none, so that path is a
> refusal, not a pass.

It then **exited 0 on an empty table**, printing *"The ledger is EMPTY. Nothing to
verify is not the same as verified history."*

A human reads the sentence. A cron job, a monitoring probe and a CI step read the
exit code — and to all three, a wiped ledger was indistinguishable from a verified
one. Same unearned affirmative the refusal exists to prevent, one layer down, in
the same file. With `--min-records` the machine-readable answer now matches the
prose.

Parsing was widened to match: the previous form accepted `--batch-size` and rejected
every other argument, so a second flag needed the loop or one of the two would be
refused. Verified with both flags together.

## Verified behaviour of the new flag

| Case | Result |
| --- | --- |
| 30 records, `--min-records 40` | `TOO FEW RECORDS: 30 < 40`, exit **1** |
| 30 records, `--min-records 30` | `Chain intact`, exit 0 — does not cry wolf |
| empty ledger, `--min-records 1` | `TOO FEW RECORDS: 0 < 1`, exit **1** |
| empty ledger, no flag | `EMPTY` message, exit 0 — first run still passes |
| `--batch-size 5 --min-records 0` | both honoured, exit 0 |

## What is still true and unfixed

- **Anyone with `UPDATE`/`DELETE` on `audit_ledger` can still remove recent
  history undetectably by the chain alone.** `--min-records` and the backup
  manifest's recorded count detect it from outside; the chain does not.
- The application's database role holds `DELETE` on `audit_ledger` and nothing
  needs it. Revoking it converts this from a detection problem into a permissions
  one, which is strictly better. **Next for this role.**
- No external anchoring, no WORM storage, no keyed chaining. All three are named in
  the threat model's residual column and none are built.

## Commands

```bash
DATABASE_URL=... pnpm run proof:backup-restore    # backup → destroy → restore → re-verify
DATABASE_URL=... pnpm run proof:audit-ledger-pg   # durability, tamper-evidence, truncation limit
DATABASE_URL=... pnpm run db:verify-ledger        # the operator tool, non-destructive
DATABASE_URL=... pnpm run db:verify-ledger -- --min-records 40000
```
