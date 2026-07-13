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
 * Canonical JSON: stable key ordering so digests are reproducible regardless of
 * property insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
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
  if (Number.isNaN(observedMs) || Number.isNaN(nowMs) || observedMs > nowMs) {
    return "unknown";
  }
  const ageHours = (nowMs - observedMs) / (1000 * 60 * 60);
  if (ageHours <= freshWindowHours) {
    return "fresh";
  }
  if (ageHours <= staleWindowHours) {
    return "stale";
  }
  return "expired";
}
