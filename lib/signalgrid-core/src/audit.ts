import type { MemoryStore } from "./store";
import { canonicalJson, deterministicId, digest } from "./util";
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
}

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
  const prevDigest = store.lastAuditDigest(input.tenantId) ?? GENESIS_DIGEST;
  const seq = store.nextAuditSeq(input.tenantId);

  const body = canonicalJson({
    tenantId: input.tenantId,
    seq,
    type: input.type,
    actor: input.actor,
    subject: input.subject,
    summary: input.summary,
    references: input.references,
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
    references: input.references,
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
