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

  constructor(connectionString: string) {
    this.ready = this.init(connectionString);
  }

  private async init(connectionString: string): Promise<void> {
    // Lazy import so `pg` is only loaded when a Postgres backend is selected.
    const pg = await import("pg");
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    this.pool = new Pool({ connectionString, max: 10 });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_ledger (
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
  }

  async appendWithChain(build: (prevHash: string) => AuditRecord): Promise<AuditRecord> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize the critical section across all writers.
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);
      const head = await client.query(
        "SELECT hash FROM audit_ledger ORDER BY seq DESC LIMIT 1",
      );
      const prevHash: string = head.rows[0]?.hash ?? "";
      const record = build(prevHash);
      await client.query(
        `INSERT INTO audit_ledger
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
    await this.ready;
    const res = await this.pool.query(
      `SELECT id, ts, request_id, actor, event_type, target, meta, prev_hash, hash
         FROM audit_ledger ORDER BY seq ASC OFFSET $1 LIMIT $2`,
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
