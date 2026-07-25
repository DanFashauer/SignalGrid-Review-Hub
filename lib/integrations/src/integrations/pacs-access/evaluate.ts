import {
  type PacsAccessAction,
  type PacsAccessPosture,
  type PacsAccessReasonCode,
  type PacsAccessVerdict,
  type NormalizedPacsAccess,
} from "./types";

/**
 * Pure, deterministic physical access-control (PACS) evaluator. Folds a controlled
 * entry's evaluated state into ONE posture + the action it warrants, fail-safe.
 *
 * The shared-device physical-custody question dominates:
 *  - a badge/biometric presentation actively DENIED, a REVOKED credential, or a PACS
 *    holder who does NOT match the checked-out device holder is the strongest
 *    negative → ESCALATE;
 *  - an anti-passback (tailgating) VIOLATION, or a FORCED door, is a physical breach
 *    → RESTRICT (contain);
 *  - an entry OUT OF SCHEDULE / OUT OF ZONE, or a door HELD open, → STEP_UP; anything
 *    unreadable, or the bridge unreachable, → STEP_UP (never trust silence);
 *  - only a POSITIVELY-confirmed clean entry — GRANTED, authorized, in-bounds, at a
 *    SECURE door, with the PACS identity matching the checked-out holder, on a KNOWN
 *    credential, with the bridge reachable — contributes 'none'. Worst-concern-wins.
 *
 * `covered=false` = no PACS result was returned for this entry → unknown (a gap),
 * step_up.
 */

const ACTION_SEVERITY: Record<PacsAccessAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluatePacsAccessOptions {
  /** False when no PACS result was returned for this entry. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: PacsAccessPosture;
  action: PacsAccessAction;
  reason: PacsAccessReasonCode;
}

export function evaluatePacsAccess(
  pacs: NormalizedPacsAccess,
  options: EvaluatePacsAccessOptions = {},
): PacsAccessVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: pacs.deviceId };

  // No PACS result at all → a gap. Raise the bar (never a confirmed physical entry).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", physicalAccessConfirmed: false };
  }

  const candidates: Candidate[] = [];

  // ── escalate: the person should not be transacting here at all ────────────────
  // A denial, a revoked credential, or a PACS holder ≠ the checked-out device holder
  // are LOCALLY-known facts (from the access log / rule / subject compare) that do
  // not need the bridge's liveness, so they are collected regardless of reachability.
  if (pacs.accessResult === "denied") {
    criticalFindings.push("access_denied");
    candidates.push({ posture: "access_denied", action: "escalate", reason: "ACCESS_DENIED" });
  }
  if (pacs.authorization === "revoked") {
    criticalFindings.push("credential_revoked");
    candidates.push({ posture: "credential_revoked", action: "escalate", reason: "CREDENTIAL_REVOKED" });
  }
  if (pacs.identityMatched === false) {
    criticalFindings.push("identity_mismatch");
    candidates.push({ posture: "identity_mismatch", action: "escalate", reason: "IDENTITY_MISMATCH" });
  }

  // ── restrict: a physical breach at the door — contain ─────────────────────────
  if (pacs.antipassback === "violation") {
    criticalFindings.push("antipassback_violation");
    candidates.push({ posture: "antipassback_breach", action: "restrict", reason: "ANTIPASSBACK_VIOLATION" });
  }
  if (pacs.doorState === "forced") {
    criticalFindings.push("door_forced");
    candidates.push({ posture: "door_forced", action: "restrict", reason: "DOOR_FORCED" });
  }

  // ── step_up: out of bounds, a held door, or anything unreadable ───────────────
  if (pacs.authorization === "out_of_schedule") {
    candidates.push({ posture: "out_of_bounds", action: "step_up", reason: "OUT_OF_SCHEDULE" });
  } else if (pacs.authorization === "out_of_zone") {
    candidates.push({ posture: "out_of_bounds", action: "step_up", reason: "OUT_OF_ZONE" });
  } else if (pacs.authorization === "unknown") {
    unknownSignals.push("authorization");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  if (pacs.doorState === "held_open") {
    candidates.push({ posture: "door_held", action: "step_up", reason: "DOOR_HELD_OPEN" });
  } else if (pacs.doorState === "unknown") {
    unknownSignals.push("door_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // A grant demands a POSITIVELY-confirmed GRANT result — a denied case escalated
  // above; an `unknown` access result is not proof of entry.
  if (pacs.accessResult === "unknown") {
    unknownSignals.push("access_result");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // Anti-passback must be positively OK — an unreadable state is not proof.
  if (pacs.antipassback === "unknown") {
    unknownSignals.push("antipassback");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // The credential type must be known — an unrecognized reader/credential is not a
  // positively-confirmed presentation.
  if (pacs.credentialType === "unknown") {
    unknownSignals.push("credential_type");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // Identity match must be POSITIVELY confirmed. `false` escalated above; a null
  // (unreported) means we cannot confirm the holder is the checked-out device holder.
  if (pacs.identityMatched === null) {
    unknownSignals.push("identity_matched");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE verification: without an explicit bridgeReachable===true
  // the clean read may be stale/cached, so it never grants. (An explicit false is an
  // outage — the same.)
  if (pacs.bridgeReachable !== true) {
    if (pacs.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BRIDGE_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed is the positively-confirmed physical-access grant;
  // it survives only if NO candidate was raised — i.e. a granted, authorized,
  // anti-passback-ok, secure-door, identity-matched entry on a known credential with
  // the bridge reachable.
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "physical_access_ok", action: "none", reason: "PHYSICAL_ACCESS_GRANTED" },
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    physicalAccessConfirmed: winner.action === "none",
  };
}
