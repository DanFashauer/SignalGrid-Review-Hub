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

// Verify the integrity of the ledger
export async function verifyLedger(limit = 10000): Promise<{
  ok: boolean;
  count: number;
  headHash: string;
  firstTs: string;
  lastTs: string;
  brokenAtIndex?: number;
  expectedHash?: string;
  actualHash?: string;
}> {
  const records = await getAuditRecords(limit, 0);

  if (records.length === 0) {
    return {
      ok: true,
      count: 0,
      headHash: "",
      firstTs: "",
      lastTs: "",
    };
  }

  let prevHash = "";
  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Verify prevHash
    if (record.prevHash !== prevHash) {
      return {
        ok: false,
        brokenAtIndex: i,
        expectedHash: prevHash,
        actualHash: record.prevHash,
        count: records.length,
        headHash: records[records.length - 1].hash,
        firstTs: records[0].ts,
        lastTs: records[records.length - 1].ts,
      };
    }

    // Verify hash
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
      return {
        ok: false,
        brokenAtIndex: i,
        expectedHash,
        actualHash: record.hash,
        count: records.length,
        headHash: records[records.length - 1].hash,
        firstTs: records[0].ts,
        lastTs: records[records.length - 1].ts,
      };
    }

    prevHash = record.hash;
  }

  return {
    ok: true,
    count: records.length,
    headHash: records[records.length - 1].hash,
    firstTs: records[0].ts,
    lastTs: records[records.length - 1].ts,
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
