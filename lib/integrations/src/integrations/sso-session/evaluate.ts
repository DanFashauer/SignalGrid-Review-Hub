import {
  type SsoSessionAction,
  type SsoSessionPosture,
  type SsoSessionReasonCode,
  type SsoSessionVerdict,
  type NormalizedSsoSession,
} from "./types";

/**
 * Pure, deterministic SSO session-binding evaluator. Folds a device's live SSO
 * session into ONE posture + the action it warrants, fail-safe.
 *
 * The shared-device custody question dominates:
 *  - a session whose subject does NOT match the checked-out badge-holder is a
 *    LEFTOVER/hijacked session — the strongest negative: a live one ESCALATES,
 *    an expired-but-cached one RESTRICTS (still contain the leftover);
 *  - an ACTIVE session bound to no known holder → RESTRICT (contain it);
 *  - a session BOUND to the current holder is judged on assurance + freshness:
 *    single-factor / near- or past-expiry / unreadable → STEP_UP (re-auth);
 *    only MFA-backed AND fresh grants the top tier (`bound_strong` / none);
 *  - NO active session is the baseline (`no_session` / none) — authentication is
 *    handled by the flow, not penalized here;
 *  - the IdP being unreachable, or an unknown binding, NEVER grants — step_up.
 *
 * `covered=false` = no session result was returned for this device at all →
 * unknown (a gap), step_up.
 */

const ACTION_SEVERITY: Record<SsoSessionAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateSsoSessionOptions {
  /** False when no session result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: SsoSessionPosture;
  action: SsoSessionAction;
  reason: SsoSessionReasonCode;
}

export function evaluateSsoSession(
  session: NormalizedSsoSession,
  options: EvaluateSsoSessionOptions = {},
): SsoSessionVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: session.deviceId };

  // No session result at all → a gap. Raise the bar (never a bound-trusted grant).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", subjectBound: false };
  }

  // The current holder is not the session's subject → a leftover/hijacked session.
  // The strongest negative on a shared device: a live one escalates; an expired-
  // but-present one still restricts (contain the leftover). This is a LOCALLY-known
  // fact (subject vs badge-holder) that does not need the IdP, so it is checked
  // BEFORE the IdP-outage downgrade below — an outage must never soften a leftover.
  if (session.binding === "mismatched") {
    criticalFindings.push("session_subject_mismatch");
    const action: SsoSessionAction = session.state === "active" ? "escalate" : "restrict";
    return { ...base, posture: "leftover_session", reasonCode: "SESSION_SUBJECT_MISMATCH", recommendedAction: action, subjectBound: false };
  }

  // An ACTIVE session attributable to no known holder → contain it. Also a locally-
  // known containment fact, kept above the IdP-outage downgrade for the same reason.
  if (session.state === "active" && session.binding === "unbound") {
    criticalFindings.push("unbound_active_session");
    return { ...base, posture: "unbound_session", reasonCode: "UNBOUND_ACTIVE_SESSION", recommendedAction: "restrict", subjectBound: false };
  }

  // Could not reach the IdP to VERIFY the session → cannot trust its liveness /
  // assurance / freshness for this decision. Raise the bar; never grant. (The two
  // strongest, locally-determinable concerns above are already handled.)
  if (session.idpReachable === false) {
    return { ...base, posture: "unverified", reasonCode: "IDP_UNREACHABLE", recommendedAction: "step_up", subjectBound: false };
  }

  // No live session to judge → baseline. Authentication is gated by the flow, not
  // penalized here. (Distinct from the uncovered gap above.)
  if (session.state === "none") {
    return { ...base, posture: "no_session", reasonCode: "NO_ACTIVE_SESSION", recommendedAction: "none", subjectBound: false };
  }

  // A live SHARED-account session with no credential-level attribution is its own
  // visible state, not a generic unknown: "the account authenticated" is true and
  // "this person is identified" is not, and on a shared account the subject can
  // never close that gap — only the authenticating credential's registered holder
  // can (DigitalPersona v4.4.0-class multiple device-bound passkeys). Checked
  // WITHOUT trusting the binding label, so an evidence-free `bound` on a
  // holderless shared session can never grant even if it reaches this evaluator
  // unnormalized. step_up — re-authenticate as yourself — never a lockout: the
  // shared-account pattern is legitimate; its anonymity is the defect.
  if (session.accountScope === "shared" && session.credentialHolder === null) {
    unknownSignals.push("credential_holder");
    return { ...base, posture: "unattributed_shared", reasonCode: "SHARED_SESSION_UNATTRIBUTED", recommendedAction: "step_up", subjectBound: false };
  }

  // Anything not POSITIVELY bound to the current holder cannot grant — an unknown
  // binding, or a non-active unbound session (active-unbound handled above). Raise
  // the bar. This guarantees the branch below is a genuinely bound session.
  if (session.binding !== "bound") {
    if (session.binding === "unknown") unknownSignals.push("binding");
    return { ...base, posture: "unverified", reasonCode: "SESSION_STATE_UNKNOWN", recommendedAction: "step_up", subjectBound: false };
  }

  // From here the session is BOUND to the current holder. It is a real, attributed
  // session — judged on liveness, assurance, and freshness, worst-concern-wins.
  const subjectBound = session.state === "active";
  const candidates: Candidate[] = [];

  // Bound but not confirmed LIVE — expired/cached, or a liveness the bridge could
  // not determine (`state` unknown) — or a stale freshness → re-authenticate. Only
  // a confirmed-ACTIVE session can grant; an unknown-liveness session NEVER does.
  if (session.state !== "active" || session.freshness === "expired") {
    if (session.state === "unknown") unknownSignals.push("state");
    const reason = session.state === "unknown" ? "SESSION_STATE_UNKNOWN" : "SESSION_EXPIRED";
    candidates.push({ posture: "bound_weak", action: "step_up", reason });
  } else if (session.freshness === "near_expiry") {
    // Inside the renewal window → re-authenticate. `monitor` would compose to the
    // 'ok' tier and open no incident, letting a near-expiry session pass unchecked;
    // the contract requires near/past-expiry bound sessions to raise the bar.
    candidates.push({ posture: "bound_weak", action: "step_up", reason: "SESSION_NEAR_EXPIRY" });
  } else if (session.freshness === "unknown") {
    unknownSignals.push("freshness");
    candidates.push({ posture: "bound_weak", action: "step_up", reason: "SESSION_STATE_UNKNOWN" });
  }

  // Weak authenticator → step up to a stronger factor.
  if (session.assurance === "single_factor") {
    candidates.push({ posture: "bound_weak", action: "step_up", reason: "SESSION_NO_MFA" });
  } else if (session.assurance === "unknown") {
    unknownSignals.push("assurance");
    candidates.push({ posture: "bound_weak", action: "step_up", reason: "SESSION_STATE_UNKNOWN" });
  }

  // The grant requires POSITIVE verification. An explicit `idpReachable: false`
  // returned as an outage earlier; a MISSING/unreported reachability (null) means
  // the bound facts may be a stale or cached IdP view we could not confirm — it must
  // never grant the top tier. Raise the bar rather than trust an unverified session.
  if (session.idpReachable !== true) {
    unknownSignals.push("idp_reachable");
    candidates.push({ posture: "bound_weak", action: "step_up", reason: "IDP_UNREACHABLE" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "bound_strong", action: "none", reason: "BOUND_MFA_FRESH" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action, subjectBound };
}
