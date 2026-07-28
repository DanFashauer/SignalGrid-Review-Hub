import type {
  DualControlOutcome,
  DualControlReasonCode,
  DualControlVerdict,
  NormalizedAuthorizer,
  NormalizedDualControl,
} from "./types";

/**
 * Pure, deterministic dual-control decision. Answers whether two distinct, authorized
 * humans are concurrently and verifiably authorizing THIS specific elevated action.
 *
 * The ladder is three-way, and — as in `pim-activation` — the middle rung is not a middle
 * severity, it is a state of the process:
 *
 *  - **Denied** is reserved for AFFIRMATIVE, known-bad facts: the two authorizers are the
 *    same person (self-authorization), one credential signed both halves (a shared token,
 *    physically impossible for two people), an authorizer's verification explicitly
 *    failed, a gesture was bound to a DIFFERENT action (a replay), an authorizer is
 *    explicitly not permitted for this action, or the two gestures were explicitly NOT
 *    co-present (the window expired). Each is a fact the request positively asserts, and
 *    denying costs a legitimate flow, so it is never done on a guess.
 *  - **SecondAuthorizerRequired** is the DEFAULT and the safe non-grant. Every UNKNOWN
 *    lands here: a malformed envelope, an unestablished co-presence, an authorizer who has
 *    not yet verified, a distinctness that cannot be determined. It neither releases the
 *    action nor punishes the first authorizer — it says "not enough, yet", which is the
 *    honest answer whenever two-person integrity is not yet positively proven.
 *  - **Granted** is the release, and it carries the full discipline the rest of this repo
 *    applies to a grant: POSITIVE CONFIRMATION OF EVERY INPUT. A known action class, a
 *    concrete action id, two positively-distinct identities, two positively-distinct
 *    credential instances, both authorizers user-verified, both bound to THIS action, both
 *    role-authorized, co-presence confirmed, and a request that parsed cleanly. Anything
 *    short of all of it is SecondAuthorizerRequired (or Denied, on an affirmative bad).
 *
 * SignalGrid releases nothing itself — it returns the answer and records the evidence.
 */
export function evaluateDualControl(req: NormalizedDualControl): DualControlVerdict {
  const blockingFindings: string[] = [];
  const unknownSignals: string[] = [];

  const bothAuthorizers: Array<["initiator" | "approver", NormalizedAuthorizer]> = [
    ["initiator", req.initiator],
    ["approver", req.approver],
  ];

  // ── Denied: affirmative known-bad. Never on a guess. ────────────────────────────
  if (req.distinctAuthorizers === false) blockingFindings.push("self_authorization");
  if (req.distinctCredentials === false) blockingFindings.push("shared_credential");
  for (const [role, a] of bothAuthorizers) {
    if (a.userVerified === false) blockingFindings.push(`${role}_verification_failed`);
    if (a.boundToAction === false) blockingFindings.push(`${role}_action_binding_mismatch`);
    if (a.roleAuthorized === false) blockingFindings.push(`${role}_not_permitted`);
  }
  if (req.coPresence === "expired") blockingFindings.push("co_presence_expired");

  // ── unknowns: each forecloses a grant, none of them denies ──────────────────────
  if (req.requestIntegrity !== "clean") unknownSignals.push("request_integrity");
  if (req.actionClass === "unknown") unknownSignals.push("action_class");
  if (req.actionId === null) unknownSignals.push("action_id");
  if (req.distinctAuthorizers === null) unknownSignals.push("distinct_authorizers");
  if (req.distinctCredentials === null) unknownSignals.push("distinct_credentials");
  if (req.coPresence === "unknown") unknownSignals.push("co_presence");
  for (const [role, a] of bothAuthorizers) {
    if (a.userVerified === null) unknownSignals.push(`${role}_user_verified`);
    if (a.boundToAction === null) unknownSignals.push(`${role}_action_binding`);
    if (a.roleAuthorized === null) unknownSignals.push(`${role}_role`);
  }

  if (blockingFindings.length > 0) {
    const reason = denyReason(blockingFindings);
    return {
      outcome: "Denied" satisfies DualControlOutcome,
      reasonCode: reason,
      explanation: explain(reason, req),
      blockingFindings,
      unknownSignals,
      twoPersonConfirmed: false,
      requestId: req.requestId,
    };
  }

  // ── Granted: every input positively confirmed, and nothing else ─────────────────
  const confirmed =
    req.requestIntegrity === "clean" &&
    req.actionClass !== "unknown" &&
    req.actionId !== null &&
    req.distinctAuthorizers === true &&
    req.distinctCredentials === true &&
    req.coPresence === "confirmed" &&
    req.initiator.userVerified === true &&
    req.approver.userVerified === true &&
    req.initiator.boundToAction === true &&
    req.approver.boundToAction === true &&
    req.initiator.roleAuthorized === true &&
    req.approver.roleAuthorized === true;

  if (confirmed) {
    return {
      outcome: "Granted" satisfies DualControlOutcome,
      reasonCode: "GRANTED_TWO_PERSON_CONFIRMED",
      explanation: explain("GRANTED_TWO_PERSON_CONFIRMED", req),
      blockingFindings: [],
      unknownSignals: [],
      twoPersonConfirmed: true,
      requestId: req.requestId,
    };
  }

  // ── SecondAuthorizerRequired: the safe non-grant for every unknown ──────────────
  const reason: DualControlReasonCode =
    req.requestIntegrity !== "clean" ? "REQUEST_MALFORMED" : "SECOND_AUTHORIZER_REQUIRED";
  return {
    outcome: "SecondAuthorizerRequired" satisfies DualControlOutcome,
    reasonCode: reason,
    explanation: explain(reason, req),
    blockingFindings: [],
    unknownSignals,
    twoPersonConfirmed: false,
    requestId: req.requestId,
  };
}

/** The most serious affirmative bad fact wins the reason code. Order matters: a shared
 *  identity or credential is a structural break in two-person integrity and ranks above a
 *  single authorizer's failed gesture. */
function denyReason(findings: string[]): DualControlReasonCode {
  if (findings.includes("self_authorization")) return "SELF_AUTHORIZATION";
  if (findings.includes("shared_credential")) return "SHARED_CREDENTIAL";
  if (findings.some((f) => f.endsWith("_action_binding_mismatch"))) return "ACTION_BINDING_MISMATCH";
  if (findings.some((f) => f.endsWith("_verification_failed"))) return "VERIFICATION_FAILED";
  if (findings.some((f) => f.endsWith("_not_permitted"))) return "AUTHORIZER_NOT_PERMITTED";
  if (findings.includes("co_presence_expired")) return "CO_PRESENCE_EXPIRED";
  return "SECOND_AUTHORIZER_REQUIRED";
}

function explain(reason: DualControlReasonCode, req: NormalizedDualControl): string {
  const action = req.actionId ? `action ${req.actionId}` : "the requested action";
  switch (reason) {
    case "GRANTED_TWO_PERSON_CONFIRMED":
      return `Two-person integrity confirmed for ${action}: two distinct, separately-credentialed, user-verified authorizers, both bound to this action and co-present. Released.`;
    case "SELF_AUTHORIZATION":
      return `Refused: the initiator and second authorizer are the same identity. Dual control requires two distinct people — one person cannot witness their own ${action}.`;
    case "SHARED_CREDENTIAL":
      return `Refused: one authenticator instance signed both halves of ${action}. Two people cannot share a single credential — this is a single point of forgery, not dual control.`;
    case "VERIFICATION_FAILED":
      return `Refused: an authorizer's user-verification gesture (biometric + PIN) did not complete for ${action}.`;
    case "ACTION_BINDING_MISMATCH":
      return `Refused: an authorizer's gesture was bound to a different action, not ${action}. A signature for one action cannot release another.`;
    case "AUTHORIZER_NOT_PERMITTED":
      return `Refused: an authorizer is not in the permitted set for ${action}. Dual control requires two AUTHORIZED people, not any two people.`;
    case "CO_PRESENCE_EXPIRED":
      return `Refused: the two authorizations for ${action} were not captured within the co-presence window. Two-person integrity requires them concurrent.`;
    case "REQUEST_MALFORMED":
      return `Held: the dual-control request for ${action} could not be fully read. Re-submit a clean request with both authorizers — an unreadable field is never a confirmation.`;
    case "SECOND_AUTHORIZER_REQUIRED":
    default:
      return `Held: two-person integrity for ${action} is not yet positively proven. A second authorized, verified, co-present authorizer is required before release.`;
  }
}
