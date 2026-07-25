import {
  type TokenBindingAction,
  type TokenBindingPosture,
  type TokenBindingReasonCode,
  type TokenBindingVerdict,
  type NormalizedTokenBinding,
} from "./types";

/**
 * Pure, deterministic token-binding / proof-of-possession evaluator. Folds a
 * device's access-token binding state into ONE posture + the action it warrants,
 * fail-safe.
 *
 * The shared-device replay question dominates:
 *  - a bound token whose PoP key belongs to a DIFFERENT device is the strongest
 *    negative — a token minted elsewhere presented here (a stolen/exfiltrated bound
 *    token) → ESCALATE;
 *  - an unbound BEARER token (or one with no PoP key) is replayable by anyone who
 *    copies it → RESTRICT (contain — require a sender-constrained token / re-auth);
 *  - a sender-constrained token that is WEAKENED — a software (exportable) key, an
 *    unattested "hardware" key, or a token that is not audience-restricted — or whose
 *    binding we cannot read, or whose bridge was unreachable → STEP_UP (raise the bar);
 *  - only a POSITIVELY-confirmed sender-constrained token — DPoP or mTLS, an ATTESTED
 *    HARDWARE key, audience-restricted, bound to THIS device, with the bridge
 *    reachable — contributes 'none'. Worst-concern-wins.
 *
 * `covered=false` = no token-inspection result was returned for this device →
 * unknown (a gap), step_up.
 */

const ACTION_SEVERITY: Record<TokenBindingAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateTokenBindingOptions {
  /** False when no token-inspection result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: TokenBindingPosture;
  action: TokenBindingAction;
  reason: TokenBindingReasonCode;
}

export function evaluateTokenBinding(
  token: NormalizedTokenBinding,
  options: EvaluateTokenBindingOptions = {},
): TokenBindingVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: token.deviceId };

  // No token-inspection result at all → a gap. Raise the bar (never a bound grant).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", senderConstrained: false };
  }

  const candidates: Candidate[] = [];

  // The PoP key/cert is bound to a DIFFERENT device — a token minted elsewhere being
  // presented here. This is a LOCALLY-known fact (the enrolled device's key vs the
  // token's), so it is checked BEFORE the bridge-reachability downgrade below: an
  // outage must never soften a proven device mismatch. The strongest negative.
  if (token.boundToDevice === false) {
    criticalFindings.push("token_device_mismatch");
    candidates.push({ posture: "token_device_mismatch", action: "escalate", reason: "TOKEN_DEVICE_MISMATCH" });
  }

  // An unbound bearer token — no proof-of-possession, so anyone who copies it can
  // replay it from any device. Contain. (A `none` keyProtection is the same fact:
  // there is no PoP key.) Also a locally-known containment fact.
  if (token.binding === "bearer" || token.keyProtection === "none") {
    criticalFindings.push("unbound_bearer_token");
    candidates.push({ posture: "bearer_token", action: "restrict", reason: "UNBOUND_BEARER_TOKEN" });
  } else if (token.binding === "unknown") {
    unknownSignals.push("binding");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BINDING_STATE_UNKNOWN" });
  }

  // The PoP key is in an EXPORTABLE software store (not the Secure Enclave / TPM) —
  // it can be exfiltrated, so the binding is weaker than hardware.
  if (token.keyProtection === "software") {
    candidates.push({ posture: "weak_binding", action: "step_up", reason: "SOFTWARE_BOUND_KEY" });
  } else if (token.keyProtection === "unknown") {
    unknownSignals.push("key_protection");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BINDING_STATE_UNKNOWN" });
  }

  // Hardware protection is only trustworthy if ATTESTED — an unproven "hardware" key
  // may actually be exportable. Require positive confirmation (true); false or an
  // unreported null both raise the bar.
  if (token.keyAttested !== true) {
    if (token.keyAttested === null) unknownSignals.push("key_attested");
    candidates.push({ posture: "weak_binding", action: "step_up", reason: "KEY_NOT_ATTESTED" });
  }

  // A token that is not audience/resource-restricted can be replayed to a different
  // service. Require positive confirmation.
  if (token.audienceRestricted !== true) {
    if (token.audienceRestricted === null) unknownSignals.push("audience_restricted");
    candidates.push({ posture: "weak_binding", action: "step_up", reason: "TOKEN_NOT_AUDIENCE_RESTRICTED" });
  }

  // Device binding must be POSITIVELY confirmed. `false` escalated above; a null
  // (unreported) means we cannot confirm the token belongs to this device.
  if (token.boundToDevice === null) {
    unknownSignals.push("bound_to_device");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BINDING_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE verification: without an explicit bridgeReachable===true
  // the clean read may be stale/cached, so it never grants. (An explicit false is an
  // outage — the same.)
  if (token.bridgeReachable !== true) {
    if (token.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BRIDGE_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed is the positively-confirmed sender-constrained grant;
  // it survives only if NO candidate was raised — i.e. a DPoP/mTLS token with an
  // attested hardware key, audience-restricted, bound to this device, bridge reachable.
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "sender_constrained", action: "none", reason: "SENDER_CONSTRAINED_TOKEN" },
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    senderConstrained: winner.action === "none",
  };
}
