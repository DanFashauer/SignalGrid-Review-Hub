/**
 * `/v1/audit` answers its chain verdict in two shapes. The in-memory core
 * returns `{ valid, brokenAtSeq, length, truncated, evictedCount }`; the durable
 * backend returns `verifyLedger()`'s `{ ok, count, truncated, brokenAtIndex }`.
 * Read as-is, a durable answer has no `valid`, so every clean chain looked broken.
 *
 * The two locations are different things and stay apart: `brokenAtSeq` is the
 * tenant's one-based audit sequence (memory core); `brokenAtLedgerIndex` is a
 * zero-based position in the GLOBAL durable ledger, which may name no event on
 * this tenant's page. Neither is cast into the other.
 *
 * Fail-closed: `partial` is true unless the verifier says it covered the whole
 * history (`truncated: false`). A truncated `valid`/`ok` covers the retained
 * window or the read prefix only, never the whole chain. An unrecognised shape
 * is unverified and partial, and names no break it did not find.
 */
export interface ChainVerdict {
  /** No break was found in what was verified. */
  valid: boolean;
  /** The verification did not cover the whole history. */
  partial: boolean;
  /** One-based tenant audit sequence of the break (memory core), or null. */
  brokenAtSeq: number | null;
  /** Zero-based global durable-ledger position of the break, or null. */
  brokenAtLedgerIndex: number | null;
  length: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function normalizeChain(raw: unknown): ChainVerdict {
  const c = (raw ?? {}) as Record<string, unknown>;
  const partial = c.truncated !== false;
  if (typeof c.valid === "boolean") {
    return { valid: c.valid, partial, brokenAtSeq: c.valid ? null : num(c.brokenAtSeq), brokenAtLedgerIndex: null, length: num(c.length) ?? 0 };
  }
  if (typeof c.ok === "boolean") {
    return { valid: c.ok, partial, brokenAtSeq: null, brokenAtLedgerIndex: c.ok ? null : num(c.brokenAtIndex), length: num(c.count) ?? 0 };
  }
  return { valid: false, partial: true, brokenAtSeq: null, brokenAtLedgerIndex: null, length: 0 };
}

/** Where the break is, in the verifier's own terms; "" when none was located. */
export function chainBreak(c: ChainVerdict): string {
  if (c.brokenAtSeq !== null) return `sequence ${c.brokenAtSeq}`;
  if (c.brokenAtLedgerIndex !== null) return `global ledger index ${c.brokenAtLedgerIndex} (zero-based)`;
  return "";
}

/** The assertive announcement for a chain that is not fully verified; "" when it is. */
export function chainAlert(c: ChainVerdict): string {
  if (!c.valid) return chainBreak(c) ? `Hash chain broken at ${chainBreak(c)}.` : "Hash chain could not be verified.";
  return c.partial ? "Hash chain verified for the retained part only; earlier events are not verified." : "";
}
