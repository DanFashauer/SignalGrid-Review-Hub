// Types for the read-only BOOTSTRAP-CREDENTIAL dimension — is this session
// riding a TEMPORARY bootstrap credential, and is that credential being used
// the only way a bootstrap credential may be used?
//
// Origin: intake ledger row 17's queued candidate. A Temporary Access Pass (and
// its peers) is a BOOTSTRAP or RECOVERY mechanism: identity is verified out of
// band, a one-time shortest-practical pass is issued, the pass can reach ONLY
// authenticator enrollment or recovery — never operational or clinical data —
// and it is revoked or expires. Every one of those properties is a place the
// auth plane can silently rot into an unearned affirmative: a session opened
// with a TAP that then touches a controlled workflow; a pass still alive past
// its expiry; a "one-time" pass that is actually reusable; a pass whose
// issuance was corroborated by nothing but location. Until this dimension none
// of those states was representable — the session simply looked authenticated.
//
// Axes, each fail-closed:
//
//   1. CREDENTIAL CLASS (trusted allowlist). `standing` — a durable strong
//      method (passkey, certificate, smartcard) — is this dimension's clean
//      state; it contributes nothing further. `bootstrap` opens the rest of
//      the ladder. An unlisted spelling is unknown, never coerced.
//   2. WORKFLOW FIT (posed question). The CALLER states what class of workflow
//      the session is performing: `enrollment_recovery` or `operational`. A
//      bootstrap credential on an operational workflow is the hard scope rule
//      broken — restrict. An UNPOSED workflow under a bootstrap credential
//      fails closed to step_up: the default posture of a bootstrap session is
//      enrollment-only, and silence does not widen it.
//   3. LIFETIME (derived). issued_at / expires_at as the source reports them,
//      aged against a caller-supplied reference instant — no clock in the
//      decision path. Expired-but-in-use restricts; a pass with NO expiry is
//      `unbounded` — "shortest practical" was not practiced, visibly.
//   4. ONE-TIME (trusted tri-state). `reusable` is weaker than the mechanism
//      promises — visible, step_up.
//   5. ISSUANCE VERIFICATION (trusted allowlist). How identity was verified
//      when the pass was issued. `location_only` is the affirmative bad state:
//      location may CORROBORATE an issuance, never carry it alone.
//
// WHAT THIS DIMENSION DOES NOT DO. It never issues, revokes, or extends a
// credential (no write path of any kind); it never grades the STRENGTH of a
// standing method (that is passkey-assurance and platform-sso); and it never
// lowers what another dimension raised.

/** The class of credential the current session authenticated with. TRUSTED
 *  allowlist — the IdP knows how the session was opened. */
export type CredentialClass = "standing" | "bootstrap" | "unknown";

/** What the bootstrap pass may reach, as ISSUED. `broad` is an issuance defect:
 *  the pass itself was minted wider than the mechanism allows. */
export type BootstrapScope = "enrollment_only" | "broad" | "unknown";

/** One-time discipline, as the IdP reports it. */
export type OneTimeStanding = "one_time" | "reusable" | "unknown";

/** Where the pass stands against its own reported lifetime, at the caller's
 *  reference instant. DERIVED, never believed. */
export type LifetimeStanding =
  | "within_lifetime"
  | "expired"
  | "unbounded" // the source reported NO expiry — a visible policy failure, not a default
  | "unknown"; // instants or reference unreadable

/** How identity was verified at issuance. TRUSTED allowlist; `location_only`
 *  is the affirmative sole-factor violation. */
export type IssuanceVerification =
  | "help_desk"
  | "manager"
  | "in_person"
  | "piv_cac"
  | "location_only"
  | "unknown";

/** What class of workflow this session is performing — POSED by the caller,
 *  never inferred. `unposed` is carried, visible, and (under a bootstrap
 *  credential) fails closed. */
export type WorkflowFit = "enrollment_recovery" | "operational" | "unposed";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type BootstrapReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — IdPs are EXTERNAL and may emit anything in
 *  any slot; the normalizer, not the compiler, makes values safe). */
export interface BootstrapCredentialReportRaw {
  subject_ref?: unknown; // evidence: the IdP's own subject identifier
  credential_class?: unknown; // standing | bootstrap
  scope?: unknown; // enrollment_only | broad
  one_time?: unknown; // one_time | reusable
  issued_at?: unknown; // ISO-8601 UTC instant
  expires_at?: unknown; // ISO-8601 UTC instant
  issuance_verification?: unknown; // help_desk | manager | in_person | piv_cac | location_only
  source_system?: unknown; // evidence: which IdP produced this record
  [k: string]: unknown;
}

export const BOOTSTRAP_CREDENTIAL_REPORT_KEYS = [
  "subject_ref",
  "credential_class",
  "scope",
  "one_time",
  "issued_at",
  "expires_at",
  "issuance_verification",
  "source_system",
] as const;

export interface NormalizedBootstrapCredential {
  sourceSystem: "bootstrap-credential";
  subjectRef: string;
  credentialClass: CredentialClass;
  scope: BootstrapScope;
  oneTime: OneTimeStanding;
  lifetime: LifetimeStanding;
  issuanceVerification: IssuanceVerification;
  /** The versioned-evidence record. Absent fields are null, never a placeholder. */
  idpSubjectRef: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  /** The caller's reference instant the lifetime was aged against. Null when
   *  the lifetime question could not be posed. */
  referenceTime: string | null;
  idpSource: string | null;
  reportIntegrity: BootstrapReportIntegrity;
  source: string;
}

export type BootstrapCredentialPosture =
  | "standing_credential" // the clean state: a durable strong method, nothing temporary in play
  | "bootstrap_in_scope" // a bootstrap pass used exactly as intended — visible, monitored
  | "bootstrap_out_of_scope" // the hard rule broken: a bootstrap pass on an operational workflow
  | "bootstrap_expired" // the pass outlived its own expiry and the session is still alive
  | "bootstrap_issuance_defect" // minted broad, or verified by location alone
  | "bootstrap_weakened" // reusable, or no expiry at all — weaker than the mechanism promises
  | "credential_unverified"; // any axis unknown / malformed / uncovered

export type BootstrapCredentialAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type BootstrapCredentialReasonCode =
  | "STANDING_CREDENTIAL"
  | "BOOTSTRAP_IN_SCOPE"
  | "BOOTSTRAP_BEYOND_ENROLLMENT_SCOPE"
  | "BOOTSTRAP_WORKFLOW_UNPOSED"
  | "BOOTSTRAP_EXPIRED_IN_USE"
  | "BOOTSTRAP_MINTED_BROAD"
  | "LOCATION_SOLE_ISSUANCE_FACTOR"
  | "BOOTSTRAP_NOT_ONE_TIME"
  | "BOOTSTRAP_UNBOUNDED_LIFETIME"
  | "BOOTSTRAP_LIFETIME_UNKNOWN"
  | "SCOPE_UNKNOWN"
  | "ONE_TIME_UNKNOWN"
  | "ISSUANCE_UNKNOWN"
  | "CREDENTIAL_CLASS_UNKNOWN"
  | "BOOTSTRAP_UNGRADED"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface BootstrapCredentialVerdict {
  subjectRef: string;
  posture: BootstrapCredentialPosture;
  reasonCode: BootstrapCredentialReasonCode;
  recommendedAction: BootstrapCredentialAction;
  /** Affirmative credential concerns — states the IdP positively reported. */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY for a standing strong credential. A bootstrap session NEVER
   *  confirms — used perfectly it is still a temporary elevated state, and the
   *  best it earns is a visible `monitor`. */
  credentialContextConfirmed: boolean;
}

export class BootstrapCredentialConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BootstrapCredentialConnectorError";
  }
}
