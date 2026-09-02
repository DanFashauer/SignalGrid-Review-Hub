import { ageMs } from "../../utils/freshness";
import {
  type CollectionState,
  type EvidenceReliance,
  type NormalizedObservabilityIntegrity,
  type ObservabilityStreamReportRaw,
  type SignalFreshness,
  type StreamFidelity,
} from "./types";

/** TRUSTED allowlists. Anything not listed is `unknown` — never coerced, and in
 *  particular never coerced toward the cleaner end of any axis. */
const COLLECTION: readonly CollectionState[] = ["reporting", "not_reporting", "never_instrumented"];
const FIDELITY: readonly StreamFidelity[] = ["full", "sampled", "partial_drop", "cost_capped"];

/** Reliance is the CALLER's declaration, not the source's. An unrecognised value
 *  becomes `unstated`, which takes the baseline response — never the escalation,
 *  and never a discount. */
const RELIANCE: readonly EvidenceReliance[] = ["load_bearing", "advisory"];

/**
 * How many declared intervals a stream may miss before it is `stale`.
 *
 * One interval is jitter — a scrape that lands 100ms late is not a finding, and a
 * dimension that fired on it would be noise nobody could act on. Two is the
 * smallest multiple that distinguishes "late" from "stopped", and it is the
 * convention the surrounding ecosystem already uses for staleness on interval-based
 * collection. It is a NAMED CONSTANT rather than an inline number so the proof can
 * pin both sides of the boundary, and so changing it is a visible edit.
 */
export const STALE_AFTER_INTERVALS = 2;

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const asInstant = (v: unknown): number | null => {
  const s = asString(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const asPositiveNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** A kept fraction is only meaningful in (0,1]. Zero would mean "nothing kept",
 *  which is a drop, not a sample; above one is nonsense. Both are reported as
 *  absent rather than clamped, because clamping invents a number the source
 *  never sent. */
const asFraction = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : null;

/**
 * Normalize an observability backend's stream record into the graded shape the
 * evaluator reads.
 *
 * THE REFERENCE INSTANT IS SUPPLIED BY THE CALLER. There is no `Date.now()` in
 * this path — a decision that reads the wall clock is not reproducible, and the
 * whole fabric's determinism rests on that. `review:invariants` enforces it.
 *
 * ASYMMETRIC BY CONSTRUCTION, in three places that a lazier normalizer would
 * collapse:
 *
 *   · A record with NO datapoint at all is `never_received` — the backend held a
 *     record and that record says nothing has ever arrived. It is not `unknown`.
 *   · A record WITH a datapoint but no declared interval is `no_interval_declared`
 *     — the data is real, the yardstick is missing. It is not `current`, because
 *     "current" would be a compliance claim against a policy that does not exist.
 *   · A datapoint dated AFTER the reference instant is `unknown`, not `current`.
 *     This is the trap worth naming: a future timestamp is the most "recent"
 *     value a naive age comparison can see, so a skewed clock or a bad export
 *     would present as maximally fresh — the exact shape of an unearned
 *     affirmative. A negative age means the clock is unreadable, and unreadable
 *     raises.
 */
export function normalizeObservabilityIntegrity(
  raw: ObservabilityStreamReportRaw | null | undefined,
  referenceInstant: string,
  fallbackStreamRef = "unknown",
): NormalizedObservabilityIntegrity {
  const now = asInstant(referenceInstant);
  const streamRef = asString(raw?.streamRef) ?? fallbackStreamRef;
  const source = asString(raw?.source) ?? "observability-integrity";
  const observedAt = asString(raw?.observedAt) ?? referenceInstant;

  if (raw === null || raw === undefined) {
    return {
      streamRef,
      collection: "unknown",
      fidelity: "unknown",
      freshness: "unknown",
      reliance: "unstated",
      covered: false,
      ageSeconds: null,
      expectedIntervalSeconds: null,
      keptFraction: null,
      source,
      observedAt,
    };
  }

  const collectionRaw = asString(raw.collectionState);
  const collection: CollectionState =
    collectionRaw !== null && (COLLECTION as readonly string[]).includes(collectionRaw)
      ? (collectionRaw as CollectionState)
      : "unknown";

  const fidelityRaw = asString(raw.fidelity);
  const fidelity: StreamFidelity =
    fidelityRaw !== null && (FIDELITY as readonly string[]).includes(fidelityRaw)
      ? (fidelityRaw as StreamFidelity)
      : "unknown";

  const relianceRaw = asString(raw.reliance);
  const reliance: EvidenceReliance =
    relianceRaw !== null && (RELIANCE as readonly string[]).includes(relianceRaw)
      ? (relianceRaw as EvidenceReliance)
      : "unstated";

  const expectedIntervalSeconds = asPositiveNumber(raw.expectedIntervalSeconds);
  const keptFraction = asFraction(raw.keptFraction);
  const last = asInstant(raw.lastDatapointAt);

  let freshness: SignalFreshness;
  let ageSeconds: number | null = null;

  if (now === null) {
    // No usable reference instant: nothing can be aged. Unknown, not fine.
    freshness = "unknown";
  } else if (last === null) {
    freshness = "never_received";
  } else {
    // Tolerance 0 (not the shared FUTURE_SKEW_TOLERANCE_MS): `referenceInstant` is
    // posed by the caller, not read from a clock, and widening it would turn a
    // future-dated datapoint from `unknown` (which raises) into `current`.
    const ms = ageMs(last, now, 0);
    if (ms === null) {
      // Dated in the future relative to the reference — an unreadable clock, not
      // freshness. Deliberately does NOT report an age it cannot vouch for.
      freshness = "unknown";
    } else {
      const age = Math.floor(ms / 1000);
      ageSeconds = age;
      freshness =
        expectedIntervalSeconds === null
          ? "no_interval_declared"
          : age > expectedIntervalSeconds * STALE_AFTER_INTERVALS
            ? "stale"
            : "current";
    }
  }

  return {
    streamRef,
    collection,
    fidelity,
    freshness,
    reliance,
    covered: true,
    ageSeconds,
    expectedIntervalSeconds,
    keptFraction,
    source,
    observedAt,
  };
}
