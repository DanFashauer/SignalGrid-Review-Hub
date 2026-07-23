// Types for the read-only SSO session-binding dimension.
//
// Modern SSO is the identity control layer — but on a SHARED, badge-checked-out
// frontline device the decisive question is not "is this a valid IdP session?"
// (the `identity-risk` dimension scores sign-in risk) nor "is this principal
// authorized?" (the `access-governance` dimension). It is: *is the live SSO
// session sitting on THIS device actually the current badge-holder's, is it
// MFA-backed, and is it still fresh?*
//
// The single worst shared-device failure this catches is a LEFTOVER session: the
// previous user walked away and their Okta / Entra / Ping session is still live on
// the tablet, so the next person inherits someone else's authenticated identity.
// This connector normalizes an IdP session-state bridge's already-evaluated view
// of the session bound to the current device session and folds it fail-safe. It
// consumes the evaluated session state; it does not itself mint or refresh tokens.
//
// Fail-safe by construction: a session whose subject does not match the checked-out
// badge-holder is the strongest negative (a live one escalates); an active session
// bound to nobody is contained; a single-factor / near-expiry / unreadable session
// raises the bar; only a bound, MFA-backed, fresh session contributes "none";
// unknown is never treated as a bound, trusted session.

/** Is there a live federated SSO session on the device? `expired` = a session
 *  exists but its window has closed (cached/stale); `none` = no session present. */
export type SsoSessionState = "active" | "expired" | "none" | "unknown";

/** Is the session's subject the current badge-holder? `mismatched` = a DIFFERENT
 *  principal (a leftover/hijacked session); `unbound` = attributable to no known
 *  holder; `bound` = the current holder's own session. */
export type SessionBinding = "bound" | "mismatched" | "unbound" | "unknown";

/** Authenticator assurance backing the session. `phishing_resistant` (e.g.
 *  passkey / FIDO2 / platform), `mfa` (any second factor), `single_factor`
 *  (password only), `unknown`. */
export type SessionAssurance = "phishing_resistant" | "mfa" | "single_factor" | "unknown";

/** Session freshness against its own lifetime. `near_expiry` = within the renewal
 *  window; `expired` = past lifetime but still cached. */
export type SessionFreshness = "fresh" | "near_expiry" | "expired" | "unknown";

/** Raw session-bridge report about one device's SSO session (loosely typed — any
 *  field may degrade to null / an error string). */
export interface SsoSessionReportRaw {
  state?: unknown; // active | expired | none | unknown
  binding?: unknown; // bound | mismatched | unbound | unknown
  assurance?: unknown; // phishing_resistant | mfa | single_factor | unknown
  freshness?: unknown; // fresh | near_expiry | expired | unknown
  /** Was the IdP reachable to evaluate the session? false = could not verify. */
  idpReachable?: boolean | null;
  subject?: unknown; // the session's principal (attested by the IdP)
  expectedSubject?: unknown; // the checked-out badge-holder
  [k: string]: unknown;
}

/** The normalized, vendor-neutral SSO session posture — one shape the fabric reads. */
export interface NormalizedSsoSession {
  sourceSystem: "sso-session";
  deviceId: string;
  state: SsoSessionState;
  binding: SessionBinding;
  assurance: SessionAssurance;
  freshness: SessionFreshness;
  /** true = IdP reachable; false = could not verify; null = not reported. */
  idpReachable: boolean | null;
  /** The session's principal and the expected badge-holder, when present. */
  subject: string | null;
  expectedSubject: string | null;
  source: string;
}

export type SsoSessionPosture =
  | "bound_strong"
  | "bound_weak"
  | "leftover_session"
  | "unbound_session"
  | "no_session"
  | "unverified"
  | "unknown";

export type SsoSessionReasonCode =
  | "BOUND_MFA_FRESH"
  | "NO_ACTIVE_SESSION"
  | "SESSION_SUBJECT_MISMATCH"
  | "UNBOUND_ACTIVE_SESSION"
  | "SESSION_NO_MFA"
  | "SESSION_NEAR_EXPIRY"
  | "SESSION_EXPIRED"
  | "IDP_UNREACHABLE"
  | "SESSION_STATE_UNKNOWN"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type SsoSessionAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface SsoSessionVerdict {
  posture: SsoSessionPosture;
  reasonCode: SsoSessionReasonCode;
  recommendedAction: SsoSessionAction;
  /** Containment-level findings (leftover / unbound live session). */
  criticalFindings: string[];
  /** Session facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when a live session is confirmed bound to the current badge-holder
   *  (never true for a mismatched, unbound, expired, or unverifiable session). */
  subjectBound: boolean;
  deviceId: string;
}

export type SsoSessionConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class SsoSessionConnectorError extends Error {
  readonly code: SsoSessionConnectorErrorCode;
  readonly status: number;
  constructor(code: SsoSessionConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "SsoSessionConnectorError";
    this.code = code;
    this.status = status;
  }
}
