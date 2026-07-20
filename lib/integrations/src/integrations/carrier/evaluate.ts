import type {
  Freshness,
  ReachabilitySignal,
  ReachabilityVerdict,
} from "./types";

/**
 * Pure, deterministic post-exit reachability evaluator.
 *
 * Turns a normalized carrier ReachabilitySignal into a posture + the single
 * playbook action it recommends — so a lost or unreachable device becomes a
 * self-describing, self-triaging event instead of something an overloaded admin
 * has to chase. No wall clock (time is injected), no randomness: the same signal
 * always yields the same verdict, which is what makes it evidence-grade.
 *
 * Fail-safe ordering: the most degraded, safety-relevant conditions win first,
 * and anything unknown resolves toward attention (monitor), never toward silence.
 */

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes without a carrier sighting.

export interface EvaluateReachabilityOptions {
  /** How long since `lastSeenAt` before the signal is considered stale. */
  staleAfterMs?: number;
}

export function evaluateReachability(
  signal: ReachabilitySignal,
  nowMs: number,
  options: EvaluateReachabilityOptions = {},
): ReachabilityVerdict {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const freshness = deriveFreshness(signal.lastSeenAt, nowMs, staleAfterMs);

  // 1. No cellular backchannel at all — the founder's core blind spot. A Wi-Fi-
  //    only device that has left coverage cannot be located out of band.
  if (signal.wifiOnly) {
    return verdict("wifi_only_blindspot", "WIFI_ONLY_NO_CELLULAR", "alert", false);
  }

  // 2. Provisioning is off — the SIM is suspended/deactivated, so no channel exists.
  if (signal.provisioning === "suspended" || signal.provisioning === "deactivated") {
    return verdict("unreachable", "PROVISIONING_SUSPENDED", "escalate", false);
  }

  // 3. Online with a live data session.
  if (signal.cellularReachability === "online") {
    if (signal.roaming) {
      // Reachable, but roaming can add latency/cost — keep watching, don't alarm.
      return verdict("degraded", "CELLULAR_ONLINE_ROAMING", "monitor", true, freshness);
    }
    return verdict("reachable", "CELLULAR_ONLINE", "monitor", true, freshness);
  }

  // 4. Idle (no active data session) but reachable via an SMS wake channel.
  if (signal.cellularReachability === "idle" && signal.smsReachable) {
    return verdict("degraded", "CELLULAR_IDLE_SMS_OK", "locate", true, freshness);
  }

  // 5. Offline data, but SMS can still wake it for a locate.
  if (signal.cellularReachability === "offline" && signal.smsReachable) {
    return verdict("degraded", "OFFLINE_SMS_ONLY", "locate", true, freshness);
  }

  // 6. Offline with no SMS wake — genuinely dark. Escalate.
  if (signal.cellularReachability === "offline" && !signal.smsReachable) {
    return verdict("unreachable", "FULLY_UNREACHABLE", "escalate", false, freshness);
  }

  // 7. Anything else (unknown state) — resolve toward attention, not silence.
  return verdict("unknown", "REACHABILITY_UNKNOWN", "monitor", signal.smsReachable, freshness);
}

// Build a verdict; when the underlying sighting is stale, degrade a would-be
// "reachable" to "degraded" and surface STALE_LAST_SEEN so a decaying signal is
// never reported as confidently current.
function verdict(
  posture: ReachabilityVerdict["posture"],
  reasonCode: ReachabilityVerdict["reasonCode"],
  recommendedAction: ReachabilityVerdict["recommendedAction"],
  locatable: boolean,
  freshness: Freshness = "unknown",
): ReachabilityVerdict {
  if (freshness === "stale" && posture === "reachable") {
    return { posture: "degraded", reasonCode: "STALE_LAST_SEEN", recommendedAction: "locate", locatable };
  }
  return { posture, reasonCode, recommendedAction, locatable };
}

function deriveFreshness(lastSeenAt: string | null, nowMs: number, staleAfterMs: number): Freshness {
  if (!lastSeenAt) return "unknown";
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return "unknown";
  return nowMs - seen <= staleAfterMs ? "fresh" : "stale";
}
