import { deriveFreshness } from "../../utils/freshness";
import type { NacFreshness, NetworkVerdict, NormalizedNetworkSignal, SegmentPolicy } from "./types";

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
  /** Which segments this device is expected on. Omit to leave the segment ungraded
   *  — see the note on the authenticated branch below. */
  segmentPolicy?: SegmentPolicy;
}

/** Trimmed, case-insensitive membership. Vendors report the same VLAN as "VLAN10",
 *  "vlan10" and "  VLAN10 " across NAC, RADIUS and switch inventories, and a policy
 *  that misses because of a space is a policy that silently stops working. */
/** NULL-SAFE ON PURPOSE. A negative control removed the `segment === null` guard
 *  above and this function threw a TypeError, crashing the evaluator rather than
 *  returning a verdict. An evaluator whose PURITY depends on the statement order of
 *  its caller is one refactor away from throwing inside a decision path, and a
 *  decision path that throws produces no verdict at all — strictly worse than a
 *  fail-closed one. A null segment simply matches nothing. */
const includesSegment = (list: readonly string[], segment: string | null): boolean => {
  if (segment === null) return false;
  const needle = segment.trim().toLowerCase();
  return list.some((s) => s.trim().toLowerCase() === needle);
};

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
    // ── THE SEGMENT IS NOW ACTUALLY EVALUATED ────────────────────────────────
    //
    // It was not before, and the posture name claimed otherwise. `segment` was read
    // by the connector, normalized, and carried into evidence — and then the word
    // appeared exactly ONCE in this file, inside the string literal
    // "on_trusted_segment". A device that authenticated onto the GUEST VLAN, or the
    // MANAGEMENT VLAN, returned a verdict byte-identical to one on the corporate
    // user VLAN: posture on_trusted_segment, action `none`. "Trusted" was an
    // unearned claim attached to a grant.
    //
    // That defeats the entire point of segmentation. VLANs exist to isolate systems
    // and limit lateral movement; a fabric that grants regardless of which segment a
    // device landed on cannot see that isolation being violated — and the case it
    // most needs to catch, a frontline device answering on the management VLAN, was
    // exactly the one it graded clean.
    const policy = options.segmentPolicy;
    if (!policy || policy.expected.length === 0) {
      // NO POLICY EXPRESSED — the segment is not graded, and the verdict says so.
      //
      // Deliberately still `none`. Forcing every deployment without a segment policy
      // to step up would be a control that fires on every decision forever, which is
      // the failure mode this repo has already been bitten by twice (the BYOD
      // supervision gate, the always-on unsupervised check). The honest fix is to
      // stop CLAIMING trust, not to invent a concern nobody asked for.
      return grantIfPostureVerified(signal, freshness, "on_unverified_segment", "AUTHENTICATED_SEGMENT_UNVERIFIED", loc);
    }
    if (signal.segment === null) {
      // A policy exists but the source did not say where the device is. Foreclose:
      // an unreported segment is not evidence of an expected one.
      return v("network_unknown", "SEGMENT_UNREPORTED_UNDER_POLICY", "step_up", loc);
    }
    const expected = includesSegment(policy.expected, signal.segment);
    if (!expected && includesSegment(policy.restricted ?? [], signal.segment)) {
      // Reached a management / security / OT segment it has no business on. This is
      // lateral movement into the control plane, not a misconfiguration, so it
      // outranks an ordinary unexpected segment.
      return v("on_unexpected_segment", "SEGMENT_RESTRICTED", "restrict", loc);
    }
    if (!expected) {
      return v("on_unexpected_segment", "SEGMENT_UNEXPECTED", "step_up", loc);
    }
    return grantIfPostureVerified(signal, freshness, "on_trusted_segment", "AUTHENTICATED_TRUSTED_SEGMENT", loc);
  }

  // 5. Unknown — resolve toward attention, not silence.
  return v("network_unknown", "NETWORK_STATE_UNKNOWN", "monitor", loc);
}

// ── THE GRANT MUST BE EARNED ─────────────────────────────────────────────────
//
// Both grant exits used to return `none` regardless of whether `nacCompliant`
// and auth freshness were REPORTED. The asymmetry was exact: a device whose
// source said "stale" or "noncompliant" stepped up, while a device whose source
// said NOTHING sailed through as verified-good — unknown graded identical to
// known-good and strictly better than known-bad. Executed counterexample:
// authenticated + nacCompliant:null + lastAuthAt:null on an expected segment
// returned on_trusted_segment / none. Per the live RADIUS shape check, that
// unreported combination is the COMMON case on a real wire, not an edge.
//
// The lattice this restores: verified-good (none) > unreported (monitor) >
// reported-bad (step_up). `monitor` and not `step_up` on purpose — see the
// AUTHENTICATED_POSTURE_UNVERIFIED comment in types.ts: these fields never
// arrive with a plain RADIUS result, and a control that challenges every
// decision forever is a control an operator switches off.
function grantIfPostureVerified(
  signal: NormalizedNetworkSignal,
  freshness: NacFreshness,
  posture: NetworkVerdict["posture"],
  earnedReason: NetworkVerdict["reasonCode"],
  loc: string | null,
): NetworkVerdict {
  if (signal.nacCompliant === true && freshness === "fresh") {
    return v(posture, earnedReason, "none", loc);
  }
  return v(posture, "AUTHENTICATED_POSTURE_UNVERIFIED", "monitor", loc);
}

function v(
  posture: NetworkVerdict["posture"],
  reasonCode: NetworkVerdict["reasonCode"],
  recommendedAction: NetworkVerdict["recommendedAction"],
  accessLocation: string | null,
): NetworkVerdict {
  return { posture, reasonCode, recommendedAction, accessLocation };
}

