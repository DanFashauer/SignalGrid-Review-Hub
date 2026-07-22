import {
  type NormalizedOtPosture,
  type OtPosture,
  type OtPostureVerdict,
  type OtReasonCode,
  type OtRecommendedAction,
} from "./types";

/**
 * Pure, deterministic OT/IIoT posture evaluator. Folds an edge-gateway's read of
 * an industrial device into ONE posture + the action it warrants — fail-safe, so
 * the STRONGEST concern wins and anything unreadable RAISES the assurance bar.
 *
 * The plant-floor stakes shape the ladder:
 *  - a device on a FLAT network (reachable from IT), an unauthenticated OT
 *    protocol reachable beyond the cell, or an END-OF-LIFE/unpatchable device that
 *    can never be secured → RESTRICT (contain — the risk is structural);
 *  - a STALE gateway (we're blind to the device) or any unreadable control →
 *    STEP_UP (raise the bar; never trust silence);
 *  - merely OUTDATED-but-patchable firmware → STEP_UP (drift, fixable).
 *
 * `covered=false` = no edge gateway reports this device at all → unknown (a blind
 * spot), never secure.
 */

const ACTION_SEVERITY: Record<OtRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateOtOptions {
  /** False when no edge gateway reports this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: OtPosture;
  action: OtRecommendedAction;
  reason: OtReasonCode;
}

export function evaluateOtPosture(posture: NormalizedOtPosture, options: EvaluateOtOptions = {}): OtPostureVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  // Fail-safe unknown collection (raise the bar, never assume secure).
  if (posture.firmware === "unknown") unknownSignals.push("firmware");
  if (posture.patchable === null) unknownSignals.push("patchable");
  if (posture.segmentation === "unknown") unknownSignals.push("segmentation");
  if (posture.insecureProtocolExposed === null) unknownSignals.push("protocol_exposure");
  if (posture.gatewayLiveness === "unknown") unknownSignals.push("gateway_liveness");

  const base = { criticalFindings, unknownSignals, deviceType: posture.deviceType };

  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up" };
  }

  const candidates: Candidate[] = [];

  // An OT device reachable from IT — a Purdue-model violation; a PLC anyone on the
  // office LAN can reach.
  if (posture.segmentation === "flat") {
    criticalFindings.push("flat_network");
    candidates.push({ posture: "unsegmented", action: "restrict", reason: "FLAT_NETWORK" });
  }
  // An unauthenticated industrial protocol reachable beyond the cell — anyone can
  // command the device.
  if (posture.insecureProtocolExposed === true) {
    criticalFindings.push("insecure_protocol");
    candidates.push({ posture: "exposed", action: "restrict", reason: "INSECURE_PROTOCOL_EXPOSED" });
  }
  // End-of-life or explicitly unpatchable — the risk is permanent; contain it.
  // Label the reason honestly: EOL firmware vs. a device flagged unpatchable
  // whose firmware isn't (or isn't known to be) end-of-life.
  if (posture.firmware === "eol") {
    criticalFindings.push("unpatchable");
    candidates.push({ posture: "unpatchable", action: "restrict", reason: "FIRMWARE_EOL" });
  } else if (posture.patchable === false) {
    criticalFindings.push("unpatchable");
    candidates.push({ posture: "unpatchable", action: "restrict", reason: "FIRMWARE_UNPATCHABLE" });
  }
  // The gateway's reading is stale → we're effectively blind to the device.
  if (posture.gatewayLiveness === "stale") {
    candidates.push({ posture: "blind", action: "step_up", reason: "GATEWAY_STALE" });
  }
  // Anything unreadable raises the bar (silent-failure guard).
  if (unknownSignals.length > 0) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "OT_STATE_UNKNOWN" });
  }
  // Outdated but patchable — drift, fixable.
  if (posture.firmware === "outdated" && posture.patchable !== false) {
    candidates.push({ posture: "outdated", action: "step_up", reason: "FIRMWARE_OUTDATED" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "secure", action: "none", reason: "FULLY_SECURE" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
