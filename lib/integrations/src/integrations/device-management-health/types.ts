// Types for the read-only device-management-health / config-drift dimension.
//
// The fabric already asks whether a device is HARDENED (`macos-posture`: is FileVault
// on, is the firewall up) and whether it was COMPLIANT at some evaluation
// (`intune-entra-posture`). Neither asks the management-plane question that decides
// whether either of those answers is still worth anything: **is this shared device
// still under EFFECTIVE management, and is it actually on the baseline it was
// assigned?**
//
// A ward iPad that stopped checking in three weeks ago still reports its last-known
// compliance state forever. A device whose enrollment silently failed, or that was
// retired in the MDM but never physically collected, looks fine in a posture snapshot
// and is in fact ungoverned. Config drift is the same failure one step earlier: the
// baseline was assigned, the device is enrolled and checking in, but the profiles on
// it no longer match what was intended.
//
// This connector normalizes a management-plane bridge's already-evaluated view. It
// enrolls no device, assigns no policy, pushes no profile, and wipes nothing — those
// stay with the MDM.

/** How recently the device checked in to the management plane. `never` = enrolled (or
 *  claimed to be) but has never reported. */
export type CheckInFreshness = "fresh" | "stale" | "never" | "unknown";

/** Does the device's applied configuration match its assigned baseline? */
export type PolicyDrift = "on_baseline" | "drifted" | "unknown";

/** Is the device actually in scope of a compliance policy at all? `uncovered` = no
 *  policy targets it, so "compliant" would be vacuous. */
export type ComplianceCoverage = "covered" | "uncovered" | "unknown";

/** Management enrollment state. `failed` = enrollment did not complete; `retired` =
 *  removed from management but potentially still in someone's hands. */
export type EnrollmentState = "enrolled" | "failed" | "retired" | "unknown";

/** Raw management-health report about one device (loosely typed).
 *
 *  EVERY field is `unknown`, including the boolean. A bridge is an external system: it
 *  can and does emit `"true"`, `1`, `["drifted"]`, or `"ERR: graph timeout"` in any of
 *  these slots, and the normalizer — not the compiler — is what makes that safe. */
export interface DeviceManagementHealthReportRaw {
  checkInFreshness?: unknown; // fresh | stale | never | unknown
  policyDrift?: unknown; // on_baseline | drifted | unknown
  complianceCoverage?: unknown; // covered | uncovered | unknown
  enrollmentState?: unknown; // enrolled | failed | retired | unknown
  managementReachable?: unknown; // boolean
  [k: string]: unknown;
}

/** The exact set of keys this connector understands. Anything else means the report
 *  was not fully understood — see `reportIntegrity`. */
export const DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS = [
  "checkInFreshness",
  "policyDrift",
  "complianceCoverage",
  "enrollmentState",
  "managementReachable",
] as const;

/** Did the raw report parse cleanly?
 *
 *  `malformed` = at least one known field was PRESENT but unparseable, or the report
 *  carried an unrecognized key. The normalized enums cannot express this on their own:
 *  the allowlist folds every unrecognized value into `"unknown"`, collapsing "the
 *  report said nothing" and "the report said something we could not read" into one
 *  sentinel. Here that collapse happens to be safe — `"unknown"` denies on every field
 *  — but the distinction is still tracked and independently denied on, so the allow
 *  path never rests on a value we only *think* we understood. */
export type ReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral management-health posture. */
export interface NormalizedDeviceManagementHealth {
  sourceSystem: "device-management-health";
  deviceId: string;
  checkInFreshness: CheckInFreshness;
  policyDrift: PolicyDrift;
  complianceCoverage: ComplianceCoverage;
  enrollmentState: EnrollmentState;
  /** true = management plane answered for this device; false = it did not; null = not
   *  reported. Only an explicit true can back a grant. */
  managementReachable: boolean | null;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type DeviceManagementHealthPosture =
  | "managed_healthy"
  | "unenrolled_device"
  | "unmanaged_device"
  | "drifted_config"
  | "stale_management"
  | "unverified"
  | "unknown";

export type DeviceManagementHealthReasonCode =
  | "MANAGEMENT_HEALTHY"
  | "ENROLLMENT_RETIRED"
  | "ENROLLMENT_FAILED"
  | "COMPLIANCE_UNCOVERED"
  | "POLICY_DRIFTED"
  | "CHECKIN_NEVER"
  | "CHECKIN_STALE"
  | "MANAGEMENT_STATE_UNKNOWN"
  | "MANAGEMENT_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type DeviceManagementHealthAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface DeviceManagementHealthVerdict {
  posture: DeviceManagementHealthPosture;
  reasonCode: DeviceManagementHealthReasonCode;
  recommendedAction: DeviceManagementHealthAction;
  /** Containment-level findings — every restrict-level condition contributes one
   *  (retired or failed enrollment, no compliance policy in scope). */
  criticalFindings: string[];
  /** Management facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the device is positively confirmed under effective management:
   *  freshly checked in, on its assigned baseline, covered by a compliance policy,
   *  enrolled, and the management plane confirmed reachable. */
  managementEffective: boolean;
  deviceId: string;
}

export type DeviceManagementHealthConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class DeviceManagementHealthConnectorError extends Error {
  readonly code: DeviceManagementHealthConnectorErrorCode;
  readonly status: number;
  constructor(code: DeviceManagementHealthConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "DeviceManagementHealthConnectorError";
    this.code = code;
    this.status = status;
  }
}
