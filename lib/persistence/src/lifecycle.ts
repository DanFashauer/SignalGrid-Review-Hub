// Data lifecycle — retention, erasure and DSAR export over the DURABLE stores.
//
// WHAT WAS MISSING. DR-003 records that no durable store had a retention mechanism:
// a decision, its evidence snapshot and the caller-supplied `requestContext` inside it
// were written once and kept forever, and there was no path to remove a subject's
// records at all. "We will honour a deletion request" was a sentence in a document
// with nothing behind it, which is the defect class this repository exists to remove.
//
// THE FOUR RULES THIS MODULE IS BUILT ON, each of which shapes an interface below.
//
// 1. THE AUDIT CHAIN IS NEVER EDITED. The ledger is append-only BY PRIVILEGE
//    (lib/persistence/src/role-split.ts: "No DELETE anywhere"), and that is not an
//    obstacle to work around — it is the property that makes the ledger worth having.
//    Erasure therefore APPENDS a tombstone: a record saying what was removed, how
//    much, and when. `verifyLedgerFull()` passes before and after, because nothing
//    was taken out. A deletion that broke the chain would destroy the evidence that
//    the deletion happened.
//
// 2. THE TOMBSTONE CARRIES NO SUBJECT IDENTIFIER. This is the rule that is easy to
//    get backwards. Writing "erased all records for user X" into an append-only
//    ledger, in response to a request to erase user X, creates a NEW permanent copy
//    of the identifier you were asked to remove — in the one store you cannot edit.
//    A hash is no better: subject refs are low-entropy (an email, a UPN), so a digest
//    of one is reversible by guessing. The tombstone therefore records the erasure
//    request's own opaque id, the counts per store, and the tenant. What it proves is
//    that an erasure of that size happened; WHO it was for lives in the operator's
//    own request record, outside this system.
//
// 3. AN UNREADABLE POLICY SHORTENS, NEVER LENGTHENS. Every other fallback in this
//    codebase resolves toward "refuse"; retention is the one place where the
//    conservative direction is the opposite of "keep more". An invalid per-tenant
//    override falls back to the DEFAULT window, never to unbounded, because data kept
//    past its window is the harm here.
//
// 4. THE RUNTIME CREDENTIAL CANNOT DO ANY OF THIS, and must not be able to. The role
//    split grants the API's `signalgrid_runtime` role no DELETE on any table. So this
//    is an ADMIN-CREDENTIAL JOB by construction: the caller supplies the connection,
//    and `PostgresLifecycleStore` refuses with the real remedy rather than reporting
//    a successful run that deleted nothing. No route serves any of this, and none
//    should — see docs/DATA_RETENTION_AND_PERSONAL_DATA.md.

import { appendAuditRecord } from "@workspace/audit";

/** How long each class of durable record is kept, per tenant. */
export interface RetentionPolicy {
  /** Decisions and their evidence snapshots. */
  decisionDays: number;
  /**
   * The caller-supplied `requestContext` INSIDE a decision — deliberately shorter
   * than the decision itself. It is the only free-form, caller-controlled field the
   * durable store holds, so it is the one most likely to carry something nobody
   * intended; the decision's own fields (ids, outcome, reason codes) carry the
   * operational value and outlive it.
   */
  requestContextDays: number;
}

/**
 * The default window, and it applies to every tenant that has not been given its own.
 * 400 days is thirteen months: long enough that a yearly audit can look back a full
 * cycle, short enough to be a window rather than a synonym for forever. 30 days for
 * request context, for the reason above.
 */
export const DEFAULT_RETENTION: RetentionPolicy = { decisionDays: 400, requestContextDays: 30 };

/** A per-tenant override. Partial: an absent field keeps the default's. */
export type RetentionOverrides = Readonly<Record<string, Partial<RetentionPolicy>>>;

function validDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650;
}

/**
 * The policy in force for a tenant. An override field that is not a positive integer
 * of at most ten years falls back to the DEFAULT — never to unbounded, and never to
 * "keep it until someone notices" (rule 3).
 */
export function retentionFor(tenantId: string, overrides: RetentionOverrides = {}): RetentionPolicy {
  const override = overrides[tenantId] ?? {};
  return {
    decisionDays: validDays(override.decisionDays) ? override.decisionDays : DEFAULT_RETENTION.decisionDays,
    requestContextDays: validDays(override.requestContextDays)
      ? override.requestContextDays
      : DEFAULT_RETENTION.requestContextDays,
  };
}

/** The cutoff instant for a window, computed from a clock the CALLER reads. */
export function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** One durable decision, as much of it as the lifecycle paths need. */
export interface LifecycleDecision {
  id: string;
  tenantId: string;
  identityId: string;
  createdAt: string;
  outcome: string;
  evidenceSnapshotId: string;
  requestContext: Record<string, string>;
}

/**
 * The durable operations retention, erasure and export need.
 *
 * An interface rather than a concrete class because the POLICY above is what has to
 * be provable, and it is provable offline; the SQL underneath is not (there is no
 * database in CI). `proof:data-lifecycle` drives every rule through an in-memory
 * implementation and the REAL audit ledger, so the chain assertions are not
 * simulated. What the proof does NOT cover is named in the doc rather than implied.
 */
export interface LifecycleStore {
  /** Every decision this tenant holds for one subject, oldest first. */
  findByIdentity(tenantId: string, identityId: string): Promise<LifecycleDecision[]>;
  /** Decisions created strictly before `before`. */
  findOlderThan(tenantId: string, before: string): Promise<LifecycleDecision[]>;
  /** Delete decisions AND their evidence snapshots. Returns what it removed. */
  deleteDecisions(tenantId: string, ids: readonly string[]): Promise<{ decisions: number; snapshots: number }>;
  /** Blank the requestContext of these decisions, leaving the decisions themselves. */
  clearRequestContext(tenantId: string, ids: readonly string[]): Promise<number>;
}

export interface RetentionRun {
  tenantId: string;
  policy: RetentionPolicy;
  ranAt: string;
  decisionsDeleted: number;
  snapshotsDeleted: number;
  requestContextsCleared: number;
}

/**
 * Apply a tenant's retention windows. Two passes, in this order and not the other:
 * expired DECISIONS go first, then request context is cleared on what remains — so a
 * decision that was about to be deleted is not first rewritten and then removed, and
 * the counts do not double-report the same row.
 *
 * `now` is passed in. Wall time is read by the job at its boundary, never here.
 */
export async function applyRetention(
  store: LifecycleStore,
  tenantId: string,
  now: Date,
  overrides: RetentionOverrides = {},
): Promise<RetentionRun> {
  const policy = retentionFor(tenantId, overrides);
  const ranAt = now.toISOString();

  const expired = await store.findOlderThan(tenantId, cutoff(now, policy.decisionDays));
  const removed = expired.length > 0
    ? await store.deleteDecisions(tenantId, expired.map((d) => d.id))
    : { decisions: 0, snapshots: 0 };

  const staleContext = (await store.findOlderThan(tenantId, cutoff(now, policy.requestContextDays)))
    // Only rows that still HOLD context: clearing an already-empty one is a write
    // with no effect that would inflate the reported figure into a false measure of
    // how much personal data this run actually removed.
    .filter((d) => Object.keys(d.requestContext).length > 0);
  const cleared = staleContext.length > 0
    ? await store.clearRequestContext(tenantId, staleContext.map((d) => d.id))
    : 0;

  const run: RetentionRun = {
    tenantId,
    policy,
    ranAt,
    decisionsDeleted: removed.decisions,
    snapshotsDeleted: removed.snapshots,
    requestContextsCleared: cleared,
  };
  await appendAuditRecord("data.retention.applied", { type: "system" }, {
    tenantId,
    target: { type: "tenant", id: tenantId },
    meta: {
      decisionDays: policy.decisionDays,
      requestContextDays: policy.requestContextDays,
      decisionsDeleted: run.decisionsDeleted,
      snapshotsDeleted: run.snapshotsDeleted,
      requestContextsCleared: run.requestContextsCleared,
    },
  });
  return run;
}

export interface ErasureReceipt {
  /** Opaque, supplied by the CALLER: it is the operator's own request id, and it is
   *  the only thing tying this tombstone to a person — outside this system. */
  requestId: string;
  tenantId: string;
  erasedAt: string;
  decisionsDeleted: number;
  snapshotsDeleted: number;
}

/**
 * Erase everything this system durably holds about one subject: their decisions,
 * those decisions' evidence snapshots, and the request context inside them (which
 * goes with the decision rows).
 *
 * The audit ledger is NOT touched — see rule 1 — and the tombstone appended in its
 * place carries the counts, the tenant and the caller's own request id, never the
 * subject (rule 2). A caller that passes a subject identifier AS the request id has
 * defeated that, so the receipt says plainly what the field is for and the proof
 * asserts the subject's ref appears nowhere in the ledger.
 */
export async function eraseSubject(
  store: LifecycleStore,
  tenantId: string,
  identityId: string,
  now: Date,
  requestId: string,
): Promise<ErasureReceipt> {
  if (requestId.trim() === "") {
    // An erasure with no request to point at is an erasure nobody can account for.
    throw new Error("eraseSubject: a request id is required — the tombstone has nothing else to name.");
  }
  const held = await store.findByIdentity(tenantId, identityId);
  const removed = held.length > 0
    ? await store.deleteDecisions(tenantId, held.map((d) => d.id))
    : { decisions: 0, snapshots: 0 };
  const erasedAt = now.toISOString();
  await appendAuditRecord("data.subject.erased", { type: "admin" }, {
    tenantId,
    target: { type: "tenant", id: tenantId },
    // Counts and the operator's request id ONLY. No identityId, no digest of one:
    // a digest of a low-entropy identifier is reversible by guessing, and this row
    // can never be edited or removed.
    meta: { requestId, decisionsDeleted: removed.decisions, snapshotsDeleted: removed.snapshots },
  });
  return { requestId, tenantId, erasedAt, decisionsDeleted: removed.decisions, snapshotsDeleted: removed.snapshots };
}

export interface DsarExport {
  tenantId: string;
  identityId: string;
  exportedAt: string;
  decisions: LifecycleDecision[];
  /** Stated IN the export, because a subject-access response that silently omits a
   *  store is the same defect as one that omits a field. */
  notIncluded: readonly string[];
}

/**
 * What this system holds about a subject, as a subject-access response.
 *
 * It exports the decisions (with their outcome, timestamps and the request context
 * still held) and NAMES what it does not export, rather than leaving the reader to
 * assume the list is everything:
 *
 *   · the append-only audit ledger. It is the tenant's tamper-evidence record, it
 *     carries ids and event types rather than the subject's data, and removing a row
 *     from it would break the chain that makes every other record trustworthy.
 *   · the in-memory core's decisions. They do not survive a restart and are bounded
 *     by SIGNALGRID_MAX_DECISIONS_PER_TENANT; there is nothing durable to export.
 *   · normalized posture. It is re-derived from the source system on every sync and
 *     is never persisted here at all — the source of record is the customer's own
 *     device-management plane, and there is no durable table for it to be exported
 *     from. (`generate-core-normalization-version.mjs`'s F8 floor exists to keep that
 *     true: the day this package gains such a table, the normalization stamp stops
 *     being honest across the sync/evaluate boundary.)
 *
 * An export is a READ. It appends nothing: a subject asking what is held must not
 * thereby cause a new record naming them to be written.
 */
export async function exportSubject(
  store: LifecycleStore,
  tenantId: string,
  identityId: string,
  now: Date,
): Promise<DsarExport> {
  return {
    tenantId,
    identityId,
    exportedAt: now.toISOString(),
    decisions: await store.findByIdentity(tenantId, identityId),
    notIncluded: [
      "The append-only audit ledger: the tenant's tamper-evidence record. It holds event types, ids and counts — not the subject's data — and a row cannot be removed without breaking the chain.",
      "The in-memory core's decisions: not durable, bounded by SIGNALGRID_MAX_DECISIONS_PER_TENANT, and gone on restart.",
      "Normalized posture: re-derived from the customer's own device-management source on every sync and never persisted here — there is no durable table for it to be exported from.",
    ],
  };
}

/**
 * The Postgres implementation.
 *
 * IT TAKES ITS OWN CONNECTION STRING, and that is the design rather than an
 * omission. The API's `signalgrid_runtime` role holds no DELETE on any table
 * (`role-split.ts`), so the served process structurally cannot run any of this — and
 * must not be able to, or "retention" becomes a capability every request handler has.
 * The caller is an operator job holding the ADMIN credential; no route constructs this
 * class and none should.
 *
 * `assertCanErase` runs before the first destructive statement and names the real
 * remedy. Without it a runtime credential would get `insufficient_privilege` from
 * inside a loop, halfway through, having reported nothing — and a retention run that
 * fails silently is indistinguishable from one that had nothing to do.
 */
export class PostgresLifecycleStore implements LifecycleStore {
  private pool: unknown;
  private readonly connectionString: string;
  private checked = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] ; rowCount: number }> {
    if (!this.pool) {
      const pg = await import("pg");
      const Pool = (pg as { default?: { Pool: new (c: unknown) => unknown }; Pool?: new (c: unknown) => unknown }).default?.Pool ??
        (pg as { Pool: new (c: unknown) => unknown }).Pool;
      this.pool = new Pool({ connectionString: this.connectionString, max: 2 });
    }
    return (this.pool as { query: (s: string, p: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> })
      .query(sql, params);
  }

  /** Refuse BEFORE deleting anything if this credential cannot delete. */
  private async assertCanErase(): Promise<void> {
    if (this.checked) return;
    const res = await this.query(
      `SELECT has_table_privilege('public.decisions', 'DELETE')
          AND has_table_privilege('public.evidence_snapshots', 'DELETE')
          AND has_table_privilege('public.decisions', 'UPDATE') AS ok`,
    );
    if (res.rows[0]?.["ok"] !== true) {
      throw new Error(
        "this credential cannot delete from decisions/evidence_snapshots — the data-lifecycle job needs the ADMIN " +
          "credential, not the signalgrid_runtime role (which holds no DELETE by design). Refusing rather than " +
          "reporting a retention run that removed nothing.",
      );
    }
    this.checked = true;
  }

  private static toDecision(row: Record<string, unknown>): LifecycleDecision {
    const data = row["data"] as Record<string, unknown>;
    return {
      id: String(data["id"]),
      tenantId: String(data["tenantId"]),
      identityId: String(data["identityId"] ?? ""),
      createdAt: String(data["createdAt"]),
      outcome: String(data["outcome"]),
      evidenceSnapshotId: String(data["evidenceSnapshotId"] ?? ""),
      requestContext: (data["requestContext"] ?? {}) as Record<string, string>,
    };
  }

  async findByIdentity(tenantId: string, identityId: string): Promise<LifecycleDecision[]> {
    // Keyed on (tenant_id, identityId) — the same isolation invariant every other
    // read holds: a subject id from another tenant returns nothing.
    const res = await this.query(
      "SELECT data FROM public.decisions WHERE tenant_id = $1 AND data->>'identityId' = $2 ORDER BY created_at ASC, id ASC",
      [tenantId, identityId],
    );
    return res.rows.map(PostgresLifecycleStore.toDecision);
  }

  async findOlderThan(tenantId: string, before: string): Promise<LifecycleDecision[]> {
    const res = await this.query(
      "SELECT data FROM public.decisions WHERE tenant_id = $1 AND created_at < $2 ORDER BY created_at ASC, id ASC",
      [tenantId, before],
    );
    return res.rows.map(PostgresLifecycleStore.toDecision);
  }

  async deleteDecisions(tenantId: string, ids: readonly string[]): Promise<{ decisions: number; snapshots: number }> {
    if (ids.length === 0) return { decisions: 0, snapshots: 0 };
    await this.assertCanErase();
    // Snapshots FIRST: a snapshot whose decision is gone is an orphan nothing can
    // interpret, and the reverse order leaves one behind if the second statement
    // fails. Both are keyed on tenant_id as well as the id list.
    const snaps = await this.query(
      "DELETE FROM public.evidence_snapshots WHERE tenant_id = $1 AND decision_id = ANY($2::text[])",
      [tenantId, ids],
    );
    const decs = await this.query("DELETE FROM public.decisions WHERE tenant_id = $1 AND id = ANY($2::text[])", [tenantId, ids]);
    return { decisions: decs.rowCount ?? 0, snapshots: snaps.rowCount ?? 0 };
  }

  async clearRequestContext(tenantId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.assertCanErase();
    // The decision stays; only the caller-supplied context is replaced, with an EMPTY
    // OBJECT rather than a removal — every reader expects the key to exist, and an
    // absent one would be indistinguishable from a decision written before the field.
    const res = await this.query(
      `UPDATE public.decisions SET data = jsonb_set(data, '{requestContext}', '{}'::jsonb)
        WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, ids],
    );
    return res.rowCount ?? 0;
  }

  async close(): Promise<void> {
    if (this.pool) await (this.pool as { end: () => Promise<void> }).end();
  }
}
