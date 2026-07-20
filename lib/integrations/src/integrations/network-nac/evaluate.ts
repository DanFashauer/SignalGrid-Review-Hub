import type { NacFreshness, NetworkVerdict, NormalizedNetworkSignal } from "./types";

/**
 * Pure, deterministic network / NAC posture evaluator. Turns a normalized network
 * signal into a posture + the action it warrants. Fail-safe: an unauthenticated
 * device on the network is the strongest concern (it got on without passing NAC),
 * a NAC-noncompliant device warrants step-up, an already-quarantined device is
 * contained (watch), and anything unknown resolves toward attention. Time is
 * injected (freshness), no randomness.
 */

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

export interface EvaluateNetworkOptions {
  staleAfterMs?: number;
}

export function evaluateNetwork(
  signal: NormalizedNetworkSignal,
  nowMs: number,
  options: EvaluateNetworkOptions = {},
): NetworkVerdict {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const freshness = deriveFreshness(signal.lastAuthAt, nowMs, staleAfterMs);
  const loc = signal.accessLocation;

  // 1. On the network without authenticating — it bypassed access control. Contain.
  if (signal.authState === "unauthenticated") {
    return v("unauthenticated", "UNAUTHENTICATED_AT_CONNECTION", "restrict", loc);
  }

  // 2. Already quarantined — it is contained; watch rather than re-act.
  if (signal.authState === "quarantined") {
    return v("quarantined", "QUARANTINED_SEGMENT", "monitor", loc);
  }

  // 3. Authenticated but failed the NAC posture policy — step up before trusting.
  if (signal.authState === "authenticated" && signal.nacCompliant === false) {
    return v("network_unknown", "NAC_NONCOMPLIANT", "step_up", loc);
  }

  // 4. Authenticated + compliant — but a stale auth is not proof of current state.
  if (signal.authState === "authenticated") {
    if (freshness === "stale") {
      return v("network_unknown", "STALE_NETWORK_STATE", "step_up", loc);
    }
    return v("on_trusted_segment", "AUTHENTICATED_TRUSTED_SEGMENT", "none", loc);
  }

  // 5. Unknown — resolve toward attention, not silence.
  return v("network_unknown", "NETWORK_STATE_UNKNOWN", "monitor", loc);
}

function v(
  posture: NetworkVerdict["posture"],
  reasonCode: NetworkVerdict["reasonCode"],
  recommendedAction: NetworkVerdict["recommendedAction"],
  accessLocation: string | null,
): NetworkVerdict {
  return { posture, reasonCode, recommendedAction, accessLocation };
}

function deriveFreshness(lastAuthAt: string | null, nowMs: number, staleAfterMs: number): NacFreshness {
  if (!lastAuthAt) return "unknown";
  const t = Date.parse(lastAuthAt);
  if (Number.isNaN(t)) return "unknown";
  return nowMs - t <= staleAfterMs ? "fresh" : "stale";
}
