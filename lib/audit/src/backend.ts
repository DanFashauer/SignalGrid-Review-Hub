// Audit ledger storage backends.
//
// The ledger is a hash chain: each record's `prevHash` must equal the previous
// record's `hash`. So "read the current head, build the record against it, then
// persist" MUST be atomic — otherwise two concurrent appends could both chain
// off the same head and fork the ledger. Every backend therefore exposes a
// single `appendWithChain(build)` critical section rather than separate
// read-head / insert calls.
//
// Selection is gated and fail-safe: the default (no DATABASE_URL) is the
// in-memory backend, so the public build, the deterministic proofs, and every
// test keep their existing behavior. A Postgres backend is used ONLY when
// DATABASE_URL is set (a real production deploy). `pg` is imported lazily so it
// is never loaded on the default path.

import type { AuditRecord } from "./types";

export interface AuditBackend {
  /** Atomically: read the head hash, build the record against it, persist it. */
  appendWithChain(build: (prevHash: string) => AuditRecord): Promise<AuditRecord>;
  /** Records in insertion order, sliced. */
  getRecords(limit: number, offset: number): Promise<AuditRecord[]>;
  /**
   * Round-trip readiness probe (durable backends only). Resolves when the
   * backend can actually append — connection AND privileges — and rejects
   * otherwise, so /readyz reflects fitness rather than mere liveness.
   */
  ping?(): Promise<void>;
  /** Optional teardown (Postgres pool). */
  close?(): Promise<void>;
}

// ── in-memory (default, fixture-safe) ───────────────────────────────────────
export class InMemoryAuditBackend implements AuditBackend {
  private ledger: AuditRecord[] = [];
  private headHash = "";

  async appendWithChain(build: (prevHash: string) => AuditRecord): Promise<AuditRecord> {
    const record = build(this.headHash);
    this.ledger.push(record);
    this.headHash = record.hash;
    return record;
  }

  async getRecords(limit: number, offset: number): Promise<AuditRecord[]> {
    return this.ledger.slice(offset, offset + limit);
  }
}

// ── Postgres (production; used only when DATABASE_URL is set) ────────────────
// A monotonic `seq` gives a total insertion order; a transaction-scoped
// advisory lock serializes the read-head → insert critical section so the hash
// chain cannot fork under concurrent writers.
const ADVISORY_LOCK_KEY = 0x516e414c; // "sgAL" — stable per-ledger lock id

export class PostgresAuditBackend implements AuditBackend {
  private pool: any;
  private ready: Promise<void>;
  private retry: Promise<void> | null = null;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.ready = this.init(connectionString);
    // A caller may never await this.ready (readyz can bail on an earlier
    // component before probing this one) — without a standing handler, a
    // rejected eager init becomes an unhandledRejection that KILLS the
    // process. The branch below only defuses that; ensureReady still sees and
    // retries the real rejection.
    this.ready.catch(() => {});
  }

  /**
   * A REJECTED first init must not poison this class forever (the same review
   * finding fixed in PostgresDecisionStore): boot before the database, the
   * first query rejects, and `this.ready` is a permanently cached rejection —
   * every later call replays the stale failure while the recovered database
   * sits reachable, healed only by a process restart that liveness-keyed
   * orchestration never triggers. A failed init is RETRIED on next use, after
   * tearing down any half-built pool.
   */
  private async ensureReady(): Promise<void> {
    try {
      await this.ready;
      return;
    } catch {
      // fall through to the single-flight rebuild below
    }
    // SINGLE-FLIGHT: a recovery burst after an outage must not have every
    // caller independently tear down and rebuild the pool — overlapping
    // retries overwrite each other's pool reference, leak the orphaned pools'
    // connections, and can exhaust the server. The first caller performs the
    // rebuild; every concurrent caller awaits that same attempt.
    if (!this.retry) {
      this.retry = (async () => {
        if (this.pool) {
          try { await this.pool.end(); } catch { /* the old pool may already be dead */ }
          this.pool = undefined;
        }
        await this.init(this.connectionString);
      })();
      this.ready = this.retry;
      this.ready.catch(() => {});
      this.retry.finally(() => { this.retry = null; }).catch(() => {});
    }
    await this.ready;
  }

  private async init(connectionString: string): Promise<void> {
    // Lazy import so `pg` is only loaded when a Postgres backend is selected.
    const pg = await import("pg");
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    this.pool = new Pool({ connectionString, max: 10 });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS public.audit_ledger (
          seq        BIGSERIAL PRIMARY KEY,
          id         TEXT NOT NULL,
          ts         TIMESTAMPTZ NOT NULL,
          request_id TEXT,
          actor      JSONB NOT NULL,
          event_type TEXT NOT NULL,
          target     JSONB,
          meta       JSONB,
          prev_hash  TEXT NOT NULL,
          hash       TEXT NOT NULL
        );
      `);
    } catch (err) {
      // Under the role split the runtime credential holds NO DDL privilege, and
      // PostgreSQL rejects even CREATE TABLE IF NOT EXISTS without CREATE on the
      // schema — before checking whether the table exists. A denied bootstrap is
      // FINE exactly when migrations already built the schema: verify that and
      // proceed. A denied bootstrap over a missing table is a misconfiguration,
      // named precisely instead of surfacing as a bare permission error.
      if ((err as { code?: string }).code !== "42501") throw err;
      const probe = await this.pool.query("SELECT to_regclass('public.audit_ledger') IS NOT NULL AS ok");
      if (!probe.rows[0]?.ok) {
        throw new Error(
          "audit_ledger does not exist and this credential may not create it — " +
            "run `pnpm run db:migrate` with the admin credential first (the runtime role owns no schema).",
        );
      }
      // Existence is not usability: the appender needs SELECT (chain head) +
      // INSERT + USAGE on the seq sequence, and nothing else. Verify exactly
      // that, so missing grants read as "not ready" here instead of a 42501
      // on the first append — which for the LEDGER would mean decisions
      // happening without their audit trail.
      await this.assertPrivileges();
    }
  }

  /** The exact privileges appendWithChain needs; also run on every ping() so
   *  /readyz flips when the posture regresses mid-flight. */
  private async assertPrivileges(): Promise<void> {
    const priv = await this.pool.query(`
      SELECT has_table_privilege('public.audit_ledger', 'SELECT')
         AND has_table_privilege('public.audit_ledger', 'INSERT')
         AND has_sequence_privilege(pg_get_serial_sequence('public.audit_ledger', 'seq'), 'USAGE') AS ok,
             has_any_column_privilege('public.audit_ledger', 'UPDATE')
          OR has_table_privilege('public.audit_ledger', 'DELETE')
          OR has_table_privilege('public.audit_ledger', 'TRUNCATE')
          -- sequence UPDATE means setval(): the append counter could be wedged
          OR has_sequence_privilege(pg_get_serial_sequence('public.audit_ledger', 'seq'), 'UPDATE') AS forbidden
    `);
    if (!priv.rows[0]?.ok) {
      throw new Error(
        "this credential is missing privileges on audit_ledger (or its sequence) — re-apply the " +
          "role split with the admin credential (`pnpm run db:migrate`); refusing to report ready " +
          "for appends that would fail.",
      );
    }
    // The append-only boundary is a NEGATIVE claim, so readiness must also
    // check the forbidden direction: a grant of UPDATE (table- or
    // column-level), DELETE, or TRUNCATE that appears under a running process
    // means the ledger is rewritable — that is not a ready state for a
    // tamper-evidence component, whatever the required privileges say.
    if (priv.rows[0]?.forbidden) {
      throw new Error(
        "this credential holds FORBIDDEN privileges on audit_ledger (UPDATE, DELETE, or TRUNCATE — " +
          "directly, via PUBLIC, or column-level): the ledger would not be append-only. Re-apply the " +
          "role split with the admin credential (`pnpm run db:migrate`); refusing to report ready.",
      );
    }
  }

  async ping(): Promise<void> {
    await this.ensureReady();
    await this.pool.query("SELECT 1");
    await this.assertPrivileges();
  }

  async appendWithChain(build: (prevHash: string) => AuditRecord): Promise<AuditRecord> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize the critical section across all writers.
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);
      const head = await client.query(
        "SELECT hash FROM public.audit_ledger ORDER BY seq DESC LIMIT 1",
      );
      const prevHash: string = head.rows[0]?.hash ?? "";
      const record = build(prevHash);
      await client.query(
        `INSERT INTO public.audit_ledger
           (id, ts, request_id, actor, event_type, target, meta, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          record.id,
          record.ts,
          record.requestId ?? null,
          JSON.stringify(record.actor),
          record.eventType,
          record.target ? JSON.stringify(record.target) : null,
          record.meta ? JSON.stringify(record.meta) : null,
          record.prevHash,
          record.hash,
        ],
      );
      await client.query("COMMIT");
      return record;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getRecords(limit: number, offset: number): Promise<AuditRecord[]> {
    await this.ensureReady();
    const res = await this.pool.query(
      `SELECT id, ts, request_id, actor, event_type, target, meta, prev_hash, hash
         FROM public.audit_ledger ORDER BY seq ASC OFFSET $1 LIMIT $2`,
      [offset, limit],
    );
    return res.rows.map((r: any): AuditRecord => ({
      id: r.id,
      // node-postgres returns TIMESTAMPTZ as a Date; re-serialize to the exact
      // ISO string the hash was computed over so verifyLedger recomputes equal.
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      requestId: r.request_id ?? undefined,
      actor: r.actor,
      eventType: r.event_type,
      target: r.target ?? undefined,
      meta: r.meta ?? undefined,
      prevHash: r.prev_hash,
      hash: r.hash,
    }));
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

// ── gated selector ──────────────────────────────────────────────────────────
let backend: AuditBackend | null = null;

/**
 * The active ledger backend. Fail-safe default is in-memory; Postgres is used
 * ONLY when DATABASE_URL is set. Cached after first selection.
 */
export function getAuditBackend(): AuditBackend {
  if (backend) return backend;
  const url = process.env.DATABASE_URL;
  backend = url ? new PostgresAuditBackend(url) : new InMemoryAuditBackend();
  return backend;
}

/** Test/tooling hook: swap the backend explicitly (e.g. to point at a test DB). */
export function setAuditBackend(b: AuditBackend | null): void {
  backend = b;
}
