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
 * Deterministic content digest: FNV-1a 64 over the WTF-8 encoding of the string —
 * identical to UTF-8 for every well-formed string; an unpaired surrogate encodes as
 * its own 3-byte sequence (never U+FFFD), so distinct strings never share bytes. This
 * is a fast, dependency-free digest used to demonstrate tamper-evident evidence
 * snapshots and audit chaining in a public-safe review context. It is intentionally
 * NOT a cryptographic hash; the private production core would use a keyed
 * cryptographic construction. Same input always yields the same digest.
 */
export function digest(input: string): string {
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  const eat = (byte: number): void => {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  };
  // FNV is byte-oriented, so hash the WTF-8 BYTES. The old loop took `charCodeAt & 0xff`,
  // so every character sharing a low byte aliased ("Alice" === "\u0141lice"; U+017C === "|").
  // Hand-encoded, not TextEncoder: the core's type env is es2022 with no DOM/Node globals,
  // and TextEncoder maps every lone surrogate to U+FFFD (another alias). A lone surrogate is
  // encoded as its own 3 bytes (WTF-8), so distinct strings are always distinct bytes.
  // ASCII is one byte per char either way: an ASCII input digests exactly as before.
  for (const ch of input) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) {
      eat(c);
    } else if (c < 0x800) {
      eat(0xc0 | (c >> 6)); eat(0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      eat(0xe0 | (c >> 12)); eat(0x80 | ((c >> 6) & 0x3f)); eat(0x80 | (c & 0x3f));
    } else {
      eat(0xf0 | (c >> 18)); eat(0x80 | ((c >> 12) & 0x3f)); eat(0x80 | ((c >> 6) & 0x3f)); eat(0x80 | (c & 0x3f));
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/** The digest algorithm `digest()` implements: FNV-1a 64 over the WTF-8 encoding of the
 *  string — identical to UTF-8 for every well-formed string; an unpaired surrogate encodes
 *  as its own 3-byte sequence (never U+FFFD), so distinct strings never share bytes. Stamped
 *  on every evidence snapshot so a verifier never has to guess which function minted a
 *  durable row. */
export const DIGEST_ALG = "fnv1a64-wtf8" as const;

/**
 * Maximum nesting depth `canonicalJson` will traverse. Digest inputs in this
 * core (evidence, rule sets) are shallow; a value nested beyond this is treated
 * as hostile input rather than being allowed to exhaust the call stack.
 */
export const MAX_CANONICAL_DEPTH = 64;

/**
 * Posture freshness windows (hours since the source last synced the device).
 * Shared by the sync (which stamps freshness at ingest) and by evidence (which
 * re-derives it at decision time, DR-059): the same rule in both places, so a
 * posture cannot be fresher at decision time than the clock says it is.
 */
export const FRESH_WINDOW_HOURS = 24;
export const STALE_WINDOW_HOURS = 72;

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
  // Escape before joining so the join is injective: ("a|b","c") and ("a","b|c") used to
  // mint one id. A part with no `\\` or `|` joins byte-identically, so its id does not move.
  return `${prefix}_${digest(parts.map((p) => p.replace(/[\\|]/g, "\\$&")).join("|"))}`;
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
 * The instant an `observedAt` names, or NaN when it names none the host cannot
 * disagree about. A date-time with no zone designator ("2026-07-13T08:00:00")
 * is parsed by `Date.parse` as HOST-LOCAL time (ECMA-262), so the same wire
 * input ordered differently under TZ=UTC and TZ=Asia/Tokyo and flipped a
 * security decision (backlog row, reproduced 2026-09-26). An offset-less stamp
 * is an unknown instant, so it is NaN here — i.e. illegible, which the rest of
 * this file already resolves fail-closed (never wins as latest, cannot vouch,
 * worst-wins).
 *
 * Accepted, because each NAMES AN EXACT INSTANT: a date-time with a `T`, `t` or
 * space separator (RFC 3339 allows the space; Postgres timestamptz text uses it)
 * and a zone of `Z`, or `+HH:MM`, `+HHMM` (ISO 8601 basic) or `+HH`. A DATE-ONLY
 * stamp ("2026-07-13") is NaN: it names a day, not an instant (owner decision (b),
 * 2026-11-06), so it cannot vouch for freshness, cannot be ordered against a
 * timed reading, and cannot clear a restriction. `Date.parse` reads it as exact
 * UTC midnight, which let a date-only "compliant" outrank a 23:00Z accusation the
 * day before. Every calendar and clock field must be a real
 * value: `Date.parse` rolls "2026-02-30" over to March 2 and "24:00" to the next
 * day, so an impossible stamp is NaN instead of a different instant. The stamp
 * is rebuilt as the one ECMA-262 date-time format
 * (`YYYY-MM-DDTHH:mm[:ss[.sss]]Z|+HH:MM`) before it reaches `Date.parse`, so no
 * engine-specific fallback parser decides anything. Still NaN: RFC 2822 text,
 * epoch strings and anything else. No clock, no host zone.
 */
const ZONED_STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?))?$/;
export function parseObservedInstant(observedAt: string): number {
  const m = ZONED_STAMP.exec(observedAt);
  if (!m) return Number.NaN;
  const [, y, mo, d, hh, mi, ss, frac, z, sign, oh, om] = m;
  // A date-only stamp names a day, not an instant: illegible (owner decision (b), 2026-11-06). A date-time with
  // no zone never gets here: ZONED_STAMP requires `Z` or an offset after a time, so `exec` already failed.
  if (hh === undefined) return Number.NaN;
  // `Date.parse` rolls impossible values over ("2026-02-30" is March 2, "24:00" is the next day), so a reading
  // carrying one would be ordered as a different instant than the one it states. Require every field to
  // round-trip through the calendar; otherwise it names no instant and is illegible.
  const cal = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (cal.getUTCFullYear() !== Number(y) || cal.getUTCMonth() !== Number(mo) - 1 || cal.getUTCDate() !== Number(d)) {
    return Number.NaN;
  }
  if (Number(hh) > 23 || Number(mi) > 59 || (ss !== undefined && Number(ss) > 59)) return Number.NaN;
  if (oh !== undefined && (Number(oh) > 23 || (om !== undefined && Number(om) > 59))) return Number.NaN;
  const zone = z !== undefined ? "Z" : `${sign}${oh}:${om ?? "00"}`;
  return Date.parse(`${y}-${mo}-${d}T${hh}:${mi}${ss !== undefined ? `:${ss}${frac ?? ""}` : ""}${zone}`);
}

/**
 * THE PRE-STRICT READING, made deterministic (round 5 of the #1792/#1809 review, 2026-11-07).
 *
 * Before `parseObservedInstant` the core read every stamp with `Date.parse`. That reader is what mainline still
 * runs, and the owner's rule for this change is that no verdict may come out MILDER than it. Earlier rounds kept
 * a narrower re-implementation of it (offset-less and date-only stamps read as UTC) and Codex found the stamps it
 * missed, one shape at a time: RFC 2822 text such as "Tue, 14 Jul 2026 13:00:00 GMT" parsed under `Date.parse`,
 * was rejected by the strict reader AND by the re-implementation, and its "unknown" age was lost. So this does not
 * re-implement the old reader: it CALLS it, and only decides how much of its answer depends on the host's zone.
 *
 *   fixed      `Date.parse` names one instant on every host: ECMA-262's own format with a zone, its date-only
 *              forms (which ECMA-262 reads as UTC), and legacy text that ends in a clock time and an explicit zone
 *              ("…13:00:00 GMT", "…+0900", "…GMT+0900 (Japan Standard Time)"). A stamp `Date.parse` rejects is
 *              fixed at the STRICT reading: owner decision (c), 2026-11-06 (an exact ±HH stamp mainline could not
 *              parse is read correctly now), and NaN when neither reader can place it.
 *   floating   `Date.parse` reads it as HOST-LOCAL wall time: ECMA-262's format with no zone, and legacy text built
 *              only from digits, separators, month and weekday names and AM/PM. Its instant on a host at UTC
 *              offset `o` is `wall - o`; `wall` is `Date.parse` of the same text with an explicit UTC zone appended,
 *              so it does not depend on this process's zone either.
 *   ambiguous  everything else `Date.parse` accepts (legacy text with a zone word this file does not recognise,
 *              a stray sign, an unknown word). The core does not guess where those land; `buildEvidence` gives the
 *              families that carry one every value they could read and the policy bounds the answer instead.
 *
 * Measured, not assumed: `proof:evidence-observedat-tz` runs every classified shape of a generated corpus in child
 * processes under ten zones (UTC, Asia/Tokyo, America/Los_Angeles, Asia/Kolkata, Pacific/Kiritimati, Etc/GMT+12,
 * Australia/Lord_Howe, America/St_Johns, Asia/Kathmandu, Europe/London) and fails if a `fixed` stamp moves with the
 * zone or a `floating` one is not `wall` minus that zone's offset.
 */
export type PreStrictStamp =
  | { readonly kind: "fixed"; readonly at: number }
  | { readonly kind: "floating"; readonly wall: number }
  | { readonly kind: "ambiguous" };

const ES_FIXED = /^(?:\d{4}|[+-]\d{6})(?:-\d{2}(?:-\d{2})?)?(?:[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2}))?$/;
const ES_LOCAL = /^(?:\d{4}|[+-]\d{6})(?:-\d{2}(?:-\d{2})?)?[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const LEGACY_ZONED = /\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:(?:GMT|UTC|UT|Z|[ECMP][SD]T)(?:[+-]\d{2}:?\d{2})?|[+-]\d{2}:?\d{2})(?:\s*\([^()]*\))?$/i;
const LEGACY_LOCAL_CHARS = /^[0-9A-Za-z ,./:-]+$/;
const LEGACY_LOCAL_WORDS = new Set([
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "am", "pm",
]);

function isLegacyLocal(observedAt: string): boolean {
  if (!LEGACY_LOCAL_CHARS.test(observedAt)) return false;
  // A sign after the date part is an offset to `Date.parse` ("08:00-07"), so it is not host-local text.
  if (/[\s:].*-/.test(observedAt)) return false;
  for (const word of observedAt.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (!LEGACY_LOCAL_WORDS.has(word)) return false;
  }
  return true;
}

/**
 * How the pre-strict reader (`Date.parse`) placed this stamp, independent of this process's zone, and whether the
 * strict reader places it at the same instant (`agrees`: both readers name the same instant, or neither names one).
 * A pure function of the text, so it is memoised (bounded: cleared when full; no clock, no host zone).
 */
export function preStrictReading(observedAt: string): { readonly stamp: PreStrictStamp; readonly agrees: boolean } {
  const hit = PRE_STRICT_MEMO.get(observedAt);
  if (hit !== undefined) return hit;
  const stamp = classifyPreStrict(observedAt);
  const reading = { stamp, agrees: stamp.kind === "fixed" && Object.is(stamp.at, parseObservedInstant(observedAt)) };
  if (PRE_STRICT_MEMO.size >= 4096) PRE_STRICT_MEMO.clear();
  PRE_STRICT_MEMO.set(observedAt, reading);
  return reading;
}
const PRE_STRICT_MEMO = new Map<string, { readonly stamp: PreStrictStamp; readonly agrees: boolean }>();

/** How the pre-strict reader (`Date.parse`) placed this stamp, independent of this process's zone. */
export function preStrictStamp(observedAt: string): PreStrictStamp {
  return preStrictReading(observedAt).stamp;
}

function classifyPreStrict(observedAt: string): PreStrictStamp {
  const legacy = Date.parse(observedAt);
  if (Number.isNaN(legacy)) return { kind: "fixed", at: parseObservedInstant(observedAt) };
  if (ES_FIXED.test(observedAt) || LEGACY_ZONED.test(observedAt)) return { kind: "fixed", at: legacy };
  const wall = ES_LOCAL.test(observedAt)
    ? Date.parse(`${observedAt}Z`)
    : isLegacyLocal(observedAt)
      ? Date.parse(`${observedAt} GMT`)
      : Number.NaN;
  // Before 1973 some zones still ran at offsets off the quarter-hour grid below (local mean time, Liberia's
  // −0:44:30 until 1972), so an older host-local stamp is not placed on the grid either.
  return Number.isNaN(wall) || wall < FLOATING_FROM ? { kind: "ambiguous" } : { kind: "floating", wall };
}

/** 1973-01-01T00:00:00Z: from here every zone in the tz database sits on the quarter-hour grid. */
const FLOATING_FROM = 94_694_400_000;

/**
 * Every whole-quarter-hour UTC offset a host can run at, −12:00 to +14:00, in minutes east of UTC. A floating
 * stamp is placed once per offset; every zone in use today sits on this grid.
 */
export const PRE_STRICT_HOST_OFFSETS_MINUTES: readonly number[] = Array.from({ length: (14 * 60 + 12 * 60) / 15 + 1 }, (_, i) => -12 * 60 + i * 15);

/** The instant the pre-strict reader gave this stamp on a host at `offsetMinutes` east of UTC (NaN: none, or ambiguous). */
export function preStrictInstantAt(stamp: PreStrictStamp, offsetMinutes: number): number {
  if (stamp.kind === "fixed") return stamp.at;
  if (stamp.kind === "floating") return stamp.wall - offsetMinutes * 60_000;
  return Number.NaN;
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
  // The reader that places both stamps. The strict one by default; `buildEvidence` passes the PRE-STRICT reading
  // for one modelled host (`preStrictInstantAt`) when it re-derives the answer the pre-strict reader gave.
  instantOf: (iso: string) => number = parseObservedInstant,
): Freshness {
  if (!observedAtIso) {
    return "missing";
  }
  // An offset-less stamp is an unknown instant (parseObservedInstant), so it is "unknown" here too: reading it
  // host-local made the same dock feed fresh in one zone and stale in another.
  const observedMs = instantOf(observedAtIso);
  const nowMs = instantOf(nowIso);
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
