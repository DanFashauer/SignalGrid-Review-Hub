// Durable decision + evidence store (production persistence).
//
// The decision CORE stays pure and in-memory: it computes a decision
// deterministically with no I/O, which is what the proofs depend on. This store
// sits BESIDE the core as a durable sink — when DATABASE_URL is set, each
// computed decision and its evidence snapshot are persisted for retention and
// query, and the read paths serve from the database so records survive a
// restart. When DATABASE_URL is unset, `getDecisionStore()` returns null and the
// caller uses the core's in-memory store exactly as before (fixture-safe default).
//
// Tenant isolation is preserved structurally: every row carries `tenant_id`, and
// every single-object read is keyed on `(id, tenant_id)` — a decision is never
// looked up by id alone, mirroring the in-memory store's invariant.

import type { Decision, EvidenceSnapshot } from "@workspace/signalgrid-core";

export interface DecisionStore {
  /** Persist a decision and its evidence snapshot (idempotent upsert). */
  saveDecision(decision: Decision, snapshot: EvidenceSnapshot): Promise<void>;
  /** A decision by id, ONLY if it belongs to the tenant (else null). */
  getDecision(tenantId: string, id: string): Promise<Decision | null>;
  /** A tenant's decisions, newest first. */
  listDecisions(tenantId: string, limit?: number): Promise<Decision[]>;
  /** An evidence snapshot by id, ONLY if it belongs to the tenant (else null). */
  getSnapshot(tenantId: string, id: string): Promise<EvidenceSnapshot | null>;
  /**
   * Round-trip the backing store (a real query, not a cached answer). Rejects
   * when the store is configured but unreachable — which is exactly the state
   * `/readyz` exists to expose, so this must never swallow the failure.
   */
  ping?(): Promise<void>;
  close?(): Promise<void>;
}

export class PostgresDecisionStore implements DecisionStore {
  private pool: any;
  private ready: Promise<void>;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.ready = this.init(connectionString);
  }

  /**
   * A REJECTED first init must not poison the store forever — a review finding,
   * and the scenario is mundane: the pod boots before the database, the first
   * request's CREATE TABLE rejects, and `this.ready` becomes a permanently
   * cached rejection. Every later call — including /readyz's "probe" — then
   * awaits the same stale failure while the recovered database sits reachable,
   * and only a process restart heals it (which liveness-keyed orchestration
   * never triggers, because /healthz stays green). So: a failed init is
   * RETRIED on next use, after tearing down any half-built pool. A probe is
   * only a probe if it can change its answer.
   */
  private async ensureReady(): Promise<void> {
    try {
      await this.ready;
    } catch {
      if (this.pool) {
        try { await this.pool.end(); } catch { /* the old pool may already be dead */ }
        this.pool = undefined;
      }
      this.ready = this.init(this.connectionString);
      await this.ready;
    }
  }

  private async init(connectionString: string): Promise<void> {
    const pg = await import("pg");
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    this.pool = new Pool({ connectionString, max: 10 });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS decisions (
          id         TEXT PRIMARY KEY,
          tenant_id  TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          outcome    TEXT NOT NULL,
          data       JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS decisions_tenant_created_idx
          ON decisions (tenant_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS evidence_snapshots (
          id          TEXT PRIMARY KEY,
          tenant_id   TEXT NOT NULL,
          decision_id TEXT NOT NULL,
          data        JSONB NOT NULL
        );
      `);
    } catch (err) {
      // Under the role split the runtime credential holds NO DDL privilege, and
      // PostgreSQL rejects even CREATE TABLE IF NOT EXISTS without CREATE on the
      // schema. A denied bootstrap is fine exactly when migrations already built
      // the schema: verify that and proceed; otherwise name the real remedy.
      if ((err as { code?: string }).code !== "42501") throw err;
      const probe = await this.pool.query(
        "SELECT to_regclass('public.decisions') IS NOT NULL AND to_regclass('public.evidence_snapshots') IS NOT NULL AS ok",
      );
      if (!probe.rows[0]?.ok) {
        throw new Error(
          "decisions/evidence_snapshots do not exist and this credential may not create them — " +
            "run `pnpm run db:migrate` with the admin credential first (the runtime role owns no schema).",
        );
      }
    }
  }

  async saveDecision(decision: Decision, snapshot: EvidenceSnapshot): Promise<void> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO decisions (id, tenant_id, created_at, outcome, data)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, outcome = EXCLUDED.outcome`,
        [decision.id, decision.tenantId, decision.createdAt, decision.outcome, JSON.stringify(decision)],
      );
      await client.query(
        `INSERT INTO evidence_snapshots (id, tenant_id, decision_id, data)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [snapshot.id, snapshot.tenantId, snapshot.decisionId, JSON.stringify(snapshot)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getDecision(tenantId: string, id: string): Promise<Decision | null> {
    await this.ensureReady();
    // Keyed on (id, tenant_id): a cross-tenant id returns nothing.
    const res = await this.pool.query(
      "SELECT data FROM decisions WHERE id = $1 AND tenant_id = $2",
      [id, tenantId],
    );
    return res.rows[0] ? (res.rows[0].data as Decision) : null;
  }

  async listDecisions(tenantId: string, limit = 100): Promise<Decision[]> {
    await this.ensureReady();
    const res = await this.pool.query(
      "SELECT data FROM decisions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2",
      [tenantId, limit],
    );
    return res.rows.map((r: any) => r.data as Decision);
  }

  async getSnapshot(tenantId: string, id: string): Promise<EvidenceSnapshot | null> {
    await this.ensureReady();
    const res = await this.pool.query(
      "SELECT data FROM evidence_snapshots WHERE id = $1 AND tenant_id = $2",
      [id, tenantId],
    );
    return res.rows[0] ? (res.rows[0].data as EvidenceSnapshot) : null;
  }

  async ping(): Promise<void> {
    await this.ensureReady();
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

// ── gated selector ──────────────────────────────────────────────────────────
let store: DecisionStore | null | undefined;

/**
 * The durable decision store, or null when durable persistence is off (no
 * DATABASE_URL) — in which case the caller uses the core's in-memory store.
 * Fail-safe default is off; cached after first call.
 */
export function getDecisionStore(): DecisionStore | null {
  if (store !== undefined) return store;
  const url = process.env.DATABASE_URL;
  store = url ? new PostgresDecisionStore(url) : null;
  return store;
}

/** Test/tooling hook: set the store explicitly (e.g. point at a test DB). */
export function setDecisionStore(s: DecisionStore | null): void {
  store = s;
}
