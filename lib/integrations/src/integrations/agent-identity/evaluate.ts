import {
  type ActorClassification,
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
 * That branch is safe only in concert with `normalizeReport`, which refuses to emit
 * `actorType === "human"` for a report that is malformed or that asserts governance
 * state no person can hold. Read the two together — neither is fail-safe alone, and
 * this file additionally refuses to grant on a malformed report so the allow path does
 * not DEPEND on the normalizer having voided the label.
 *
 * The honest limit of this dimension: it trusts the bridge's actor classification. A
 * bridge that simply lies — reporting a clean, silent `"human"` for an AI agent — is
 * granted, and no amount of field cross-checking here can catch that. What the checks
 * buy is that the lie must be CONSISTENT and well-formed; a sloppy or half-hearted one
 * fails closed.
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
  const classification: ActorClassification =
    actor.actorType === "human" ? "human" : nonHuman ? "non_human" : "unclassified";
  const base = {
    criticalFindings,
    unknownSignals,
    deviceId: actor.deviceId,
    nonHumanActor: nonHuman,
    actorClassification: classification,
  };

  // No governance result at all → a gap. Raise the bar (never a governed grant).
  // Nothing about the actor is confirmed here, so it is not reported as non-human.
  if (!covered) {
    return { ...base, nonHumanActor: false, actorClassification: "unclassified", posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", actorGoverned: false };
  }

  const candidates: Candidate[] = [];

  // Defence in depth. The normalizer already voids a "human" claim on a malformed
  // report, so in practice this fires only for a non-human or already-unreadable
  // actor — but the grant must not DEPEND on that having happened. A report we could
  // not fully parse is never a grant, whatever its fields normalized to.
  if (actor.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // Governance facts are collected for any actor that is NOT a confirmed human —
  // including one whose type is unreadable. A known-bad governance fact (an
  // unregistered identity, a lapsed approval, a standing credential) is known-bad
  // whether or not we could read the actor label or reach the bridge, so these are
  // gathered BEFORE the unknown/liveness gates below rather than being short-circuited
  // by them. Otherwise a single unreachable-bridge flag would silently demote a shadow
  // agent from escalate to step_up and erase its findings.
  //
  // They are NOT collected for a confirmed human: those fields have no human meaning,
  // and the normalizer has already forced any "human" report that carries them to an
  // unreadable type.
  if (actor.actorType !== "human") {
    // ── escalate: this identity should not be acting at all ────────────────────
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

    // ── restrict: contain an ungoverned or unauditable agent ───────────────────
    // Every restrict-level condition contributes a critical finding, matching the
    // sibling connectors.
    if (actor.scopeState === "unscoped") {
      criticalFindings.push("agent_unscoped");
      candidates.push({ posture: "over_scoped_agent", action: "restrict", reason: "AGENT_UNSCOPED" });
    } else if (actor.scopeState === "over_scoped") {
      criticalFindings.push("agent_over_scoped");
      candidates.push({ posture: "over_scoped_agent", action: "restrict", reason: "AGENT_OVER_SCOPED" });
    }
    if (actor.recordingState === "unrecorded") {
      criticalFindings.push("agent_unrecorded");
      candidates.push({ posture: "unrecorded_agent", action: "restrict", reason: "AGENT_UNRECORDED" });
    }
    if (actor.approvalState === "none") {
      criticalFindings.push("approval_absent");
      candidates.push({ posture: "ungoverned_agent", action: "restrict", reason: "APPROVAL_ABSENT" });
    }

    // ── step_up: governance drift, or anything unreadable ──────────────────────
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
  }

  // We cannot tell WHO is acting — the whole question this dimension answers. Raised
  // as a candidate (not a short-circuit) so any known-bad fact above still outranks it.
  if (actor.actorType === "unknown") {
    unknownSignals.push("actor_type");
    candidates.push({ posture: "unverified", action: "step_up", reason: "AGENT_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE verification of liveness: without an explicit
  // bridgeReachable===true the read may be stale/cached. Applies to human and
  // non-human alike — a human actor with unreported reachability does not grant.
  if (actor.bridgeReachable !== true) {
    if (actor.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BRIDGE_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed is the grant appropriate to the actor: a confirmed
  // human, or a fully-governed non-human identity. It survives only if NO candidate
  // was raised. (An unreadable actor type always raises one, so the non-human seed
  // can never be reached by an actor we could not identify.)
  const seed: Candidate =
    actor.actorType === "human"
      ? { posture: "human_actor", action: "none", reason: "HUMAN_ACTOR" }
      : { posture: "governed_agent", action: "none", reason: "GOVERNED_AGENT" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    actorGoverned: winner.action === "none",
  };
}
