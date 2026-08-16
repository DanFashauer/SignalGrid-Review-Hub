import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getAuditBackend } from "./backend";
import type { AuditEventType, Actor, Target, AuditRecord } from "./types";

// Types live in ./types so the storage backends can share them without a cycle.
export type { AuditEventType, Actor, Target, AuditRecord } from "./types";
export {
  getAuditBackend,
  setAuditBackend,
  InMemoryAuditBackend,
  PostgresAuditBackend,
  type AuditBackend,
} from "./backend";

// Secret redaction keys
const SECRET_KEYS = [
  "token",
  "authorization",
  "secret",
  "key",
  "password",
  "jwt",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "signature",
  "hmac",
];

// Recurse through any value — arrays (at any depth) and nested objects — so a
// secret buried in array-valued metadata (e.g. headers: [{ authorization: … }])
// is redacted, not just top-level object members.
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object" && value !== null) return redactSecrets(value as Record<string, unknown>);
  return value;
}

// Redact secrets from metadata
function redactSecrets<T extends Record<string, unknown>>(meta: T): T {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    const isSecret = SECRET_KEYS.some((sk: string) => lowerKey.includes(sk));
    redacted[key] = isSecret ? "[REDACTED]" : redactValue(value);
  }
  return redacted as T;
}

// Canonical JSON stringify (stable key ordering)
function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) {
      parts.push(`"${key}":null`);
    } else if (typeof value === "string") {
      parts.push(`"${key}":"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`"${key}":${value}`);
    } else if (Array.isArray(value)) {
      parts.push(`"${key}":[${value.map((v) => JSON.stringify(v)).join(",")}]`);
    } else if (typeof value === "object") {
      parts.push(`"${key}":${canonicalize(value as Record<string, unknown>)}`);
    }
  }
  return `{${parts.join(",")}}`;
}

// Compute hash for a record (without the hash field)
function computeHash(recordWithoutHash: Omit<AuditRecord, "hash">, prevHash: string): string {
  const payload = canonicalize({ ...recordWithoutHash, prevHash });
  return createHash("sha256").update(payload).digest("hex");
}

// Append record to ledger. Storage is delegated to the active backend
// (in-memory by default; Postgres when DATABASE_URL is set). The record is
// built INSIDE the backend's critical section so `prevHash` reflects the true
// head at persist time and the hash chain cannot fork under concurrency.
export async function appendAuditRecord(
  eventType: AuditEventType,
  actor: Actor,
  options?: {
    target?: Target;
    meta?: Record<string, unknown>;
    requestId?: string;
  }
): Promise<AuditRecord> {
  const now = new Date().toISOString();
  const meta = options?.meta ? redactSecrets(options.meta) : undefined;

  return getAuditBackend().appendWithChain((prevHash) => {
    const recordWithoutHash: Omit<AuditRecord, "hash"> = {
      id: uuidv4(),
      ts: now,
      requestId: options?.requestId,
      actor,
      eventType,
      target: options?.target,
      meta,
      prevHash,
    };
    const hash = computeHash(recordWithoutHash, prevHash);
    return { ...recordWithoutHash, hash };
  });
}

// Get audit records (insertion order), delegated to the active backend.
export async function getAuditRecords(limit = 1000, offset = 0): Promise<AuditRecord[]> {
  return getAuditBackend().getRecords(limit, offset);
}

export interface LedgerVerification {
  ok: boolean;
  count: number;
  headHash: string;
  firstTs: string;
  lastTs: string;
  /**
   * True when the verifier stopped at its read cap WITHOUT reaching the end of
   * the ledger. A truncated `ok: true` means "the prefix I read is intact" and
   * nothing more — treat it as inconclusive, never as a clean chain. This field
   * exists because the capped verifier used to return a bare `ok: true` at the
   * cap, which is a false all-clear on any ledger past 10,000 records.
   */
  truncated: boolean;
  /** Number of read batches a paginating verification consumed (1 for the capped path). */
  batches: number;
  brokenAtIndex?: number;
  expectedHash?: string;
  actualHash?: string;
}

/**
 * Verify one contiguous segment of the chain. `startIndex` is the global index
 * of `records[0]`; `prevHash` is the hash the first record must link to ("" at
 * the true start of the ledger). Returns the failure (global index) or the new
 * head hash. Shared by the capped and the paginating verifiers so there is
 * exactly one implementation of "what intact means".
 *
 * EXPORTED so the offline export verifier (`scripts/src/ledger-export.ts`) runs
 * THIS implementation over records parsed back from an NDJSON export, rather
 * than growing a second, slightly different definition of "intact" that would
 * drift from this one. Anything a segment passes here, the live verifiers would
 * also pass — that equivalence is the whole point of exporting it.
 */
export function verifySegment(
  records: AuditRecord[],
  startIndex: number,
  prevHash: string,
): { broken?: { atIndex: number; expectedHash: string; actualHash: string }; headHash: string } {
  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (record.prevHash !== prevHash) {
      return { broken: { atIndex: startIndex + i, expectedHash: prevHash, actualHash: record.prevHash }, headHash: prevHash };
    }

    const recordWithoutHash: Omit<AuditRecord, "hash"> = {
      id: record.id,
      ts: record.ts,
      requestId: record.requestId,
      actor: record.actor,
      eventType: record.eventType,
      target: record.target,
      meta: record.meta,
      prevHash: record.prevHash,
    };
    const expectedHash = computeHash(recordWithoutHash, record.prevHash);
    if (record.hash !== expectedHash) {
      return { broken: { atIndex: startIndex + i, expectedHash, actualHash: record.hash }, headHash: prevHash };
    }

    prevHash = record.hash;
  }
  return { headHash: prevHash };
}

// Verify the integrity of the ledger — CAPPED at `limit` records.
//
// This is the quick check, and its cap is now HONEST: when the ledger may
// extend past `limit`, the result carries `truncated: true` and its `ok` means
// only "the prefix is intact". It used to return a bare `ok: true` at the cap —
// a false all-clear on any production ledger past 10,000 records, in the one
// component whose entire value is tamper-evidence. Operators and tools that
// need a whole-chain answer use `verifyLedgerFull`, which paginates to the end.
export async function verifyLedger(limit = 10000): Promise<LedgerVerification> {
  const records = await getAuditRecords(limit, 0);

  if (records.length === 0) {
    return { ok: true, count: 0, headHash: "", firstTs: "", lastTs: "", truncated: false, batches: 1 };
  }

  const base = {
    count: records.length,
    firstTs: records[0].ts,
    lastTs: records[records.length - 1].ts,
    // A full read (fewer records than the cap) provably reached the end. A read
    // that RETURNED exactly `limit` records may or may not have more behind it —
    // that is the truncated case, and guessing "no more" is how the false
    // all-clear happened.
    truncated: records.length >= limit,
    batches: 1,
  };

  const result = verifySegment(records, 0, "");
  if (result.broken) {
    return {
      ok: false,
      ...base,
      headHash: records[records.length - 1].hash,
      brokenAtIndex: result.broken.atIndex,
      expectedHash: result.broken.expectedHash,
      actualHash: result.broken.actualHash,
    };
  }
  return { ok: true, ...base, headHash: result.headHash };
}

// Verify the WHOLE chain, however long, in bounded memory.
//
// Pages through the backend in `batchSize` reads, carrying the linking hash
// across batch boundaries, so a ledger of any length is verified end to end
// without ever holding more than one batch in memory. This is the verifier the
// restore procedure and the `db:verify-ledger` CLI use; `truncated` is always
// false here by construction — this function does not stop until the backend
// runs out of records.
export async function verifyLedgerFull(options?: { batchSize?: number }): Promise<LedgerVerification> {
  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 1000));

  let offset = 0;
  let prevHash = "";
  let count = 0;
  let batches = 0;
  let firstTs = "";
  let lastTs = "";

  for (;;) {
    const records = await getAuditRecords(batchSize, offset);
    if (records.length === 0) break;
    batches += 1;

    if (count === 0) firstTs = records[0].ts;
    lastTs = records[records.length - 1].ts;

    const result = verifySegment(records, count, prevHash);
    if (result.broken) {
      return {
        ok: false,
        count: count + records.length,
        headHash: records[records.length - 1].hash,
        firstTs,
        lastTs,
        truncated: false,
        batches,
        brokenAtIndex: result.broken.atIndex,
        expectedHash: result.broken.expectedHash,
        actualHash: result.broken.actualHash,
      };
    }

    prevHash = result.headHash;
    count += records.length;
    offset += records.length;

    // A short batch is the backend saying "that was the end" — stop without
    // issuing a read that would return nothing.
    if (records.length < batchSize) break;
  }

  return {
    ok: true,
    count,
    headHash: prevHash,
    firstTs,
    lastTs,
    truncated: false,
    batches: Math.max(batches, 1),
  };
}

// Helper to record auth failure
export async function recordAuthFailure(
  reason: string,
  actor: Actor,
  options?: {
    requestId?: string;
    meta?: Record<string, unknown>;
  }
): Promise<AuditRecord> {
  return appendAuditRecord("auth.failure", actor, {
    requestId: options?.requestId,
    meta: { reason, ...options?.meta },
  });
}

// Helper to record admin access
export async function recordAdminAccess(
  adminId: string,
  action: string,
  options?: {
    requestId?: string;
    target?: Target;
    meta?: Record<string, unknown>;
  }
): Promise<AuditRecord> {
  return appendAuditRecord("admin.access", { type: "admin", id: adminId }, {
    requestId: options?.requestId,
    target: options?.target,
    meta: { action, ...options?.meta },
  });
}

// Helper to record location observation
export async function recordLocationObservation(
  deviceId: string,
  locationData: {
    observedAt: number;
    source: string;
    mode: string;
    siteId?: string;
    buildingId?: string;
    floorId?: string;
    zoneId?: string;
    lat?: number;
    lon?: number;
    accuracyM?: number;
  },
  options?: {
    requestId?: string;
  }
): Promise<AuditRecord> {
  return appendAuditRecord(
    "asset.location.observed",
    { type: "device", id: deviceId },
    {
      requestId: options?.requestId,
      meta: locationData,
    }
  );
}
