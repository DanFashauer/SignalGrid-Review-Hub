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
  /** Which end went unverified: the memory core verifies the retained SUFFIX
   *  (earlier events were evicted); the durable verifier reads a PREFIX from the
   *  start of the ledger (later records past its cap). "unknown" when unsaid. */
  unverified: "earlier" | "later" | "unknown" | null;
  /** One-based tenant audit sequence of the break (memory core), or null. */
  brokenAtSeq: number | null;
  /** Zero-based global durable-ledger position of the break, or null. */
  brokenAtLedgerIndex: number | null;
  /** What `length` counts. The memory core verifies the tenant's own chain; the
   *  durable verifier walks the GLOBAL ledger (every tenant's records), while the
   *  events beside it are this tenant's page — the two counts are not one scope. */
  scope: "tenant" | "global-ledger" | "unknown";
  length: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function normalizeChain(raw: unknown): ChainVerdict {
  const c = (raw ?? {}) as Record<string, unknown>;
  const partial = c.truncated !== false;
  const unverifiedVerdict: ChainVerdict = { valid: false, partial: true, unverified: "unknown", brokenAtSeq: null, brokenAtLedgerIndex: null, scope: "unknown", length: 0 };
  // Only a complete, unambiguous verifier shape is believed: a verdict missing its
  // length/count or its truncated flag, or carrying both shapes' verdicts at once
  // (`valid` AND `ok`), is unverified — never "intact" by default. So is a success
  // that names a break location (`valid: true` with a numeric `brokenAtSeq`, or
  // `ok: true` with a numeric `brokenAtIndex`): one of the two fields is wrong.
  const memory = typeof c.valid === "boolean" && num(c.length) !== null && typeof c.truncated === "boolean" && !("ok" in c);
  const durable = typeof c.ok === "boolean" && num(c.count) !== null && typeof c.truncated === "boolean" && !("valid" in c);
  if (memory && typeof c.valid === "boolean") {
    if (c.valid && c.brokenAtSeq != null) return unverifiedVerdict;
    return { valid: c.valid, partial, unverified: partial ? (c.truncated === true ? "earlier" : "unknown") : null, brokenAtSeq: c.valid ? null : num(c.brokenAtSeq), brokenAtLedgerIndex: null, scope: "tenant", length: num(c.length) ?? 0 };
  }
  if (durable && typeof c.ok === "boolean") {
    if (c.ok && c.brokenAtIndex != null) return unverifiedVerdict;
    return { valid: c.ok, partial, unverified: partial ? (c.truncated === true ? "later" : "unknown") : null, brokenAtSeq: null, brokenAtLedgerIndex: c.ok ? null : num(c.brokenAtIndex), scope: "global-ledger", length: num(c.count) ?? 0 };
  }
  return unverifiedVerdict;
}

/** Where the break is, in the verifier's own terms; "" when none was located. */
export function chainBreak(c: ChainVerdict): string {
  if (c.brokenAtSeq !== null) return `sequence ${c.brokenAtSeq}`;
  if (c.brokenAtLedgerIndex !== null) return `global ledger index ${c.brokenAtLedgerIndex} (zero-based)`;
  return "";
}

/** What a partial verification left out, in the direction its verifier read; "" when whole. */
export function chainGap(c: ChainVerdict): string {
  if (c.unverified === "earlier") return "verified for the retained recent events only; earlier events are not verified";
  if (c.unverified === "later") return "verified from the start of the ledger up to the verifier's cap; later records are not verified";
  return c.partial ? "only partially verified" : "";
}

/** The assertive announcement for a chain that is not fully verified; "" when it is. */
export function chainAlert(c: ChainVerdict): string {
  if (!c.valid) return chainBreak(c) ? `Hash chain broken at ${chainBreak(c)}.` : "Hash chain could not be verified.";
  return c.partial ? `Hash chain ${chainGap(c)}.` : "";
}
