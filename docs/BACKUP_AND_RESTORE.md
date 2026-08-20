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

**The privilege posture is re-applied, not restored.** `pg_restore` runs with
`--no-owner --no-privileges`, so every table comes back owned by the admin
credential that ran the restore, with every grant stripped — which is the safe
direction (an archive can never smuggle the runtime role into ownership), but on
its own it would silently un-split the database roles. The restore therefore
re-applies the canonical role split as its last step: `signalgrid_runtime` gets
back exactly the statements the stores execute — the ledger `SELECT`+`INSERT`
only (append-only **by privilege**, not just by hash chain) — and still owns
nothing. `proof:db-role-split` exercises this whole round trip in CI: backup,
posture deliberately destroyed, restore, runtime writes again, destructive
statements still denied. See "The runtime role" below.

A matching head hash means the same last record. To establish that every record
between them is intact, verify the whole chain — read-only, paginated, any length:

```bash
DATABASE_URL=... pnpm run db:verify-ledger
```

It recomputes every hash and every link from the first record to the head, in bounded
batches, and exits non-zero at the first break with the exact record index. It never
writes. (`verifyLedgerFull` in `@workspace/audit` is the library form; the capped
`verifyLedger()` still exists for quick checks and now reports `truncated: true`
whenever its 10,000-record cap may have cut the read short — a truncated `ok` is a
statement about a prefix, never about the chain.)

### What the chain cannot see: deletion from the end

**A clean `db:verify-ledger` does not mean no records are missing.** Each record
binds to the one before it, so an *edit* anywhere breaks the chain and is localised
to the exact index. Deleting records from the **end** breaks nothing — every
surviving link still recomputes, and the verifier reports a clean chain over a
ledger whose most recent history has been removed.

This is measured, not theorised. Forty records were seeded into a real Postgres,
the last ten deleted with a plain `DELETE`, and `db:verify-ledger` printed
*"Chain intact — every record from first to head recomputes and links"* and exited
**0**. `proof:audit-ledger-pg` now pins the behaviour as an explicit assertion, so
the day an external anchor or a monotonic counter is added, that assertion fails and
this section gets rewritten deliberately rather than quietly going stale.

The chain cannot detect this because nothing inside it knows how long it is
supposed to be. Only someone outside it does — so say it:

```bash
DATABASE_URL=... pnpm run db:verify-ledger -- --min-records 40000
```

`--min-records N` fails, non-zero, when the ledger holds fewer than `N` records.
Use it wherever a machine reads the exit code — a cron job, a monitoring probe, a
pre-audit check — because until this flag existed those callers could not tell a
verified ledger from a wiped one. Without the flag an empty ledger still prints
*"The ledger is EMPTY. Nothing to verify is not the same as verified history."* and
exits 0, which is correct for a first-run deployment and useless to cron.

The backup manifest is the other half of the answer: it records the audit head hash
**and record count** at dump time, so a restore that comes back short is caught by
`db:restore` comparing against it.

> **DO NOT run `proof:audit-ledger-pg` against a restored database.** An earlier
> revision of this page told you to, and doing so destroys the ledger you just
> restored: the proof's first statement is `DROP TABLE IF EXISTS audit_ledger`
> (`scripts/src/audit-ledger-pg-proof.ts:46`). It is a CI proof that builds and tears
> down its own table on a throwaway database. `db:verify-ledger` is the operator tool.

## Export the chain out of custody

Tamper-evidence checked only by the machine that holds the data is weaker than it
sounds: whoever can rewrite the table can also run that machine's verifier. The
export is the chain **leaving custody** — a file an assessor, a cold-storage vault,
or the owner's laptop can re-verify with no database at all:

```bash
DATABASE_URL=... pnpm run db:export-ledger -- --out ledger.ndjson
pnpm run verify:ledger-export -- ledger.ndjson        # anywhere, no DATABASE_URL
```

The export writes one canonical record per line plus a manifest
(`ledger.ndjson.manifest.json`): record count, head hash, first/last timestamps, and
the SHA-256 of the file bytes. **The manifest is what makes truncation detectable** —
a hash chain alone cannot see records missing from its end, because a shorter chain
is also a valid chain; only the manifest knows how long this one must be. Write the
head hash and file digest down *outside* the exporting machine (or countersign
them): the manifest proves the file, something else must prove the manifest.

Refusals are deliberate, and match `db:verify-ledger`'s posture: no `DATABASE_URL`
(exporting a fresh in-memory void is not an export), a broken chain (an export would
launder the break into archival-looking provenance — investigate first), and an
empty ledger. The offline verifier likewise refuses a missing manifest and an empty
file, and exits non-zero with the exact record index on a break. The round trip —
export, verify offline, byte-flip caught at two layers, truncation caught by the
manifest, mid-file deletion localized — is pinned by `proof:audit-ledger`
(`scripts/src/audit-ledger-proof.ts`), which drives the same code these commands run.

## Two ledgers, honestly

This repository carries **two audit chains**, and they are not the same thing:

- **`@workspace/audit`** — the durable SHA-256 hash chain this page is about.
  Postgres-backed when `DATABASE_URL` is set, concurrency-safe under an advisory
  lock, backed up and restored by the commands above, verified end to end by
  `db:verify-ledger`. It has **no HTTP route yet**; its consumers are in-process.
- **The core's per-tenant digest chain** (`lib/signalgrid-core`) — what
  `GET /v1/audit` and the console's Audit page actually serve. It lives in process
  memory and **does not survive a restart**. It is the reviewer-facing surface at
  launch, and calling it "durable" was a false claim this repository has corrected.

Bridging the two (anchoring the core chain's digests into the durable ledger) is a
deliberate open decision, not an accident — until it is made, any statement about
"the audit ledger" should say which one it means.

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

The schema is versioned: `pnpm run db:migrate` applies the append-only migration
list (`lib/persistence/src/migrations.ts`) and records each step in a
`schema_version` table, so a running database can answer which revision it is.
The runner is idempotent (a second run applies nothing), refuses a database whose
recorded version is NEWER than the code driving it (old code must never drive a
newer schema), and is exercised in CI's durable-persistence job on every PR — the
upgrade path is tested continuously, not discovered at the first real upgrade.

The honest procedure is still: take a backup, verify it, run `db:migrate`, deploy,
and keep the archive until you are satisfied. `db:verify-backup` is what makes
"keep the archive" mean something.

## The runtime role

Migration v2 splits the database credentials: the API server should run as
`signalgrid_runtime`, a plain `LOGIN` role that **owns nothing** and holds
exactly the statements the stores execute —

| Table | Grants | Why |
| --- | --- | --- |
| `audit_ledger` | `SELECT`, `INSERT` (+ sequence `USAGE`) | Append-only **by privilege**. The hash chain detects tampering after the fact; the missing `UPDATE`/`DELETE` grant prevents the runtime credential from doing it at all. |
| `decisions`, `evidence_snapshots` | `SELECT`, `INSERT`, `UPDATE` | The stores upsert via `INSERT … ON CONFLICT DO UPDATE`. |
| `sessions` | `SELECT`, `INSERT`, `UPDATE` | Lifecycle transitions are `UPDATE`s. |

No `DELETE` anywhere, no `TRUNCATE`, no DDL, no `CREATE` on the schema. Schema
and admin work (`db:migrate`, `db:backup`/`db:restore`) stays with the admin
credential — a different login entirely.

To wire it up: run `db:migrate` with the admin credential (creates the role and
grants), set a password out of band — the canonical SQL deliberately carries
none — and point the application's `DATABASE_URL` at the runtime login:

```bash
psql "$ADMIN_DATABASE_URL" -c "ALTER ROLE signalgrid_runtime PASSWORD '…'"
DATABASE_URL=postgres://signalgrid_runtime:…@host:5432/signalgrid  # the app
```

The stores' bootstrap DDL degrades honestly under this role: if migrations
already built the schema they proceed; if the schema is missing they refuse with
the exact remedy ("run `db:migrate` with the admin credential") instead of a
bare permission error. And existence is not usability — after the missing-schema
check, each store verifies the exact table privileges its statements need (the
ledger appender additionally checks sequence `USAGE`), and all three durable
components' `ping()` probes re-verify them on every `/readyz`, so it goes unready when the
posture regresses instead of reporting a health the first real write would
disprove. `proof:db-role-split` proves both directions on a real Postgres in
CI — every legitimate runtime write works, every destructive statement is
denied with `insufficient_privilege`, the admin can still do what the runtime
cannot (so the denial is the role, not the table), and a backup → restore round
trip recreates the same posture without ever making the runtime an owner.

**Provisioning is prechecked, fail-closed.** Creating `signalgrid_runtime`
needs cluster-wide `CREATEROLE` (or `SUPERUSER`) — an attribute many
least-privilege migration credentials deliberately lack. Both `db:migrate` and
`db:restore` check this **before doing any work**: if the role is missing and
the credential cannot create it, they refuse with the remedy (`CREATE ROLE
signalgrid_runtime LOGIN;` run by a cluster administrator) instead of dying
mid-migration or — worse — after `pg_restore` has already replaced the
database. The split also refuses to **adopt** a preexisting `signalgrid_runtime`
that is anything more than a plain LOGIN role: elevated attributes
(`SUPERUSER`, `CREATEROLE`, `BYPASSRLS`, …), `NOLOGIN` (grants would apply and
the API still could not connect — and a deliberate lockout must not be
silently re-enabled), ownership of relations, schemas, or the database itself,
or role memberships — all grounds for refusal, because `REVOKE` cannot demote
any of them and the append-only claim would be false. Each refusal names its
one remedy, and a restore runs the same validation BEFORE `pg_restore`. The
grant reset is wider than the role: `PUBLIC`-level grants, column-level ACLs,
and the ledger sequence's ACL are all reset on every apply, every relation
schema-qualified. And `pnpm run db:migrate` doubles as the REPAIR command: on
a database already at the current schema version it re-applies the (idempotent)
split, so a dropped role or revoked grant is fixed by exactly the command the
error messages name.

**The real-Postgres proofs demand a disposable cluster.** Every `proof:*-pg`
and `proof:backup-restore`/`proof:db-role-split` run DROPs the tables it tests,
and the role-split proof re-passwords the cluster-wide `signalgrid_runtime`
role. Setting `DATABASE_URL` is therefore not consent: the proofs refuse
(loudly, exit 1 — never a silent skip) unless `SIGNALGRID_DB_DISPOSABLE=1`
declares the **entire target cluster** — data, schema, and roles; roles are
cluster-wide, so a throwaway *database* on a shared server is not isolation —
safe to destroy. CI's service container sets it; never set it against anything
persistent.
