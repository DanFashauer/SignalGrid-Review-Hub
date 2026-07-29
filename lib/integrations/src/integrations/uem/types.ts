// Types for the READ-ONLY UEM (Unified Endpoint Management) dimension —
// vendor-neutral device enrollment and compliance state from Intune, Jamf, or
// Workspace ONE.
//
// WHY THIS FILE EXISTS AT ALL. The previous `uem/` family was the only connector
// family in the repo outside connector discipline: no fixture mode, no
// `SIGNALGRID_LIVE_INTEGRATIONS` gate, no tier gate, no proof — and it sent
// `LockDevice`, remote-lock, passcode-bypass and `PUT` config updates to REAL
// vendor APIs. AGENTS.md is explicit that high-risk actions stay "simulated and
// approval-required" and that integration work "should start read-only and
// fixture-backed". Those write paths are gone; what remains is a read.
//
// THE ROOT DEFECT THIS SHAPE FIXES. The old contract typed enrollment and
// compliance as plain `boolean`. A boolean cannot say "I could not determine
// this", so an unreadable device silently became `false` — or, in the Jamf
// adapter, a hardcoded `compliant: true` carrying the comment "Jamf uses
// compliance items, would need separate check". A field that cannot express
// ignorance will be filled with a guess, and the guess will be read as fact.
//
// Every state below therefore carries an explicit `unknown`, and the evaluator
// treats it the way golden rule 2 requires: an unknown FORECLOSES a grant, and
// never denies. Same discipline the Graph posture adapter now follows.

/** Which UEM reported this device. `unknown` is a real answer — a report whose
 *  vendor cannot be established is not attributable, and attribution is part of
 *  what makes a signal trustworthy. */
export type UemVendor = "intune" | "jamf" | "workspace-one" | "unknown";

/** Enrollment state, normalized across vendors.
 *  - `enrolled`      — the UEM positively reports the device under management
 *  - `not_enrolled`  — the UEM positively reports it is NOT under management
 *  - `retired`       — enrollment is being torn down (Intune `retirePending`,
 *                      Jamf pending-removal). Management is going away, so the
 *                      posture it reports is about to stop being maintained.
 *  - `unknown`       — could not be determined. NOT the same as `not_enrolled`. */
export type UemEnrollment = "enrolled" | "not_enrolled" | "retired" | "unknown";

/** Compliance state, normalized across vendors.
 *  - `compliant`        — positively evaluated against a policy and passing
 *  - `non_compliant`    — positively evaluated and failing
 *  - `in_grace_period`  — failing, but inside an operator-configured grace window
 *  - `not_evaluated`    — no policy has been evaluated against this device yet.
 *                         This is the state the old Jamf adapter hardcoded to
 *                         `true`; it is an absence of evidence, not a pass.
 *  - `unknown`          — could not be determined. */
export type UemCompliance =
  | "compliant"
  | "non_compliant"
  | "in_grace_period"
  | "not_evaluated"
  | "unknown";

/** Supervision / management mode, where the vendor reports it. Supervision is
 *  what actually makes MDM enforcement possible on Apple platforms, so an
 *  unsupervised device is a materially weaker management story than a supervised
 *  one — see the platform-honesty rule in CLAUDE.md. */
export type UemSupervision = "supervised" | "unsupervised" | "unknown";

/** Whether the normalized report itself parsed cleanly. Tracked SEPARATELY from
 *  the states above, because a malformed report can normalize every field to a
 *  denying sentinel and thereby *look* like a decisive answer. Integrity says
 *  whether the answer means anything at all. */
export type UemReportIntegrity = "intact" | "malformed";

/** The vendor-neutral device state the evaluator grades. Deliberately small: it
 *  carries only what a decision needs, and every field can say `unknown`. */
export interface NormalizedUemDeviceState {
  /** Opaque device identifier as reported by the vendor. Never a serial. */
  readonly deviceId: string;
  readonly vendor: UemVendor;
  readonly enrollment: UemEnrollment;
  readonly compliance: UemCompliance;
  readonly supervision: UemSupervision;
  /** Vendor-reported OS version, or null when absent/unparseable. Informational —
   *  currency is graded by the `app-update` dimension, not here. */
  readonly osVersion: string | null;
  /** Age of the last vendor check-in, in whole seconds, or null when the vendor
   *  did not report one.
   *
   *  A DURATION, NOT A TIMESTAMP, and supplied by the caller rather than computed
   *  here. The previous implementation did `Date.now() - new Date(lastSync)` inside
   *  the read path, which put a wall-clock read into a decision path — forbidden by
   *  golden rule 2, and the reason this dimension could never have been replayed
   *  deterministically. Freshness policy belongs to the caller that owns the clock. */
  readonly lastCheckInAgeSeconds: number | null;
  readonly reportIntegrity: UemReportIntegrity;
}

/** Posture summary — the shape the fabric's other dimensions use. */
export type UemPosture =
  | "managed_compliant"
  | "managed_degraded"
  | "unmanaged"
  | "indeterminate";

/** Actions this dimension can recommend. A subset of the unified ladder
 *  (`none < monitor < step_up < alert < restrict < escalate`).
 *
 *  NOTE THE CEILING: this dimension never returns `escalate`. Enrollment and
 *  compliance describe a device's management story; they are not evidence of an
 *  active compromise, and escalation is reserved for dimensions that can see one
 *  (edr-threat, credential-exposure, custody). Grading a merely-unmanaged device
 *  as an incident would be the kind of over-claim the fabric is built to avoid. */
export type UemAction = "none" | "monitor" | "step_up" | "restrict";

export interface UemVerdict {
  readonly posture: UemPosture;
  readonly recommendedAction: UemAction;
  /** Machine-readable, stable, and specific enough to name WHICH input drove the
   *  outcome — an operator reading `ENROLLMENT_STATE_UNKNOWN` learns something an
   *  operator reading `NOT_HEALTHY` does not. */
  readonly reasonCode: UemReasonCode;
  readonly reportIntegrity: UemReportIntegrity;
}

export type UemReasonCode =
  // Grant — every input positively confirmed.
  | "UEM_MANAGED_COMPLIANT"
  // Affirmative negative facts.
  | "DEVICE_NOT_ENROLLED"
  | "DEVICE_RETIRED"
  | "DEVICE_NON_COMPLIANT"
  | "COMPLIANCE_IN_GRACE_PERIOD"
  | "COMPLIANCE_NOT_EVALUATED"
  | "DEVICE_UNSUPERVISED"
  // Unconfirmed inputs — foreclose the grant, never deny.
  | "ENROLLMENT_STATE_UNKNOWN"
  | "COMPLIANCE_STATE_UNKNOWN"
  | "SUPERVISION_STATE_UNKNOWN"
  | "VENDOR_UNKNOWN"
  // The report itself could not be trusted.
  | "REPORT_MALFORMED";
