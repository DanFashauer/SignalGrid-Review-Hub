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
  const prev = store.lastAudit(input.tenantId);
  const prevDigest = prev ? prev.digest : GENESIS_DIGEST;
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
}

/** Verify a tenant's audit chain end-to-end by recomputing every digest. */
export function verifyAuditChain(
  store: MemoryStore,
  tenantId: string,
): ChainVerification {
  const events = store.listAudit(tenantId);
  let prevDigest = GENESIS_DIGEST;
  for (const event of events) {
    if (event.prevDigest !== prevDigest) {
      return { valid: false, brokenAtSeq: event.seq, length: events.length };
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
      return { valid: false, brokenAtSeq: event.seq, length: events.length };
    }
    prevDigest = event.digest;
  }
  return { valid: true, brokenAtSeq: null, length: events.length };
}
