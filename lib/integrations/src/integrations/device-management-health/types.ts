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

// ── the two check-in channels ──────────────────────────────────────────────────
//
// "Did the device check in?" is ONE question in every MDM console and TWO
// independent facts underneath it. Triggering a sync on an Intune-managed device
// kicks off two separate paths that succeed and fail independently:
//
//   MDM channel   — configuration profiles, compliance policies, the settings
//                   catalog. On Windows this is OMA-DM; on Apple platforms it is
//                   the Apple MDM protocol. This is the number a console shows.
//                   Graph documents `lastSyncDateTime` only as "the last successful
//                   sync with Intune" and names no channel; reading it as the MDM
//                   channel is an inference from documented behaviour (a console
//                   Sync initiates an MDM check-in but does not force an agent
//                   check-in), not a documented guarantee.
//   AGENT channel — the Intune Management Extension (Windows) or the Intune agent
//                   (macOS). It carries the workloads the MDM channel cannot, and
//                   the two platforms carry DIFFERENT ones: on Windows, Win32 app
//                   delivery, PowerShell scripts and Remediations; on macOS, shell
//                   scripts, custom attributes and DMG/PKG installs. Remediations
//                   are documented by Microsoft as Windows-only — an earlier draft
//                   of this comment claimed macOS parity and was wrong. The agent
//                   check-in is documented as INDEPENDENT of the MDM check-in,
//                   which is the whole reason this field exists.
//
// A device can be perfectly fresh on the MDM channel while its agent has not run
// for weeks. Profiles and compliance evaluation stay current; app installs,
// scripts and remediations silently stop. Collapsing both into one
// `checkInFreshness` reported "fresh" for exactly that device — the console's
// number, standing in for a fact it does not cover. The fields are split so the
// grant has to confirm BOTH.

/** How recently the device checked in over the MDM channel — configuration
 *  profiles, compliance policies, settings catalog. `never` = enrolled (or claimed
 *  to be) but has never reported. */
export type MdmCheckInFreshness = "fresh" | "stale" | "never" | "unknown";

/** How recently the management AGENT last ran — the channel that carries app
 *  delivery, scripts and remediations.
 *
 *  `not_applicable` is a POSITIVE assertion from the bridge that this device's
 *  platform has no agent channel at all, and it is load-bearing: iOS/iPadOS has no
 *  Intune Management Extension, so on a ward iPad every device-management workload
 *  rides the MDM channel already judged by `mdmCheckInFreshness`. (App Protection
 *  Policies are a separate non-MDM channel on iOS — hence the qualifier.) Without it the fleet this
 *  product exists for could never be confirmed healthy. It has to be ASSERTED —
 *  silence is still `unknown`, and `unknown` still denies. */
export type AgentCheckInFreshness = "fresh" | "stale" | "never" | "not_applicable" | "unknown";

/** Remediation (Intune "Remediations", formerly Proactive Remediations) state for
 *  this device: a detection script pairs with a remediation script and reports per
 *  device.
 *
 *  `issues_detected` = a detection script affirmatively found a problem that has
 *  NOT been remediated — a known-bad fact about the device, not an unknown.
 *  `failed` = the script itself could not run, so the channel is broken rather
 *  than the device. `not_applicable` = no remediation is assigned to this device,
 *  or the platform has no such channel — a positive assertion, and a common,
 *  benign one; remediations are an opt-in add-on, unlike compliance coverage. */
export type RemediationHealth =
  | "healthy"
  | "issues_detected"
  | "failed"
  | "not_applicable"
  | "unknown";

/** Does the device's applied configuration match its assigned baseline? */
export type PolicyDrift = "on_baseline" | "drifted" | "unknown";

/** Is the device actually in scope of a compliance policy at all? `uncovered` = no
 *  policy targets it, so "compliant" would be vacuous. */
export type ComplianceCoverage = "covered" | "uncovered" | "unknown";

/** Management enrollment state. `failed` = enrollment did not complete; `retired` =
 *  removed from management but potentially still in someone's hands. */
export type EnrollmentState = "enrolled" | "failed" | "retired" | "unknown";

/** Does device-side evidence exist for WHY a reported failure happened?
 *
 *  The management portal reports the RESULT. It rarely reports the REASON — that lives
 *  on the device, in agent logs, event logs, the MDM diagnostic report, certificate
 *  request state, script exit codes. Every UEM has this split; it is not an Intune
 *  quirk.
 *
 *  Without this axis, two very different situations produced the identical verdict and
 *  the identical reason code:
 *
 *    · the portal says enrollment failed, and nobody has looked at anything
 *    · the portal says enrollment failed, the agent log was collected, and a
 *      certificate request rejection is the confirmed cause
 *
 *  Both emitted `ENROLLMENT_FAILED`. The outcome (`restrict`) was already safe, so this
 *  is NOT a fail-open defect — it is a TRUTHFULNESS defect, which this repo treats as
 *  the same class: a decision asserting a diagnosis it has not earned. It also misroutes,
 *  because "who owns this" (PKI vs app packaging vs network vs identity) is exactly what
 *  the missing evidence would have told you.
 *
 *  This is the mirror of the absent-collection law (`proof:absent-collection`): that one
 *  says NOTHING OBSERVED IS NOT THE SAME AS NOTHING WRONG. This one says A STATUS IS NOT
 *  A DIAGNOSIS.
 *
 *  Deliberately VENDOR-NEUTRAL and four-valued. Naming the actual artifacts here
 *  (`imeLogAvailable`, `companyPortalLogAvailable`, `win32DetectionState`) was
 *  considered and rejected: those are Intune/Windows shapes, and burning them into a
 *  normalized contract that Jamf, Workspace ONE and Fleet also map into would make the
 *  contract quietly Intune-shaped and leave every other vendor reporting `unknown`
 *  forever. Vendor specifics belong in `sourceReferences`, which the report already
 *  carries.
 *
 *    available     — device-side evidence was collected and explains the result
 *    unavailable   — evidence COULD exist but was not collected (device offline, not
 *                    requested, upload blocked). The dangerous one, and the default
 *                    reading for a bare portal status.
 *    not_supported — this source genuinely cannot supply device-side evidence. An
 *                    honest permanent answer, not a gap to chase.
 *    unknown       — the bridge did not say. Treated as `unavailable` for grading;
 *                    kept distinct so "did not answer" and "answered no" stay legible.
 */
export type RootCauseEvidence = "available" | "unavailable" | "not_supported" | "unknown";

/** Raw management-health report about one device (loosely typed).
 *
 *  EVERY field is `unknown`, including the boolean. A bridge is an external system: it
 *  can and does emit `"true"`, `1`, `["drifted"]`, or `"ERR: graph timeout"` in any of
 *  these slots, and the normalizer — not the compiler — is what makes that safe. */
export interface DeviceManagementHealthReportRaw {
  mdmCheckInFreshness?: unknown; // fresh | stale | never | unknown
  agentCheckInFreshness?: unknown; // fresh | stale | never | not_applicable | unknown
  remediationHealth?: unknown; // healthy | issues_detected | failed | not_applicable | unknown
  policyDrift?: unknown; // on_baseline | drifted | unknown
  complianceCoverage?: unknown; // covered | uncovered | unknown
  enrollmentState?: unknown; // enrolled | failed | retired | unknown
  managementReachable?: unknown; // boolean
  rootCauseEvidence?: unknown; // available | unavailable | not_supported | unknown
  [k: string]: unknown;
}

/** The exact set of keys this connector understands. Anything else means the report
 *  was not fully understood — see `reportIntegrity`.
 *
 *  Note there is deliberately no bare `checkInFreshness` here. It was this
 *  connector's original field and it is now an UNRECOGNIZED key, so a bridge still
 *  emitting it is marked malformed and denied rather than silently half-read. That
 *  is the point: the old name could not distinguish the two channels, and failing
 *  loudly on it is the only way a bridge author finds out which one they meant. */
export const DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS = [
  "mdmCheckInFreshness",
  "agentCheckInFreshness",
  "remediationHealth",
  "policyDrift",
  "complianceCoverage",
  "enrollmentState",
  "managementReachable",
  // Registered so a bridge that DOES supply it is not marked malformed for an
  // unrecognized key. Absent stays clean and normalizes to "unknown" — every existing
  // bridge keeps working and simply reports that it does not say.
  "rootCauseEvidence",
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
  mdmCheckInFreshness: MdmCheckInFreshness;
  agentCheckInFreshness: AgentCheckInFreshness;
  remediationHealth: RemediationHealth;
  policyDrift: PolicyDrift;
  complianceCoverage: ComplianceCoverage;
  enrollmentState: EnrollmentState;
  /** true = management plane answered for this device; false = it did not; null = not
   *  reported. Only an explicit true can back a grant. */
  managementReachable: boolean | null;
  /** Is there device-side evidence for WHY a reported failure happened? Only
   *  `available` lets a reported failure be stated as a diagnosis rather than a
   *  symptom. See RootCauseEvidence. */
  rootCauseEvidence: RootCauseEvidence;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type DeviceManagementHealthPosture =
  | "managed_healthy"
  | "unenrolled_device"
  | "unmanaged_device"
  | "drifted_config"
  | "stale_management"
  /** The MDM channel is current but the agent channel is not: profiles and
   *  compliance are being evaluated while apps, scripts and remediations are not
   *  being delivered. The console shows a fresh device. */
  | "stale_agent_channel"
  /** A detection script found a problem on this device that was never remediated. */
  | "unremediated_defect"
  | "unverified"
  | "unknown";

export type DeviceManagementHealthReasonCode =
  | "MANAGEMENT_HEALTHY"
  | "ENROLLMENT_RETIRED"
  | "ENROLLMENT_FAILED"
  // The portal reported a failure and no device-side evidence explains it. Distinct
  // from ENROLLMENT_FAILED on purpose: same outcome, different CLAIM. This one says
  // "a failure is reported and the cause is unverified" instead of asserting a
  // diagnosis, and it tells an operator the next step is to collect logs — not to
  // guess an owner.
  | "ENROLLMENT_ROOT_CAUSE_UNVERIFIED"
  | "COMPLIANCE_UNCOVERED"
  | "POLICY_DRIFTED"
  | "MDM_CHECKIN_NEVER"
  | "MDM_CHECKIN_STALE"
  | "AGENT_CHECKIN_NEVER"
  | "AGENT_CHECKIN_STALE"
  | "REMEDIATION_ISSUES_DETECTED"
  | "REMEDIATION_FAILED"
  /** The report's two channel fields contradict each other — it claims the device
   *  has no agent channel while also reporting a state only that channel produces. */
  | "CHANNEL_REPORT_INCONSISTENT"
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
  /** Confirmed known-bad FACTS about this device, as opposed to gaps in what we
   *  know. Every restrict-level condition contributes one (retired or failed
   *  enrollment, no compliance policy in scope), and so does a detected-but-
   *  unremediated defect — that is a thing the management plane looked at and
   *  found, which is why it belongs here even though it alerts rather than
   *  contains. */
  criticalFindings: string[];
  /** Management facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the device is positively confirmed under effective management:
   *  fresh on the MDM channel, fresh (or confirmed absent) on the agent channel,
   *  remediation-healthy (or confirmed unassigned), on its assigned baseline,
   *  covered by a compliance policy, enrolled, and the management plane confirmed
   *  reachable. */
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
