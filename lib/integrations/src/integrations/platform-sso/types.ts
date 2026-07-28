// Types for the read-only PLATFORM-SSO (macOS platform credential) dimension.
//
// Origin: the MacAdmins-community observation that "Platform SSO can be passwordless
// and can satisfy MFA — neither result is automatic." Apple's framework supports
// several authentication METHODS, and the identity-provider extension decides which
// one it implements. The method changes everything decision-relevant:
//
//   • **Secure Enclave key** / **smart card** — hardware-backed, phishing-resistant
//     credentials. The local password does NOT disappear (macOS requires it by
//     default at FileVault unlock, the Lock Screen, and the login window, and after
//     a reboot before Touch ID re-arms) — but the SSO credential itself is
//     phishing-resistant MFA grade.
//   • **Password (sync)** — synchronizes the IdP password with the local account.
//     Legitimate and org-chosen (it is the ONLY method Apple marks compatible with
//     login policies, macOS 15+), but the credential is a synced password:
//     password-grade, never phishing-resistant.
//   • **Web-based flows** (macOS 27 material) — Apple labels them PRE-RELEASE.
//     Platform honesty: a preview is a preview; it never grants until it ships and
//     the tenant's IdP supports it.
//
// THE compatibility detail this dimension exists to grade: **login policies
// (Require Authentication) are only compatible with the Password method.** A tenant
// that believes Require Authentication is enforced while deployed on the Secure
// Enclave method is wrong — the claimed policy cannot actually be in force. That
// claim-vs-reality gap is config drift, and surfacing it is exactly this fabric's
// job. The flip side is OPERATIONAL: with the policy genuinely in force, an offline
// Mac whose grace period expired (or was never configured) strands the holder, and
// Apple's own guidance is to exempt a break-glass account BEFORE enforcement rather
// than leaning on the temporary local-account grace window.
//
// Scope honesty: Apple configures the policy separately per surface (FileVault
// unlock on Apple silicon, the Lock Screen, the login window) — surface-level
// verification belongs to real-hardware testing (see docs/PLATFORM_SSO.md), not to
// this normalized model. This dimension grades the method/registration/policy
// posture an MDM or the grid-collected macOS report can actually observe.

/** How far Platform SSO registration has progressed on this Mac. `device_only` =
 *  the device is registered but this user's credential is not established. */
export type PssoRegistration = "user" | "device_only" | "none" | "unknown";

/** The authentication method the IdP extension implements on this Mac. */
export type PssoMethod =
  | "secure_enclave_key"
  | "smart_card"
  | "password_sync"
  | "web_based" // macOS 27 pre-release — preview, never grants
  | "none"
  | "unknown";

/** Is a Require Authentication login policy claimed for this Mac? */
export type PssoLoginPolicy = "required" | "not_required" | "unknown";

/** State of the offline grace period the policy leans on when the IdP is
 *  unreachable. Only meaningful while a policy is genuinely in force. */
export type PssoOfflineGrace = "valid" | "expired" | "not_configured" | "unknown";

/** Is a break-glass account exempted from the login policy? Apple's guidance:
 *  exempt one BEFORE enforcement; the local-account grace window is temporary. */
export type PssoBreakGlass = "exempt_configured" | "none" | "unknown";

/** What the platform credential is actually worth, independent of vendor labels. */
export type PssoAssurance = "phishing_resistant" | "password_grade" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — MDM inventories and grid-collected reports are
 *  EXTERNAL and may emit anything in any slot; the normalizer makes values safe). */
export interface PlatformSsoReportRaw {
  registration?: unknown; // user | device_only | none | unknown
  method?: unknown; // secure_enclave_key | smart_card | password_sync | web_based | none | unknown
  login_policy?: unknown; // required | not_required | unknown
  offline_grace?: unknown; // valid | expired | not_configured | unknown
  break_glass?: unknown; // exempt_configured | none | unknown
  [k: string]: unknown;
}

export const PLATFORM_SSO_REPORT_KEYS = [
  "registration",
  "method",
  "login_policy",
  "offline_grace",
  "break_glass",
] as const;

export interface NormalizedPlatformSso {
  sourceSystem: "platform-sso";
  deviceRef: string;
  registration: PssoRegistration;
  method: PssoMethod;
  loginPolicy: PssoLoginPolicy;
  offlineGrace: PssoOfflineGrace;
  breakGlass: PssoBreakGlass;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type PlatformSsoPosture =
  | "phishing_resistant_confirmed" // user-registered SEK/smart-card, clean, no policy contradiction — the grant
  | "password_grade" // Password method: legitimate, policy-capable, never phishing-resistant
  | "preview_method" // web-based (pre-release) — a preview is a preview
  | "policy_incompatible" // Require Authentication claimed on a non-Password method — the claim cannot be in force
  | "lockout_exposed" // policy genuinely in force with an expired/unconfigured grace or no break-glass
  | "not_registered"
  | "registration_partial"
  | "unverified";

export type PlatformSsoAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type PlatformSsoReasonCode =
  | "PHISHING_RESISTANT_CONFIRMED"
  | "PASSWORD_GRADE_METHOD"
  | "PREVIEW_METHOD_NEVER_GRANTS"
  | "POLICY_INCOMPATIBLE_WITH_METHOD"
  | "OFFLINE_GRACE_EXPIRED"
  | "OFFLINE_GRACE_NOT_CONFIGURED"
  | "OFFLINE_GRACE_UNKNOWN"
  | "BREAK_GLASS_MISSING"
  | "BREAK_GLASS_UNKNOWN"
  | "POLICY_UNKNOWN"
  | "USER_NOT_REGISTERED"
  | "NOT_REGISTERED"
  | "REGISTRATION_UNKNOWN"
  | "METHOD_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface PlatformSsoVerdict {
  deviceRef: string;
  posture: PlatformSsoPosture;
  reasonCode: PlatformSsoReasonCode;
  recommendedAction: PlatformSsoAction;
  /** What the platform credential is actually worth — vendor "passwordless" labels
   *  notwithstanding. Only user-registered SEK/smart-card on a clean report earns
   *  `phishing_resistant`. */
  assurance: PssoAssurance;
  /** True when the login policy is GENUINELY in force (Password method) and an
   *  offline Mac could strand its holder: grace expired/not configured, or no
   *  break-glass exemption. Operational, not a trust downgrade by itself. */
  lockoutRisk: boolean;
  /** Affirmative concerns (policy contradiction, expired grace, missing break-glass). */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the grant holds: clean + user-registered + SEK/smart-card +
   *  no policy claimed (or the policy state fully verified benign). */
  ssoConfirmed: boolean;
}

export class PlatformSsoConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PlatformSsoConnectorError";
  }
}
