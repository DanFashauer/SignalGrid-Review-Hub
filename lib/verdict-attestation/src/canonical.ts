// Canonical serialization for the sealed payload.
//
// A seal is only as good as the bytes it covers. If two different verdicts can produce
// the same canonical form, one can be swapped for the other under a valid signature; if
// the same verdict can produce two different forms, a verifier rejects honest traffic.
// `JSON.stringify` gives neither guarantee — key order follows insertion order, so the
// same object built two ways serializes two ways.
//
// This is a deliberately small, total function. It never throws on hostile input: an
// unserializable value makes the payload UNCANONICAL, which the caller turns into a
// refusal, rather than an exception escaping into a verification path.

/** Sentinel returned when a value cannot be canonicalized. Not a string a JSON value
 *  can produce, because every produced string is quoted. */
export const UNCANONICAL = Symbol("uncanonical");

const MAX_DEPTH = 32;

/** Own-property-only, prototype-blind, key-sorted JSON.
 *
 *  - Object keys are sorted, so insertion order cannot change the bytes.
 *  - Only OWN enumerable string keys are serialized. An inherited property is the
 *    prototype's claim, not this verdict's, and including it would let a polluted
 *    prototype change what a signature covers.
 *  - `undefined`, functions and symbols inside objects are DROPPED, matching JSON, but
 *    at the top level or inside an array they are UNCANONICAL rather than silently
 *    becoming `null` — an array hole must not quietly alter the sealed bytes.
 *  - Non-finite numbers are UNCANONICAL. `JSON.stringify` turns NaN and Infinity into
 *    `null`, which would make three different verdicts seal identically.
 *  - Depth is bounded, so a cyclic or adversarially-nested value fails closed instead
 *    of exhausting the stack. */
export function canonicalize(value: unknown, depth = 0): string | typeof UNCANONICAL {
  if (depth > MAX_DEPTH) return UNCANONICAL;

  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) return UNCANONICAL;
    // Negative zero serializes as "0" via JSON; make that explicit rather than
    // incidental, so -0 and 0 are the same bytes on purpose.
    return JSON.stringify(Object.is(value, -0) ? 0 : (value as number));
  }
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint" || t === "function" || t === "symbol" || t === "undefined") return UNCANONICAL;

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const s = canonicalize(item, depth + 1);
      if (s === UNCANONICAL) return UNCANONICAL;
      parts.push(s);
    }
    return `[${parts.join(",")}]`;
  }

  if (t === "object") {
    let keys: string[];
    try {
      // Own enumerable string keys only. A Proxy that throws from its traps fails
      // closed here rather than propagating out of a verification call.
      keys = Object.keys(value as object).sort();
    } catch {
      return UNCANONICAL;
    }
    const parts: string[] = [];
    for (const k of keys) {
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        return UNCANONICAL; // a throwing accessor
      }
      // Matching JSON: an own key whose value is undefined/function/symbol is omitted.
      const vt = typeof v;
      if (v === undefined || vt === "function" || vt === "symbol") continue;
      const s = canonicalize(v, depth + 1);
      if (s === UNCANONICAL) return UNCANONICAL;
      parts.push(`${JSON.stringify(k)}:${s}`);
    }
    return `{${parts.join(",")}}`;
  }

  return UNCANONICAL;
}
