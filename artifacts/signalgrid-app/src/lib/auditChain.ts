import type { V1ChainVerification } from "./v1";

/**
 * `/v1/audit` answers its chain verdict in two shapes. The in-memory core
 * returns `{ valid, brokenAtSeq, length }`; the durable backend returns
 * `verifyLedger()`'s `{ ok, count, truncated, brokenAtIndex }`. The console
 * reads the first, so a durable answer read as-is has no `valid` and every
 * clean chain looks broken ("broken at sequence undefined").
 *
 * Fail-closed: a truncated durable verification (the verifier stopped at its
 * read cap) is inconclusive, not clean, and an unrecognised shape is
 * unverified. Neither names a break it did not find: `brokenAtSeq` stays null.
 */
export function normalizeChain(raw: unknown): V1ChainVerification {
  const c = (raw ?? {}) as Record<string, unknown>;
  const seq = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const len = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof c.valid === "boolean") {
    return { valid: c.valid, brokenAtSeq: seq(c.brokenAtSeq), length: len(c.length) };
  }
  if (typeof c.ok === "boolean") {
    return { valid: c.ok && c.truncated === false, brokenAtSeq: c.ok ? null : seq(c.brokenAtIndex), length: len(c.count) };
  }
  return { valid: false, brokenAtSeq: null, length: 0 };
}
