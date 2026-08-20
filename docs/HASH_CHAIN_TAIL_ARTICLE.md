<!-- STAGING NOTE — strip before publication.
Owner decision DR-005 (August 20, 2026): approved for publication AFTER the
role-split correction below, which this file carries. Venue: the SignalGrid
company technical blog on signalgrid.app (to be built), then a shorter founder
version on the owner's LinkedIn linking back. No third-party outlet for the
first piece. The experiment is independently re-checked continuously:
proof:audit-ledger-pg re-runs it against a real Postgres in the "Durable
persistence" CI job on every push. PUBLISHING IS THE OWNER'S SEND — nothing
here authorizes posting it anywhere.
-->

# A hash-chained audit log can't see its own tail

Hash chaining is the standard prescription for tamper-evident audit logs. Each record stores a hash over its own contents plus the hash of the record before it; change anything, anywhere, and every link downstream stops recomputing. It is cheap, it needs no special infrastructure, and nearly every tutorial on the pattern stops there — leaving an implication hanging that turns out to be false. A hash chain detects edits. It cannot detect deletion from the end. And the end of the log is exactly where the records an attacker cares about live.

We measured this rather than reasoned about it. The lab was PostgreSQL 16 in a container, an audit ledger writing through its real Postgres backend, and a chain verifier that walks the table in batches and exits non-zero on any break. Three runs:

| Table state | Verifier says | Exit code |
| --- | --- | --- |
| 40 records, untouched | `Chain intact` (40 records) | 0 |
| `actor.id` rewritten on record 17, stored hash left alone | `CHAIN BROKEN at record index 16`, with expected and actual hashes | 1 |
| 40 records, then `DELETE … WHERE seq > 30` | `Chain intact` (30 records) | 0 |

The middle row is the pattern working exactly as advertised: one field edited, the break localised to the exact index, non-zero exit. The last row is ten audit records removed with one ordinary `DELETE` — and the tamper-evidence tool reporting a clean chain.

The reason is structural, not a bug. A hash chain proves that every surviving record is consistent with the one before it. Truncate the suffix and every surviving link still recomputes; what remains is a shorter chain that is perfectly valid. Nothing inside the chain knows how long the chain is supposed to be. Only something outside it can know that.

Threat-model it for a second and it gets worse. The attacker most worth designing against is someone who just did a thing and wants the trace gone. Their records are the newest ones — the tail. The one operation the chain is blind to is the one that most precisely serves the person the chain was built against.

While pinning this down we found a second, quieter instance of the same defect class in the same tool. The verifier already refused to run without a database URL, on grounds we would stand by anywhere: a verifier that can green-light the void is worse than none. But on an empty table it printed "The ledger is EMPTY. Nothing to verify is not the same as verified history" — and exited 0. A human reads the sentence. A cron job, a monitoring probe and a CI step read the exit code, and to all three, a wiped ledger was indistinguishable from a verified one.

What actually closes the gap is a record count asserted from outside the chain:

- **An operator-asserted floor.** Our verifier now takes `--min-records N` and fails hard below it: 30 records against `--min-records 40` exits 1 with `TOO FEW RECORDS: 30 < 40`; an empty ledger against `--min-records 1` exits 1; 30 against 30 stays green, so it does not cry wolf. It is a flag rather than an unconditional check because a first-run deployment has a legitimately empty ledger, and a check that cries wolf on day one is a check somebody switches off by day three.
- **A real role split — not a `REVOKE`.** Our first instinct was "revoke DELETE from the application role," and it would have been theater: the application role *created* the ledger table, and in PostgreSQL the owner of a table holds its privileges by ownership, not by grant — there was no GRANT anywhere to revoke, and a `REVOKE` aimed at an owner changes nothing. The fix that actually holds is two roles: an owner/admin role that runs migrations, backups, and restores, and a restricted runtime role that does **not** own the ledger and carries only `SELECT`, `INSERT`, and `UPDATE`. One wrinkle worth knowing before you build it: `pg_restore --clean` drops the tables, and table-level grants die with the dropped object — so a restore path must re-apply the runtime role's grants afterwards, or the first real restore silently undoes the hardening.
- **External anchoring or WORM storage.** Periodically record the count and head hash somewhere the database credentials cannot reach. Backup manifests are a free version of this: ours already record counts, so a restore that comes back shorter than its manifest is catchable — if something compares.

One more move worth stealing. We pinned the limitation into the test suite as a *passing* assertion: the proof seeds twelve records, deletes down to eight, and asserts that verification still returns ok. That reads backwards until you consider the alternative, which is rediscovering the limit during an incident. The day someone adds an external anchor or a monotonic counter, that assertion fails, and the doctrine gets updated on purpose instead of drifting. Both new assertions were confirmed to fail when the deletion step is removed — a test that cannot fail proves nothing.

Reproducing this on your own ledger takes five minutes: delete the last N rows with plain SQL, run your integrity verifier, and read the exit code, not the prose. If it says 0, your tamper evidence has the same hole ours did — and now you know which of the three fixes fits your deployment.

---

*This came out of hardening the audit ledger behind SignalGrid, a fail-closed assist gate for shared frontline devices; the full lab notes are public in our review repository.*
