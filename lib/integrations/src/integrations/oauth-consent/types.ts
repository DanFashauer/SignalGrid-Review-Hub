// Types for the read-only OAuth-consent / workload-identity dimension.
//
// The IAM cheat sheet's "allow an app to access another app" row (OAuth 2.0) is a
// distinct problem from authorization: `access-governance` answers what the HUMAN
// principal is entitled to; this answers what THIRD-PARTY APPS and workload
// identities can do ON BEHALF OF that principal via a delegated OAuth grant. On a
// shared, badge-checked-out device the session inherits the badge-holder's identity
// — so a live illicit consent grant (the classic consent-phishing attack), an
// over-scoped third-party app, an unverified-publisher app, or a service principal
// with a long-lived unmanaged secret is a session-relevant risk.
//
// This connector normalizes an OAuth/consent-governance bridge's already-evaluated
// view of the riskiest delegated grant on the session's principal (Microsoft Entra
// enterprise apps / OAuth grants, Okta OAuth, Google Workspace app access) and folds
// it fail-safe. It consumes the evaluated grant state; it revokes nothing (that
// stays with the IdP). Fail-safe by construction: an illicit consent grant is the
// strongest negative; an over-scoped/unverified/unmanaged grant raises the bar; only
// an admin-consented, verified-publisher, least-scope, managed grant — with the IdP
// positively confirmed reachable — contributes a grant; unknown is never governed.

/** Are there third-party delegated OAuth grants on the principal? `present` = at
 *  least one; `none` = the bridge confirms zero; `unknown` = not assessed. */
export type GrantPresence = "present" | "none" | "unknown";

/** How the riskiest grant was consented. `admin` = admin-consented (governed);
 *  `user` = user-consented (the consent-phishing vector); `unknown`. */
export type ConsentType = "admin" | "user" | "unknown";

/** Publisher-verification state of the riskiest app. */
export type PublisherTrust = "verified" | "unverified" | "unknown";

/** Scope breadth of the riskiest grant. `least` = narrowly scoped; `broad` = wide
 *  read/write; `full_access` = full-mailbox / broad offline_access-class access. */
export type GrantScope = "least" | "broad" | "full_access" | "unknown";

/** Workload-identity (service principal) credential hygiene for the riskiest app.
 *  `managed` = managed identity / short-lived cert; `unmanaged_secret` = a
 *  long-lived client secret; `none` = no workload credential; `unknown`. */
export type WorkloadCredential = "managed" | "unmanaged_secret" | "none" | "unknown";

/** Raw consent-bridge report about one principal's riskiest delegated grant
 *  (loosely typed — any field may degrade to null / an error string). */
export interface OAuthConsentReportRaw {
  grants?: unknown; // present | none | unknown
  consentType?: unknown; // admin | user | unknown
  publisher?: unknown; // verified | unverified | unknown
  scope?: unknown; // least | broad | full_access | unknown
  workloadCredential?: unknown; // managed | unmanaged_secret | none | unknown
  /** Was the IdP reachable to evaluate the grants? false = could not verify. */
  idpReachable?: boolean | null;
  /** How many risky grants the bridge counted (informational). */
  riskyGrantCount?: number | null;
  [k: string]: unknown;
}

/** The normalized, vendor-neutral consent posture — one shape the fabric reads. */
export interface NormalizedOAuthConsent {
  sourceSystem: "oauth-consent";
  principalId: string;
  grants: GrantPresence;
  consentType: ConsentType;
  publisher: PublisherTrust;
  scope: GrantScope;
  workloadCredential: WorkloadCredential;
  /** true = IdP reachable; false = could not verify; null = not reported. */
  idpReachable: boolean | null;
  riskyGrantCount: number | null;
  source: string;
}

export type OAuthConsentPosture =
  | "governed"
  | "over_scoped"
  | "unverified_app"
  | "illicit_grant"
  | "workload_exposed"
  | "no_grants"
  | "unverified"
  | "unknown";

export type OAuthConsentReasonCode =
  | "GOVERNED_CONSENT"
  | "NO_RISKY_GRANTS"
  | "ILLICIT_CONSENT_GRANT"
  | "FULL_ACCESS_GRANT"
  | "FULL_ACCESS_ADMIN_CONSENTED"
  | "BROAD_SCOPE_GRANT"
  | "UNVERIFIED_PUBLISHER"
  | "UNMANAGED_WORKLOAD_SECRET"
  | "CONSENT_STATE_UNKNOWN"
  | "IDP_UNREACHABLE"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type OAuthConsentAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface OAuthConsentVerdict {
  posture: OAuthConsentPosture;
  reasonCode: OAuthConsentReasonCode;
  recommendedAction: OAuthConsentAction;
  /** Containment-level findings (illicit / full-access grant). */
  criticalFindings: string[];
  /** Consent facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the consent state is positively confirmed clean (admin-consented
   *  / no grants) with the IdP reachable — never for a risky or unverifiable state. */
  governanceConfirmed: boolean;
  principalId: string;
}

export type OAuthConsentConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class OAuthConsentConnectorError extends Error {
  readonly code: OAuthConsentConnectorErrorCode;
  readonly status: number;
  constructor(code: OAuthConsentConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "OAuthConsentConnectorError";
    this.code = code;
    this.status = status;
  }
}
