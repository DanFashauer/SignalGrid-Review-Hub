import type { LocationFreshness, LocationVerdict, NormalizedLocationSignal } from "./types";

/**
 * Pure, deterministic location evaluator. Turns a normalized location signal into
 * a geofence posture + the action it warrants — so "where is this device" becomes
 * a bounded, self-triaging answer. Time is injected (freshness is a function of
 * nowMs), no randomness. Privacy-aware: the verdict surfaces whether precise
 * coordinates were used so a policy can require coarse-only handling.
 */

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes without a fresh fix.

export interface EvaluateLocationOptions {
  staleAfterMs?: number;
}

export function evaluateLocation(
  signal: NormalizedLocationSignal,
  nowMs: number,
  options: EvaluateLocationOptions = {},
): LocationVerdict {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const freshness = deriveFreshness(signal.capturedAt, nowMs, staleAfterMs);
  const usesPreciseLocation = signal.hasPreciseCoordinates;

  // No usable geofence membership → we do not know where it is.
  if (signal.geofenceState === "unknown") {
    return v("location_unknown", "NO_LOCATION", "monitor", false, usesPreciseLocation);
  }

  // A stale fix cannot be trusted as current position, wherever it last was.
  if (freshness === "stale") {
    return v("off_premises_stale", "STALE_LOCATION_FIX", "locate", true, usesPreciseLocation);
  }

  // Freshness UNKNOWN (wedge #12, caught by the shift-1 sweep): the fix carries
  // no capture time, an unparseable one, or one claimed from the FUTURE (wedge
  // #13 — a contradiction, folded to unknown in deriveFreshness). The geofence
  // membership may be years old, so "inside" is not a reading we are entitled
  // to. This used to fall straight through to the inside/none grant — only
  // provably-STALE fixes were caught. Graded `monitor` (a blind spot to
  // investigate), not `locate` — a reported-stale fix stays the stronger call
  // because it is a REPORTED bad state; and not locatable, because we cannot
  // vouch for the fix's currency.
  if (freshness === "unknown") {
    return v("location_unknown", "UNVERIFIED_LOCATION_FRESHNESS", "monitor", false, usesPreciseLocation);
  }

  if (signal.geofenceState === "inside") {
    return v("on_premises", "INSIDE_AUTHORIZED_GEOFENCE", "none", true, usesPreciseLocation);
  }

  // Fresh and outside the authorized premises — a device that has left the
  // building. Locatable (we have a current fix), action = locate.
  return v("off_premises", "OUTSIDE_AUTHORIZED_GEOFENCE", "locate", true, usesPreciseLocation);
}

function v(
  posture: LocationVerdict["posture"],
  reasonCode: LocationVerdict["reasonCode"],
  recommendedAction: LocationVerdict["recommendedAction"],
  locatable: boolean,
  usesPreciseLocation: boolean,
): LocationVerdict {
  return { posture, reasonCode, recommendedAction, locatable, usesPreciseLocation };
}

// Clocks in a distributed fleet legitimately skew by seconds; beyond this a
// "future" capture time is a contradiction, not a skew.
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;

function deriveFreshness(capturedAt: string | null, nowMs: number, staleAfterMs: number): LocationFreshness {
  if (!capturedAt) return "unknown";
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return "unknown";
  // A capture time meaningfully in the FUTURE is contradictory (wedge #13) — it
  // used to read as fresh (nowMs - t is negative, trivially ≤ staleAfterMs).
  // Contradiction resolves to unknown, never to the freshest possible reading.
  if (t - nowMs > FUTURE_SKEW_TOLERANCE_MS) return "unknown";
  return nowMs - t <= staleAfterMs ? "fresh" : "stale";
}
