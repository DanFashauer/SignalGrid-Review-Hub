import type { MemoryStore } from "./store";
import { canonicalJson, deterministicId, digest } from "./util";
import { CoreError, PUCK_LIFECYCLE_EVENT_TYPES, isAuditEventType } from "./types";
import type { AuditEvent, AuditEventType } from "./types";

export const GENESIS_DIGEST = "genesis";

export interface AppendAuditInput {
  tenantId: string;
  type: AuditEventType;
  actor: string;
  subject: string;
  summary: string;
  references: string[];
  recordedAt: string;
  /**
   * The decision this event evidences. REQUIRED for the puck-lifecycle types and
   * optional for the original six, whose callers already carry the decision id in
   * `references` and whose digests must not move.
   *
   * It is folded into `references` rather than into the digested body for exactly that
   * reason: adding a field to the canonical body would change every existing event's
   * digest and break chains that are already committed.
   */
  decisionId?: string;
}

const PUCK_TYPES: readonly string[] = PUCK_LIFECYCLE_EVENT_TYPES;

/** Blank means blank — an all-whitespace subject is not a subject. */
const blank = (value: unknown): boolean => typeof value !== "string" || value.trim().length === 0;

/**
 * Append a tamper-evident audit event to a tenant's chain. Each event's digest
 * covers the previous event's digest plus the canonical event body, so any
 * retroactive edit breaks the chain from that point forward. The chain is
 * strictly tenant-scoped: one tenant's events never reference another's.
 */
export function appendAudit(
  store: MemoryStore,
  input: AppendAuditInput,
): AuditEvent {
  // FAIL-CLOSED ADMISSION, and the reason it is here rather than at each call site:
  // there is one writer into the chain, so one guard covers every caller. A refused
  // event is NOT recorded — a blank row in a tamper-evident ledger is worse than an
  // absent one, because it is evidence-shaped and evidences nothing.
  if (!isAuditEventType(input.type)) {
    throw new CoreError("validation", `Unknown audit event type: ${String(input.type)}`, 400);
  }
  if (blank(input.subject)) {
    throw new CoreError("validation", `Audit event ${input.type} names no subject.`, 400);
  }
  const references =
    PUCK_TYPES.includes(input.type) && !blank(input.decisionId)
      ? [input.decisionId as string, ...input.references.filter((r) => r !== input.decisionId)]
      : input.references;
  if (PUCK_TYPES.includes(input.type) && blank(input.decisionId)) {
    throw new CoreError(
      "validation",
      `Audit event ${input.type} names no decision — a lifecycle event with no decision behind it is a log line, not a ledger entry.`,
      400,
    );
  }

  const prevDigest = store.lastAuditDigest(input.tenantId) ?? GENESIS_DIGEST;
  const seq = store.nextAuditSeq(input.tenantId);

  const body = canonicalJson({
    tenantId: input.tenantId,
    seq,
    type: input.type,
    actor: input.actor,
    subject: input.subject,
    summary: input.summary,
    references,
    recordedAt: input.recordedAt,
    prevDigest,
  });

  const event: AuditEvent = {
    id: deterministicId("aud", input.tenantId, String(seq)),
    tenantId: input.tenantId,
    seq,
    type: input.type,
    actor: input.actor,
    subject: input.subject,
    summary: input.summary,
    references,
    recordedAt: input.recordedAt,
    prevDigest,
    digest: digest(body),
  };
  store.appendAudit(event);
  return event;
}

export interface ChainVerification {
  valid: boolean;
  brokenAtSeq: number | null;
  length: number;
  /** True once the memory bound evicted the chain's oldest events: a truncated
   *  `valid: true` covers the RETAINED window only, never the whole history. */
  truncated: boolean;
  /** How many events the memory bound has evicted for this tenant (0 when untruncated). */
  evictedCount: number;
}

/** Verify a tenant's audit chain by recomputing every digest. Past an eviction it
 *  anchors on the last EVICTED digest, not GENESIS (which would read as BROKEN), and
 *  says so via `truncated` — dropping the anchor would accept any suffix as intact. */
export function verifyAuditChain(
  store: MemoryStore,
  tenantId: string,
): ChainVerification {
  const events = store.listAudit(tenantId);
  const eviction = store.auditEviction(tenantId);
  const truncated = eviction !== undefined;
  const evictedCount = eviction?.count ?? 0;
  let prevDigest = eviction ? eviction.lastDigest : GENESIS_DIGEST;
  for (const event of events) {
    if (event.prevDigest !== prevDigest) {
      return { valid: false, brokenAtSeq: event.seq, length: events.length, truncated, evictedCount };
    }
    const body = canonicalJson({
      tenantId: event.tenantId,
      seq: event.seq,
      type: event.type,
      actor: event.actor,
      subject: event.subject,
      summary: event.summary,
      references: event.references,
      recordedAt: event.recordedAt,
      prevDigest: event.prevDigest,
    });
    if (digest(body) !== event.digest) {
      return { valid: false, brokenAtSeq: event.seq, length: events.length, truncated, evictedCount };
    }
    prevDigest = event.digest;
  }
  return { valid: true, brokenAtSeq: null, length: events.length, truncated, evictedCount };
}
