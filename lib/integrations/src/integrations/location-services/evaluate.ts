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

function deriveFreshness(capturedAt: string | null, nowMs: number, staleAfterMs: number): LocationFreshness {
  if (!capturedAt) return "unknown";
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return "unknown";
  return nowMs - t <= staleAfterMs ? "fresh" : "stale";
}
