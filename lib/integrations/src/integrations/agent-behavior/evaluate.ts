import {
  type AgentBehaviorAction,
  type AgentBehaviorPosture,
  type AgentBehaviorReasonCode,
  type AgentBehaviorVerdict,
  type NormalizedAgentBehavior,
} from "./types";

/**
 * Pure, deterministic agent-BEHAVIOR (action-judgment) evaluator. Folds "is THIS
 * action sane and authorized, or anomalous?" into ONE posture + the action it warrants,
 * fail-closed. This is the judgment layer that questions the action, not the identity:
 * a fully-governed agent (registered, short-lived, least-privilege, approved) can still
 * do something no human would, and this is what catches it.
 *
 *  - a BURST volume — orders of magnitude over baseline, the one-line-prompt-that-became-
 *    40,000-updates — is the strongest negative → ESCALATE;
 *  - an action with NO provenance (no authorizing intent/process/change-window behind
 *    it), or a BROAD blast radius (one action fanning out across many resources at once)
 *    → RESTRICT (contain);
 *  - an ELEVATED volume, a FIRST-SEEN target (this identity has never touched this app),
 *    or a SUPERHUMAN cadence → STEP_UP (require human judgment); anything unreadable, or
 *    the bridge unreachable, → STEP_UP (never trust silence);
 *  - exactly ONE state contributes 'none': an action positively confirmed in-pattern on
 *    EVERY signal — within-baseline volume, familiar target, authorized provenance,
 *    scoped blast radius, human-plausible cadence — with the bridge reachable.
 *    Worst-concern-wins.
 *
 * `covered=false` = no behavioral result was returned for this action → unknown (a gap),
 * step_up.
 */

const ACTION_SEVERITY: Record<AgentBehaviorAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAgentBehaviorOptions {
  /** False when no behavioral result was returned for this action. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AgentBehaviorPosture;
  action: AgentBehaviorAction;
  reason: AgentBehaviorReasonCode;
}

export function evaluateAgentBehavior(
  behavior: NormalizedAgentBehavior,
  opts: EvaluateAgentBehaviorOptions = {},
): AgentBehaviorVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceId: behavior.deviceId };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["coverage"],
      actionJudgedSafe: false,
    };
  }

  const candidates: Candidate[] = [];

  // Defence in depth: a report we could not fully parse is never a grant, whatever its
  // fields normalized to.
  if (behavior.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── escalate: a runaway action ─────────────────────────────────────────────────
  if (behavior.volumeState === "burst") {
    criticalFindings.push("volume_burst");
    candidates.push({ posture: "volume_burst", action: "escalate", reason: "VOLUME_BURST" });
  }

  // ── restrict: contain an unauthorized or wide-reaching action ──────────────────
  if (behavior.provenance === "absent") {
    criticalFindings.push("no_provenance");
    candidates.push({ posture: "no_provenance", action: "restrict", reason: "NO_PROVENANCE" });
  }
  if (behavior.blastRadius === "broad") {
    criticalFindings.push("broad_blast");
    candidates.push({ posture: "broad_blast", action: "restrict", reason: "BROAD_BLAST" });
  }

  // ── step_up: judgment needed, or anything unreadable ───────────────────────────
  if (behavior.volumeState === "elevated") {
    candidates.push({ posture: "volume_elevated", action: "step_up", reason: "VOLUME_ELEVATED" });
  } else if (behavior.volumeState === "unknown") {
    unknownSignals.push("volume_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BEHAVIOR_UNKNOWN" });
  }

  if (behavior.targetFamiliarity === "first_seen") {
    candidates.push({ posture: "unfamiliar_target", action: "step_up", reason: "UNFAMILIAR_TARGET" });
  } else if (behavior.targetFamiliarity === "unknown") {
    unknownSignals.push("target_familiarity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BEHAVIOR_UNKNOWN" });
  }

  if (behavior.cadence === "superhuman") {
    candidates.push({ posture: "superhuman_cadence", action: "step_up", reason: "SUPERHUMAN_CADENCE" });
  } else if (behavior.cadence === "unknown") {
    unknownSignals.push("cadence");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BEHAVIOR_UNKNOWN" });
  }

  // Provenance and blast radius must be POSITIVELY confirmed for the grant: an unknown
  // is not the affirmative "authorized"/"scoped" the `none` state requires.
  if (behavior.provenance === "unknown") {
    unknownSignals.push("provenance");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BEHAVIOR_UNKNOWN" });
  }
  if (behavior.blastRadius === "unknown") {
    unknownSignals.push("blast_radius");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BEHAVIOR_UNKNOWN" });
  }

  // The grant demands POSITIVE verification of liveness: without an explicit
  // bridgeReachable===true the read may be stale/cached.
  if (behavior.bridgeReachable !== true) {
    if (behavior.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BRIDGE_UNREACHABLE" });
  }

  // Worst-concern-wins. ONE state grants: an action positively confirmed in-pattern on
  // every signal with a reachable bridge. Every unknown/absent above adds a step_up
  // candidate, so the seed only survives when nothing fired.
  const seed: Candidate = { posture: "in_pattern", action: "none", reason: "IN_PATTERN" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    actionJudgedSafe: winner.action === "none",
  };
}
