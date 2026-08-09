# Backup and restore — self-hosted SignalGrid

For an operator running the durable stack (`docker-compose.prod.yml`, Postgres).

## Why this document exists

The audit ledger is a tamper-evident hash chain, and the product's claim about it is
that a decision can be shown to have happened, unaltered. Until this was built, this
repository had **no backup path at all** — `pg_dump` appeared in zero files. An
operator had a ledger they could lose and no way to show a restore of it was the same
ledger.

**A backup nobody has restored is not a backup.** The restore path is the one that is
never exercised until the day it matters, so it is exercised on every pull request:
`proof:backup-restore` seeds a ledger, backs it up, **destroys the schema**, restores,
and re-verifies the chain.

## Take a backup

```bash
DATABASE_URL=postgres://user:pass@host:5432/signalgrid \
  pnpm run db:backup -- /var/backups/signalgrid
```

Writes two files:

| File | What it is |
| --- | --- |
| `signalgrid-<timestamp>.dump` | `pg_dump --format=custom` archive |
| `signalgrid-<timestamp>.dump.manifest.json` | SHA-256, byte count, `pg_dump` version, per-table row counts, and **the audit head hash and record count at dump time** |

**Keep the manifest next to the archive.** A restore refuses an archive it cannot
check, so an archive without its manifest is not restorable by this tool. That is
deliberate: "I could not check it" and "I checked it and it is good" must never produce
the same outcome.

## Check a backup without touching a database

```bash
pnpm run db:verify-backup -- /var/backups/signalgrid/signalgrid-2026-08-08T....dump
```

Recomputes the checksum and prints what the archive contains. Needs no `DATABASE_URL`,
so it is safe to run against an archive on a shelf. **Run this on a schedule** — an
archive that has silently rotted is discovered here, or during the incident.

## Restore

```bash
DATABASE_URL=postgres://user:pass@host:5432/signalgrid \
  pnpm run db:restore -- /var/backups/signalgrid/signalgrid-2026-08-08T....dump
```

**This overwrites the database named by `DATABASE_URL`.** Before replacing anything it
verifies the archive and prints what is currently there against what is about to be
installed, so you can stop if the numbers surprise you.

Afterwards it compares the restored audit head against the manifest. If they differ it
**exits non-zero and says so** — the rows restored, but that is not the chain the backup
recorded, and that is a fact you need immediately rather than at the next audit.

Then re-verify the whole chain, not just its head:

```bash
DATABASE_URL=... pnpm run proof:audit-ledger-pg
```

A matching head hash means the same last record. Verifying the chain means every record
between.

## What the CI proof actually establishes

`proof:backup-restore` runs on every pull request against a real Postgres, 16
assertions:

- a seeded ledger verifies **before** backup, and the manifest records its true head
- the database is **genuinely destroyed** in between — asserted, not assumed. Without
  that check the "restore" could be a no-op and every other assertion would still pass
- every table returns with the same row count; the head hash is **the same chain**
- the restored chain **verifies end to end**, and is **still appendable** — a restore
  that produces a read-only or broken-sequence ledger has restored rows, not a system
- **a single flipped byte is refused**, and the refusal says *checksum*
- a truncated archive is refused and named as truncated
- an archive with no manifest is refused rather than assumed good
- and a positive control: a good archive is **accepted**, so the verifier cannot pass
  the negative tests by simply refusing everything

## What this does NOT give you

- **No point-in-time recovery.** No WAL archiving, no RPO/RTO claim. This is a full
  logical dump and a full restore, nothing finer. If you need PITR, use your
  provider's or Postgres's own mechanism; this does not replace it.
- **No proof a backup is ever taken.** This proves the mechanism, not its use. A
  schedule is an operator's job, and an unattended `db:backup` that has been failing
  for a month looks exactly like one that has been working.
- **No encryption at rest, and no opinion about where archives live.** A dump contains
  everything the database contains. Treat the archive as you would treat the database.
- **No application-version compatibility check.** Restoring an old dump into a newer
  schema is not handled here; migrate after restoring, not before.

## Upgrades

There is no upgrade tooling in this repository yet. Until there is, the honest
procedure is: take a backup, verify it, deploy, and keep the archive until you are
satisfied. `db:verify-backup` is what makes "keep the archive" mean something.
