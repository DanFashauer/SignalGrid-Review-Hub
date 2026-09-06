// Session lifecycle store (production persistence).
//
// A session is a worker's active working period on a (shared) device: it is
// STARTED after a decision gates it, REFRESHED as the worker keeps using the
// device, and ENDS on sign-out or EXPIRES when its TTL lapses. Unlike the
// decision core (pure, in-memory, deterministic), sessions are inherently
// clock-aware, so this store lives beside the core, not inside it.
//
// Backends: in-memory by default (the fixture build has working sessions) and
// Postgres when DATABASE_URL is set (durable across restarts). Every read is
// keyed on (id, tenant_id) so a session is never reachable cross-tenant.
//
// Time is injectable (`nowMs`) so lifecycle/expiry is tested deterministically
// without sleeping; it defaults to Date.now() at the call site.

import type { DecisionOutcome } from "@workspace/signalgrid-core";

export type SessionStatus = "active" | "expired" | "ended";

export interface Session {
  id: string;
  tenantId: string;
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
  status: SessionStatus;
  outcome: DecisionOutcome;
  decisionId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SessionStore {
  /** Persist a newly-started session. */
  start(session: Session): Promise<void>;
  /** A session by id (only within the tenant), with expiry applied as of nowMs. */
  get(tenantId: string, id: string, nowMs: number): Promise<Session | null>;
  /** Extend an ACTIVE, unexpired session's TTL; returns the refreshed session, or
   *  null when there is nothing to refresh — unknown, another tenant's, expired or
   *  ended. It used to return the expired/ended session object itself, so the
   *  route answered 200 and wrote a `session.refresh` audit row for a refresh that
   *  never happened. */
  refresh(tenantId: string, id: string, ttlSeconds: number, nowMs: number): Promise<Session | null>;
  /** End a session (sign-out). Returns the ended session or null. */
  end(tenantId: string, id: string): Promise<Session | null>;
  /**
   * Round-trip readiness probe (durable backends only). Resolves when the
   * store can actually do its work — connection AND privileges — and rejects
   * otherwise, so /readyz reflects fitness rather than mere liveness.
   */
  ping?(): Promise<void>;
  close?(): Promise<void>;
}

// Apply lazy expiry: an active session past its expiry reads back as "expired".
function withExpiry(s: Session, nowMs: number): Session {
  // An unparseable expiresAt must read as EXPIRED. Reported honestly: the shipped
  // schema makes this LATENT rather than live — `expires_at` is TIMESTAMPTZ NOT
  // NULL in both the migration and the inline DDL, and `pg` hands back a Date, so
  // no path on the current schema reaches the `String(v)` fallback in `iso()`
  // that would produce "null"/"undefined". It is fixed anyway: the guard costs
  // one comparison, and "unreachable today" is a property of the schema, not of
  // this function.
  const expiresAtMs = Date.parse(s.expiresAt);
  // freshness: local-by-design — not the sighting-freshness rule — an EXPIRY/TTL comparison, where an unreadable bound must read EXPIRED (null-maps the opposite way); its gate is check-nan-fail-open.mjs — session expiry
  if (s.status === "active" && (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs)) {
    return { ...s, status: "expired" };
  }
  return s;
}

// ── in-memory (default, fixture-safe) ───────────────────────────────────────
export class InMemorySessionStore implements SessionStore {
  private byId = new Map<string, Session>();

  async start(session: Session): Promise<void> {
    this.byId.set(session.id, { ...session });
  }

  async get(tenantId: string, id: string, nowMs: number): Promise<Session | null> {
    const s = this.byId.get(id);
    if (!s || s.tenantId !== tenantId) return null;
    const applied = withExpiry(s, nowMs);
    if (applied.status !== s.status) this.byId.set(id, applied); // persist transition
    return applied;
  }

  async refresh(tenantId: string, id: string, ttlSeconds: number, nowMs: number): Promise<Session | null> {
    const current = await this.get(tenantId, id, nowMs);
    if (!current || current.status !== "active") return null;
    const next: Session = {
      ...current,
      lastSeenAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
    };
    this.byId.set(id, next);
    return next;
  }

  async end(tenantId: string, id: string): Promise<Session | null> {
    const s = this.byId.get(id);
    if (!s || s.tenantId !== tenantId) return null;
    const ended: Session = { ...s, status: "ended" };
    this.byId.set(id, ended);
    return ended;
  }
}

// ── Postgres (durable; used only when DATABASE_URL is set) ───────────────────
export class PostgresSessionStore implements SessionStore {
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
    const pg = await import("pg");
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    this.pool = new Pool({ connectionString, max: 10 });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS public.sessions (
          id           TEXT PRIMARY KEY,
          tenant_id    TEXT NOT NULL,
          identity_ref TEXT NOT NULL,
          device_ref   TEXT NOT NULL,
          workflow_key TEXT NOT NULL,
          status       TEXT NOT NULL,
          outcome      TEXT NOT NULL,
          decision_id  TEXT NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL,
          expires_at   TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_tenant_idx ON public.sessions (tenant_id);
      `);
    } catch (err) {
      // Under the role split the runtime credential holds NO DDL privilege, and
      // PostgreSQL rejects even CREATE TABLE IF NOT EXISTS without CREATE on the
      // schema. A denied bootstrap is fine exactly when migrations already built
      // the schema: verify that and proceed; otherwise name the real remedy.
      if ((err as { code?: string }).code !== "42501") throw err;
      const probe = await this.pool.query("SELECT to_regclass('public.sessions') IS NOT NULL AS ok");
      if (!probe.rows[0]?.ok) {
        throw new Error(
          "sessions does not exist and this credential may not create it — " +
            "run `pnpm run db:migrate` with the admin credential first (the runtime role owns no schema).",
        );
      }
      // Existence is not usability: verify the exact privileges the store's
      // statements need (lifecycle transitions are UPDATEs), so missing grants
      // surface here as "not ready" instead of as a 42501 mid-request.
      await this.assertPrivileges();
    }
    // And usability is not SHAPE — see decision-store.ts assertSchema.
    await this.assertSchema();
  }

  /** Every column the store's statements bind. */
  private static readonly BOUND_COLUMNS = [
    "id", "tenant_id", "identity_ref", "device_ref", "workflow_key", "status", "outcome",
    "decision_id", "created_at", "last_seen_at", "expires_at",
  ];

  private async assertSchema(): Promise<void> {
    const res = await this.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions'`,
    );
    const present = new Set(res.rows.map((r: any) => String(r.column_name)));
    const missing = PostgresSessionStore.BOUND_COLUMNS.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new Error(
        `sessions is missing column(s) ${missing.join(", ")} — the schema is behind the code. ` +
          "Run `pnpm run db:migrate` with the admin credential; refusing to report ready for statements that would fail.",
      );
    }
  }

  /** The exact per-table privileges the store's statements need; also run on
   *  every ping() so /readyz flips when the posture regresses mid-flight. */
  private async assertPrivileges(): Promise<void> {
    const priv = await this.pool.query(`
      SELECT has_table_privilege('public.sessions', 'SELECT')
         AND has_table_privilege('public.sessions', 'INSERT')
         AND has_table_privilege('public.sessions', 'UPDATE') AS ok
    `);
    if (!priv.rows[0]?.ok) {
      throw new Error(
        "this credential is missing table privileges on sessions — re-apply the role split " +
          "with the admin credential (`pnpm run db:migrate`); refusing to report ready for work that would fail.",
      );
    }
  }

  async ping(): Promise<void> {
    await this.ensureReady();
    await this.pool.query("SELECT 1");
    await this.assertPrivileges();
    await this.assertSchema();
  }

  private rowToSession(r: any): Session {
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));
    return {
      id: r.id,
      tenantId: r.tenant_id,
      identityRef: r.identity_ref,
      deviceRef: r.device_ref,
      workflowKey: r.workflow_key,
      status: r.status as SessionStatus,
      outcome: r.outcome as DecisionOutcome,
      decisionId: r.decision_id,
      createdAt: iso(r.created_at),
      lastSeenAt: iso(r.last_seen_at),
      expiresAt: iso(r.expires_at),
    };
  }

  async start(s: Session): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO public.sessions
         (id, tenant_id, identity_ref, device_ref, workflow_key, status, outcome, decision_id, created_at, last_seen_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.tenantId, s.identityRef, s.deviceRef, s.workflowKey, s.status, s.outcome, s.decisionId, s.createdAt, s.lastSeenAt, s.expiresAt],
    );
  }

  async get(tenantId: string, id: string, nowMs: number): Promise<Session | null> {
    await this.ensureReady();
    const res = await this.pool.query(
      "SELECT * FROM public.sessions WHERE id = $1 AND tenant_id = $2",
      [id, tenantId],
    );
    if (!res.rows[0]) return null;
    const s = this.rowToSession(res.rows[0]);
    const applied = withExpiry(s, nowMs);
    if (applied.status !== s.status) {
      await this.pool.query("UPDATE public.sessions SET status = $1 WHERE id = $2 AND tenant_id = $3", [applied.status, id, tenantId]);
    }
    return applied;
  }

  async refresh(tenantId: string, id: string, ttlSeconds: number, nowMs: number): Promise<Session | null> {
    await this.ensureReady();
    const current = await this.get(tenantId, id, nowMs);
    if (!current || current.status !== "active") return null;
    const lastSeenAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    await this.pool.query(
      "UPDATE public.sessions SET last_seen_at = $1, expires_at = $2 WHERE id = $3 AND tenant_id = $4",
      [lastSeenAt, expiresAt, id, tenantId],
    );
    return { ...current, lastSeenAt, expiresAt };
  }

  async end(tenantId: string, id: string): Promise<Session | null> {
    await this.ensureReady();
    const res = await this.pool.query(
      "UPDATE public.sessions SET status = 'ended' WHERE id = $1 AND tenant_id = $2 RETURNING *",
      [id, tenantId],
    );
    return res.rows[0] ? this.rowToSession(res.rows[0]) : null;
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

// ── gated selector (in-memory default; Postgres when DATABASE_URL is set) ────
let store: SessionStore | undefined;

export function getSessionStore(): SessionStore {
  if (store) return store;
  const url = process.env.DATABASE_URL;
  store = url ? new PostgresSessionStore(url) : new InMemorySessionStore();
  return store;
}

export function setSessionStore(s: SessionStore): void {
  store = s;
}
