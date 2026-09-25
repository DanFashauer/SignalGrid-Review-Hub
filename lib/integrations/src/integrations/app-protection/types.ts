// Types for the read-only APP-PROTECTION / MAM dimension — is a mobile-application-
// management protection policy actually applied to the app the worker is using,
// current, and clean, as the management plane reports it?
//
// Origin: nothing in this fabric modelled MAM. `device-management-health` grades the
// device baseline and its own header scopes the APP channel OUT; `app-update` grades
// the BINARY's channel/version; `policy-binding` grades assignment-and-enforcement of
// a device policy. A session could therefore read managed-healthy, current-binary and
// bound-correctly while the host app ran under NO app-protection policy at all — the
// exact gap the connector emulator already scripted as
// `MISSING_MAM_POLICY_SENSITIVE_APP → restrict` with no dimension able to produce it.
//
// THE TRAP THIS DIMENSION DELIBERATELY DOES NOT WALK INTO. A MAM integration must
// never manufacture a grant, and it must never actuate. Two rules follow:
//
//   * This dimension NEVER lowers what another dimension raised. Its only
//     non-raising verdicts are `none` (a policy is applied and clean, or the app is
//     affirmatively out of MAM scope) — exactly the states where consulting the MAM
//     plane changes nothing. A missing, flagged, stale or unreadable policy can
//     produce NO grant that was not already available without it.
//   * SELECTIVE WIPE NEVER ENTERS THE TREE. MAM's headline capability is a remote
//     selective wipe of corporate data from an app. That is an actuation, and this
//     family is read-only from birth; the wipe capability is named here as a
//     deliberate non-feature so a future reader does not "complete" the connector by
//     adding it. Every operation is a GET.
//
// THE AFFIRMATIVE IS ANCHORED ON THE MANAGEMENT PLANE. The Intune App Protection
// state (Graph `managedAppRegistrations`, its `appliedPolicies` and `flaggedReasons`
// per user + device + app) is the system of record for whether a policy is applied.
// App self-attestation could only ever corroborate or downgrade that answer, never
// raise a missing policy into a present one, so this first scope reads the management
// plane alone.
//
// Four axes:
//   1. POLICY STATE. Does the management plane report an app-protection policy
//      APPLIED to this registration? An allowlisted enum — the plane is trusted as
//      the system of record, and an unlisted spelling is malformed, never coerced to
//      "applied".
//   2. COMPLIANCE STATE. Does the registration carry `flaggedReasons` (jailbroken,
//      rooted, malicious apps, out-of-contact…)? Any flagged reason is `flagged`;
//      an explicit empty set is `clean`; absence is `unknown`.
//   3. APP SENSITIVITY. Caller-posed: is the app the worker is using a sensitive
//      one? `sensitive` escalates a missing or flagged policy from a step-up to a
//      restrict — the same asymmetry the emulator scripted. Unposed = `unassessed`,
//      which forecloses nothing.
//   4. MAM APPLICABILITY. Caller-posed: is MAM even in scope for this app? An app
//      legitimately outside MAM (an unmanaged personal utility, a platform app) is
//      an ASSERTED positive — `not_applicable` — distinct from "we could not read
//      the policy" (`unknown`). Unposed = `unassessed`.
//
// Plus REGISTRATION FRESHNESS: a caller-posed recency check on when the registration
// was read, identical in construction to the change-window / access-governance shape.
//
// WHAT THIS DIMENSION DOES NOT DO. It does not decide whether an app SHOULD be under
// MAM (that is the UEM admin's assignment, in Intune), does not create, assign,
// update or wipe anything, and does not grade the device's posture, the worker's
// identity or their custody of the device. Those stay with their own dimensions.

/** Does the management plane report an app-protection policy APPLIED to this app
 *  registration? TRUSTED (allowlisted) — the plane is the system of record. */
export type MamPolicyState =
  | "applied" // a managed app-protection policy is applied to this registration
  | "not_applied" // the registration exists (or the app is known) but no policy is applied
  | "unknown"; // the plane could not be read, or the value is unrecognizable

/**
 * The registration's compliance, from its `flaggedReasons`.
 *
 * `clean` = the plane asserted an EMPTY set of flagged reasons. `flagged` = one or
 * more reasons present (jailbroken / rooted / maliciousApps / deviceLock absent…).
 * `unknown` = the field was absent or unreadable — which raises, never clears.
 */
export type MamComplianceState = "clean" | "flagged" | "unknown";

/**
 * Is the app the worker is using a sensitive one? CALLER-posed.
 *
 * `unassessed` = the caller supplied no sensitivity — nobody posed the question, and
 * a missing policy then steps up rather than restricts. `sensitive` escalates a
 * missing or flagged policy to a restrict; `standard` keeps it at a step-up.
 */
export type MamAppSensitivity = "sensitive" | "standard" | "unassessed";

/**
 * Is MAM in scope for this app at all? CALLER-posed.
 *
 * `not_applicable` is an AFFIRMATIVE positive — an app legitimately outside MAM
 * scope, whose missing policy is expected rather than a gap. `unassessed` = the
 * caller did not pose the question, so an unmanaged app is treated as applicable
 * (fail-closed). `unknown` = the question was posed and could not be answered.
 */
export type MamApplicability = "applicable" | "not_applicable" | "unassessed" | "unknown";

/**
 * How current the registration read is, against a maximum age the CALLER supplies.
 * `unassessed` = no maximum age posed; every other value is derived from two
 * instants rather than believed.
 */
export type MamRecordFreshness = "fresh" | "stale" | "unknown" | "unassessed";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type MamReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — the MAM plane is EXTERNAL and may emit anything
 *  in any slot; the normalizer, not the compiler, makes values safe). Shaped after
 *  Microsoft Graph `managedAppRegistrations`. */
export interface AppProtectionReportRaw {
  app_ref?: unknown; // evidence: the app the registration is for (bundle/package id)
  policy_state?: unknown; // applied | not_applied
  applied_policies?: unknown; // Graph appliedPolicies[] — evidence + corroborates "applied"
  flagged_reasons?: unknown; // Graph flaggedReasons[] — jailbroken, rooted, maliciousApps…
  platform?: unknown; // evidence: ios | android | windows…
  registration_observed_at?: unknown; // ISO-8601 UTC instant the registration was read
  source_system?: unknown; // evidence: which MAM plane produced this record
  user_ref?: unknown; // evidence: the worker the registration belongs to (Graph userId / UPN)
  device_ref?: unknown; // evidence: the device the registration was made from (Graph deviceTag / managedDeviceId)
  [k: string]: unknown;
}

export const APP_PROTECTION_REPORT_KEYS = [
  "app_ref",
  "policy_state",
  "applied_policies",
  "flagged_reasons",
  "platform",
  "registration_observed_at",
  "source_system",
  "user_ref",
  "device_ref",
] as const;

export interface NormalizedAppProtection {
  sourceSystem: "app-protection";
  appRef: string;
  policyState: MamPolicyState;
  complianceState: MamComplianceState;
  appSensitivity: MamAppSensitivity;
  mamApplicability: MamApplicability;
  registrationFreshness: MamRecordFreshness;
  /** The versioned-evidence record. Absent fields are null / empty, never a
   *  fabricated placeholder. */
  managedAppRef: string | null;
  /** Who and what the plane says the registration is bound to. The connector refuses a
   *  registration whose binding is absent or names another worker/device BEFORE it is
   *  normalized (see `AppProtectionConnector.fetchNormalized`); these carry the echo. */
  managedUserRef: string | null;
  managedDeviceRef: string | null;
  appliedPolicyRefs: string[];
  flaggedReasons: string[];
  platform: string | null;
  registrationObservedAt: string | null;
  mamSource: string | null;
  reportIntegrity: MamReportIntegrity;
  source: string;
}

export type AppProtectionPosture =
  | "app_protected" // the grant: a policy is applied, clean, and current
  | "app_protection_not_applicable" // the grant: MAM affirmatively out of scope for this app
  | "app_protection_missing" // no policy applied where one is expected
  | "app_protection_flagged" // a policy is applied but the registration is flagged
  | "app_protection_stale" // the registration read is older than the caller's max age
  | "app_protection_unverified"; // any axis unknown / malformed / uncovered

export type AppProtectionAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type AppProtectionReasonCode =
  | "APP_PROTECTED"
  | "APP_PROTECTION_NOT_APPLICABLE"
  | "MISSING_MAM_POLICY_SENSITIVE_APP"
  | "MISSING_MAM_POLICY"
  | "MAM_FLAGGED_SENSITIVE_APP"
  | "APP_PROTECTION_FLAGGED"
  | "APP_PROTECTION_STALE"
  | "APP_PROTECTION_TIME_UNKNOWN"
  | "POLICY_STATE_UNKNOWN"
  | "COMPLIANCE_UNKNOWN"
  | "APPLICABILITY_UNKNOWN"
  | "REPORT_MALFORMED"
  | "GRANT_BACKSTOP"
  | "NOT_COVERED";

export interface AppProtectionVerdict {
  appRef: string;
  posture: AppProtectionPosture;
  reasonCode: AppProtectionReasonCode;
  recommendedAction: AppProtectionAction;
  /** Affirmative app-protection concerns — states the management plane positively
   *  reported (a missing policy, a flagged registration). */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the plane reports a policy applied and clean on a current read,
   *  or the app is affirmatively out of MAM scope. It says nothing about device
   *  posture, identity or custody. */
  appProtected: boolean;
}

export class AppProtectionConnectorError extends Error {
  constructor(
    public readonly code:
      | "read_only_violation"
      | "auth_failed"
      | "upstream_error"
      | "bad_response"
      | "invalid_app_ref"
      | "invalid_binding"
      | "binding_mismatch",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AppProtectionConnectorError";
  }
}
