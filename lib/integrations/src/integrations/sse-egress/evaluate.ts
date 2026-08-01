// Pure, deterministic SSE-egress evaluator.
//
// One question, graded only when the caller poses it: is this device's traffic
// actually traversing the deployment's MANDATED edge?
//
// The ladder, most-specific first (single-axis — exactly one outcome is true):
//
//   unposed / not mandated  → unassessed / EGRESS_UNPOSED / none — day-one
//                             quiet; a device outside the mandate is never
//                             nagged, and egressProtected stays false so
//                             nothing is silently affirmed
//   not covered             → unknown / NOT_COVERED / step_up (a mandated
//                             device nobody can report on is a gap)
//   report malformed        → unverified / REPORT_MALFORMED / step_up
//   bridge not affirmed     → unverified / BRIDGE_UNREACHABLE / step_up
//   tunneled + edge AFFIRMATIVELY observing traffic
//                           → egress_protected / none — the ONLY grant
//   tunneled + observation explicitly ABSENT (false)
//                           → TUNNEL_UNCORROBORATED / step_up + critical — the
//                             client and the service disagree about one fact;
//                             a contradiction never resolves toward a grant
//   tunneled + observation unreported (null)
//                           → EGRESS_STATE_UNKNOWN / step_up — a tunnel the
//                             edge cannot be shown to see is not a tunnel
//   bypassed                → egress_bypassed / step_up — the device is
//                             egressing raw under a mandate; a bypass rule may
//                             be deliberate policy, so the remedy is a raised
//                             bar the operator can see, never a lockout
//   disabled                → egress_disabled / ALERT — protection
//                             affirmatively OFF is an operator-scale defect
//   not_installed           → egress_unprovisioned / ALERT — the client was
//                             never deployed (the setup-bypassed precedent:
//                             a provisioning hole, not a user's fault)
//   state unknown           → EGRESS_STATE_UNKNOWN / step_up — never trust
//                             silence on a mandated path

import {
  type NormalizedSseEgress,
  type SseEgressAction,
  type SseEgressPosture,
  type SseEgressReasonCode,
  type SseEgressVerdict,
} from "./types";

export interface EvaluateSseEgressOptions {
  /** False when no egress record was returned for this device. Default true. */
  covered?: boolean;
  /** Does this deployment MANDATE the edge for this device? POSED BY THE
   *  CALLER, never defaulted. Omitted or false = unposed (unassessed,
   *  forecloses nothing). */
  egressMandated?: boolean;
}

export function evaluateSseEgress(
  egress: NormalizedSseEgress,
  options: EvaluateSseEgressOptions = {},
): SseEgressVerdict {
  const covered = options.covered ?? true;
  const mandated = options.egressMandated === true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: egress.deviceId };
  const verdict = (
    posture: SseEgressPosture,
    reasonCode: SseEgressReasonCode,
    recommendedAction: SseEgressAction,
    egressProtected: boolean,
  ): SseEgressVerdict => ({ ...base, posture, reasonCode, recommendedAction, egressProtected });

  if (!mandated) {
    return verdict("unassessed", "EGRESS_UNPOSED", "none", false);
  }
  if (!covered) {
    unknownSignals.push("egress_record");
    return verdict("unknown", "NOT_COVERED", "step_up", false);
  }
  if (egress.reportIntegrity === "malformed") {
    return verdict("unverified", "REPORT_MALFORMED", "step_up", false);
  }
  if (egress.bridgeReachable !== true) {
    unknownSignals.push("bridge_reachable");
    return verdict("unverified", "BRIDGE_UNREACHABLE", "step_up", false);
  }

  switch (egress.clientState) {
    case "tunneled": {
      if (egress.serviceObservingTraffic === true) {
        return verdict("egress_protected", "EGRESS_PROTECTED", "none", true);
      }
      if (egress.serviceObservingTraffic === false) {
        criticalFindings.push("tunneled_claim_contradicted_by_service");
        return verdict("unverified", "TUNNEL_UNCORROBORATED", "step_up", false);
      }
      unknownSignals.push("service_observing_traffic");
      return verdict("unverified", "EGRESS_STATE_UNKNOWN", "step_up", false);
    }
    case "bypassed":
      return verdict("egress_bypassed", "EGRESS_BYPASSED", "step_up", false);
    case "disabled":
      criticalFindings.push("egress_protection_disabled");
      return verdict("egress_disabled", "EGRESS_DISABLED", "alert", false);
    case "not_installed":
      criticalFindings.push("egress_client_not_installed");
      return verdict("egress_unprovisioned", "EGRESS_NOT_INSTALLED", "alert", false);
    default: {
      unknownSignals.push("client_state");
      return verdict("unverified", "EGRESS_STATE_UNKNOWN", "step_up", false);
    }
  }
}
