import type { Freshness } from "./types";

/**
 * Injectable clock. Determinism matters: proofs and reviews must reproduce the
 * exact same decision, evidence, and audit chain on every run, so time is a
 * dependency, never a hidden global.
 */
export interface Clock {
  now(): Date;
}

export function fixedClock(iso: string): Clock {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`fixedClock requires a valid ISO timestamp, got: ${iso}`);
  }
  return {
    now(): Date {
      return new Date(ms);
    },
  };
}

/**
 * Deterministic content digest (FNV-1a, 64-bit, hex). This is a fast,
 * dependency-free digest used to demonstrate tamper-evident evidence snapshots
 * and audit chaining in a public-safe review context. It is intentionally NOT a
 * cryptographic hash; the private production core would use a keyed
 * cryptographic construction. Same input always yields the same digest.
 */
export function digest(input: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Maximum nesting depth `canonicalJson` will traverse. Digest inputs in this
 * core (evidence, rule sets) are shallow; a value nested beyond this is treated
 * as hostile input rather than being allowed to exhaust the call stack.
 */
export const MAX_CANONICAL_DEPTH = 64;

/**
 * Canonical JSON: stable key ordering so digests are reproducible regardless of
 * property insertion order. Bounded depth: deeply-nested input (a stack-overflow
 * DoS vector) is rejected instead of recursed. Throws a RangeError past the cap.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value, 0));
}

function sortValue(value: unknown, depth: number): unknown {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new RangeError(
      `canonicalJson: input nested deeper than ${MAX_CANONICAL_DEPTH} levels.`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key], depth + 1);
    }
    return sorted;
  }
  return value;
}

/** Deterministic, human-readable id derived from stable seed parts. */
export function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${digest(parts.join("|"))}`;
}

/**
 * Length-independent string comparison. Unlike `===`, its running time does not
 * short-circuit at the first differing character, so it does not leak a
 * character-by-character timing signal that could be used to recover a secret
 * token. Pure JS (the core is isomorphic and cannot use `crypto.timingSafeEqual`
 * directly); the private production core would compare fixed-length digests with
 * a native constant-time primitive.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  // Fold the length difference in so unequal lengths never compare equal.
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Classify posture freshness from an observation time relative to the
 * evaluation clock. Fail-safe: unpariseable or future timestamps are "unknown",
 * never "fresh".
 */
export function classifyFreshness(
  observedAtIso: string | null | undefined,
  nowIso: string,
  freshWindowHours: number,
  staleWindowHours: number,
): Freshness {
  if (!observedAtIso) {
    return "missing";
  }
  const observedMs = Date.parse(observedAtIso);
  const nowMs = Date.parse(nowIso);
  // freshness: local-by-design — same rule, but this package cannot import @workspace/integrations without a new workspace dependency and a lockfile regeneration; folded copy pending that change — signalgrid-core is the BASE package with zero dependencies; the shared helper would have to move here, not be imported (tolerance 0, future reads `unknown`)
  if (Number.isNaN(observedMs) || Number.isNaN(nowMs) || observedMs > nowMs) {
    return "unknown";
  }
  // freshness: local-by-design — the age arithmetic guarded by the future check immediately above; same local-by-design reason
  const ageHours = (nowMs - observedMs) / (1000 * 60 * 60);
  if (ageHours <= freshWindowHours) {
    return "fresh";
  }
  if (ageHours <= staleWindowHours) {
    return "stale";
  }
  return "expired";
}
