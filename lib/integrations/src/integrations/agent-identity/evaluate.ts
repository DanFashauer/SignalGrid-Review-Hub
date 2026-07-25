import {
  type AgentIdentityAction,
  type AgentIdentityPosture,
  type AgentIdentityReasonCode,
  type AgentIdentityVerdict,
  type NormalizedAgentIdentity,
} from "./types";

/**
 * Pure, deterministic agentic / non-human-identity (NHI) evaluator. Folds "who is
 * actually taking this action, and are they governed?" into ONE posture + the action
 * it warrants, fail-safe.
 *
 * The governance model treats a non-human identity like a privileged access request:
 *  - an UNREGISTERED non-human identity (a shadow agent absent from the inventory),
 *    an EXPIRED approval (approval lapsed but access persisted — the non-human
 *    equivalent of a leaver still holding a key), or a STANDING never-expiring
 *    credential are the strongest negatives → ESCALATE;
 *  - an OVER-SCOPED or entirely UNSCOPED agent, one acting UNRECORDED (no audit
 *    trail), or one that was NEVER approved → RESTRICT (contain);
 *  - a LONG-LIVED credential or a PENDING approval → STEP_UP; anything unreadable, or
 *    the bridge unreachable, → STEP_UP (never trust silence);
 *  - only two states contribute 'none': a positively-confirmed HUMAN actor, or a
 *    non-human identity confirmed FULLY governed — registered, short-lived token,
 *    least privilege, approved, and recorded. Worst-concern-wins.
 *
 * A HUMAN actor is not judged on the agent-governance fields at all: registry
 * membership, agent approval, and agent recording are meaningless for a person, and
 * a human's credential lifetime and privilege are already covered by the
 * `token-binding` and `access-governance` dimensions. This mirrors how
 * `access-governance` treats session monitoring as moot for a non-elevated
 * principal — the fields are not merely ignored, they do not apply.
 *
 * `covered=false` = no governance result was returned for this actor → unknown (a
 * gap), step_up.
 */

const ACTION_SEVERITY: Record<AgentIdentityAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAgentIdentityOptions {
  /** False when no governance result was returned for this actor. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AgentIdentityPosture;
  action: AgentIdentityAction;
  reason: AgentIdentityReasonCode;
}

export function evaluateAgentIdentity(
  actor: NormalizedAgentIdentity,
  options: EvaluateAgentIdentityOptions = {},
): AgentIdentityVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const nonHuman = actor.actorType === "agent" || actor.actorType === "service_account";
  const base = { criticalFindings, unknownSignals, deviceId: actor.deviceId, nonHumanActor: nonHuman };

  // No governance result at all → a gap. Raise the bar (never a governed grant).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", actorGoverned: false };
  }

  // We cannot tell WHO is acting. That is the whole question this dimension answers,
  // so an unreadable actor type can never grant.
  if (actor.actorType === "unknown") {
    unknownSignals.push("actor_type");
    return { ...base, posture: "unverified", reasonCode: "AGENT_STATE_UNKNOWN", recommendedAction: "step_up", actorGoverned: false };
  }

  // The grant demands POSITIVE verification of liveness: without an explicit
  // bridgeReachable===true the read may be stale/cached. Applies to human and
  // non-human alike, and is checked first so an outage never grants either.
  if (actor.bridgeReachable !== true) {
    if (actor.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    return { ...base, posture: "unverified", reasonCode: "BRIDGE_UNREACHABLE", recommendedAction: "step_up", actorGoverned: false };
  }

  // A confirmed HUMAN actor. The agent-governance fields below do not apply to a
  // person — there is no registry entry, agent approval, or agent recording for a
  // human — so they are not evaluated. The human's own credential and privilege are
  // judged by the token-binding and access-governance dimensions.
  if (actor.actorType === "human") {
    return { ...base, posture: "human_actor", reasonCode: "HUMAN_ACTOR", recommendedAction: "none", actorGoverned: true };
  }

  // From here the actor is a NON-HUMAN identity (agent or service account) and must
  // be fully governed to act.
  const candidates: Candidate[] = [];

  // ── escalate: this identity should not be acting at all ──────────────────────
  if (actor.agentRegistered === false) {
    criticalFindings.push("unregistered_agent");
    candidates.push({ posture: "unregistered_agent", action: "escalate", reason: "UNREGISTERED_AGENT" });
  }
  if (actor.approvalState === "expired") {
    criticalFindings.push("approval_expired");
    candidates.push({ posture: "ungoverned_agent", action: "escalate", reason: "APPROVAL_EXPIRED" });
  }
  if (actor.tokenLifetime === "standing") {
    criticalFindings.push("standing_credential");
    candidates.push({ posture: "weak_agent_credential", action: "escalate", reason: "STANDING_CREDENTIAL" });
  }

  // ── restrict: contain an ungoverned or unauditable agent ─────────────────────
  if (actor.scopeState === "unscoped") {
    criticalFindings.push("agent_unscoped");
    candidates.push({ posture: "over_scoped_agent", action: "restrict", reason: "AGENT_UNSCOPED" });
  } else if (actor.scopeState === "over_scoped") {
    candidates.push({ posture: "over_scoped_agent", action: "restrict", reason: "AGENT_OVER_SCOPED" });
  }
  if (actor.recordingState === "unrecorded") {
    criticalFindings.push("agent_unrecorded");
    candidates.push({ posture: "unrecorded_agent", action: "restrict", reason: "AGENT_UNRECORDED" });
  }
  if (actor.approvalState === "none") {
    candidates.push({ posture: "ungoverned_agent", action: "restrict", reason: "APPROVAL_ABSENT" });
  }

  // ── step_up: governance drift, or anything unreadable ────────────────────────
  if (actor.tokenLifetime === "long_lived") {
    candidates.push({ posture: "weak_agent_credential", action: "step_up", reason: "LONG_LIVED_CREDENTIAL" });
  } else if (actor.tokenLifetime === "unknown") {
    unknownSignals.push("token_lifetime");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }
  if (actor.approvalState === "pending") {
    candidates.push({ posture: "ungoverned_agent", action: "step_up", reason: "APPROVAL_PENDING" });
  } else if (actor.approvalState === "unknown") {
    unknownSignals.push("approval_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }
  if (actor.scopeState === "unknown") {
    unknownSignals.push("scope_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }
  if (actor.recordingState === "unknown") {
    unknownSignals.push("recording_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }
  // Registry membership must be POSITIVELY confirmed. An explicit false escalated
  // above; a null means we cannot confirm the identity is in the inventory at all.
  if (actor.agentRegistered === null) {
    unknownSignals.push("agent_registered");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }

  // Worst-concern-wins. The seed is the fully-governed grant; it survives only if NO
  // candidate was raised — a registered, short-lived, least-privilege, approved,
  // recorded non-human identity.
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "governed_agent", action: "none", reason: "GOVERNED_AGENT" },
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    actorGoverned: winner.action === "none",
  };
}
