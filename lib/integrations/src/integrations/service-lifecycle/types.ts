// Types for the read-only SERVICE-LIFECYCLE dimension.
//
// THE QUESTION THIS ANSWERS, and it is deliberately one question: **does the
// SERVICE plane still agree with the ACCOUNT plane that this principal is here?**
//
// Origin: intake ledger row 54 (a Level-1 "Password & Account Management"
// reference and the owner's Identity Operations analysis). Eight of that
// reference's ten scenarios land on dimensions that already exist —
// `access-governance` (leaver still active, over-permission), `identity-risk`
// (repeated lockouts, credential attack), `bootstrap-credential` (the VIP TAP
// path, exhaustively), `challenge-capability` (MFA dead after a phone swap),
// `policy-binding` (Conditional Access blocking a permitted resource),
// `entitlement-binding` (a permission nobody can review). Two did not, and
// they are the two this file exists for.
//
// ── WHY THE ACCOUNT PLANE IS NOT ENOUGH ──────────────────────────────────────
//
// `access-governance` grades `accountStatus`, and `active` is its clean state:
// it contributes nothing and forecloses nothing. Now watch the sequence a real
// Microsoft tenant actually offboards in. The LICENCE is reclaimed first,
// because it bills monthly and somebody owns that number. Disabling the account
// costs nothing, so it is a checklist line that sometimes never gets ticked.
// The result is an object that is functionally a leaver — every service plan
// stripped — reading `active`, and an IGA plane that (by its own header) is
// cadence-based and has not yet produced `leaver_pending`.
//
// That is the unearned affirmative in its purest form: **`active` carried by the
// absence of an action rather than the presence of a decision.** The evidence
// that contradicts it sits one plane over, in the licensing record, which
// nothing in the fabric read.
//
// The doctrine to apply is the owner's own, recorded at intake row 44 for a
// different pair of planes: when two planes disagree about lifecycle, PRESERVE
// THE CONTRADICTION, raise assurance, route to the owner. Never resolve it
// silently in either direction.
//
// ── WHY THIS IS A SEPARATE FAMILY AND NOT AN AXIS ON access-governance ───────
//
// Because a contradiction needs two independent witnesses. `access-governance`
// consumes an ALREADY-EVALUATED governance state from one bridge on one cadence;
// folding this in would let a single bridge report both halves of the
// disagreement, which destroys the only thing the disagreement is evidence of.
// The licensing plane is a different source (Graph `assignedPlans` /
// `provisionedPlans` / `employeeLeaveDateTime`), on a different cadence, with its
// own reachability. Kept apart on purpose.
//
// Nor is this `entitlement-binding`. That dimension asks whether a permission is
// GOVERNABLE — could an accountable human find and revoke it. This one asks
// whether a service assignment is still LIFECYCLE-CONSISTENT. Same noun,
// different property.
//
// ── THE CEILING, stated up front ────────────────────────────────────────────
//
// Never `alert`, never `escalate`. Maximum `restrict`.
//
// The reason is layering, not timidity. This dimension RELAYS a lifecycle fact
// (`employeeLeaveDateTime` reported by the licensing read); `access-governance`
// OWNS lifecycle authority and already escalates `leaver_active`. A relayed fact
// must not outrank the dimension that owns it. Restrict contains the action and
// names the finding; escalation stays with the authority.
//
// ── WHAT THIS DIMENSION REFUSES TO GRADE, and why it still carries it ───────
//
// `provisioning` — "the mailbox is still provisioning", "the licence is assigned
// but the service is not live yet". That is scenarios 3 and 8 of the reference,
// and it fails the row-45 asymmetry test outright: **if this fact is stale or
// wrong, no grant is manufactured.** The worker gets an allow from SignalGrid
// and Exchange refuses them anyway, correctly, one layer down. It is a
// help-desk convenience fact, and under the embedded-UX law it belongs to the
// HOST app that is failing, not to the Assist gate.
//
// It is nonetheless CARRIED, reported, and explicitly excluded from grading —
// rather than dropped — so that the connector cannot silently coerce a
// provisioning state into one of the graded axes, and so that a reader can see
// the refusal instead of inferring it from an absence. The proof asserts the
// refusal mechanically: two normalized reports differing ONLY in `provisioning`
// must produce byte-identical verdicts.

/** Does the SERVICE plane report any live service assignment for this principal?
 *
 *  THE ABSENT-COLLECTION LAW APPLIES HERE AND IS THE WHOLE POINT. An empty or
 *  missing `assignedPlans` array is `unknown`, never `none_assigned`. "The
 *  source listed no plans" and "the source stated this principal has no plans"
 *  are different claims, and only one of them is evidence. Collapsing them would
 *  turn every unreachable licensing bridge into a fleet-wide contradiction
 *  finding. */
export type ServiceAssignmentState = "assigned" | "none_assigned" | "unknown";

/** Has a lifecycle CLOSURE (departure / leave date) been recorded for this
 *  principal? Entra carries this as `employeeLeaveDateTime`. */
export type LifecycleClosureState = "recorded" | "none_recorded" | "unknown";

/** Where the LATEST service assignment instant sits relative to a recorded
 *  closure instant. DERIVED from two source-reported instants compared to EACH
 *  OTHER — there is no reference instant and no clock anywhere in this
 *  dimension, because the question "was this assigned after they left?" is
 *  answered entirely by the two facts themselves.
 *
 *  `not_comparable` = one of the two instants was not reported at all.
 *  `malformed`      = an instant was ASSERTED and could not be read. Distinct,
 *                     for the same reason `nestingDepth` distinguishes them in
 *                     `entitlement-binding`: a broken input must never grade
 *                     cleaner than an honest one. */
export type AssignmentOrder = "before_closure" | "after_closure" | "not_comparable" | "malformed";

/** Service PROVISIONING status. CARRIED, NEVER GRADED — see the file header. */
export type ProvisioningState = "provisioned" | "pending" | "failed" | "unknown";

/** What the caller states the ACCOUNT plane already says about this principal.
 *
 *  POSED, and the direction of the fail-closed rule is inverted from the usual
 *  one — worth reading twice, because getting it backwards would be a hole.
 *
 *  The row-47 dominance rule says a weaker affirmative adds nothing where a
 *  stronger one exists. Applied here, `access-governance` reporting a lifecycle
 *  concern should SILENCE this dimension: two verdicts on one fact, the weaker
 *  one relayed, is noise. So `lifecycle_concern` suppresses.
 *
 *  But the suppression is the PERMISSIVE move, so it is the SUPPRESSION that has
 *  to be earned — not the finding. `unposed` therefore does NOT suppress: if
 *  nobody has told us the stronger dimension is watching, we cannot claim it is.
 *  A weaker signal silenced on an unverified claim that a stronger one has it
 *  covered is exactly how an unearned affirmative gets in through the back door.
 *
 *  `clean` = the account plane positively reports no lifecycle concern, which is
 *  the configuration where the contradiction is live and most worth grading. */
export type AccountPlaneStanding = "clean" | "lifecycle_concern" | "unposed";

/** Was a service-plane report produced for this principal AT ALL?
 *
 *  A fact about OUR COVERAGE, not about the subject — and deliberately so: it is
 *  the one input a hostile report cannot manufacture in its own favour, because
 *  `not_reported` means "this deployment has no licensing bridge", which the
 *  subject does not get a vote on.
 *
 *  Without this axis the dimension would fire `step_up` on every principal in
 *  every deployment that has not wired a licensing read — the "BYOD-unsupervised
 *  fires forever" defect the `uem` family had to be repaired for. Not reported
 *  is `unassessed`: it forecloses nothing, and it is a DIFFERENT posture from
 *  `consistent` so that no composition layer can read a coverage gap as a
 *  corroboration. */
export type ServicePlaneReporting = "reported" | "not_reported" | "unknown";

/** Whether the report itself parsed. Tracked separately, because a malformed
 *  report normalizes every field to `unknown` and would otherwise read as a
 *  confident list of separate blind spots rather than "this is not usable". */
export type ServiceLifecycleReportIntegrity = "intact" | "malformed";

/** The vendor-neutral service-lifecycle state the evaluator grades. */
export interface NormalizedServiceLifecycle {
  /** The directory principal this describes. Echoed into the verdict. */
  readonly principalId: string;
  readonly planeReporting: ServicePlaneReporting;
  readonly assignment: ServiceAssignmentState;
  readonly closure: LifecycleClosureState;
  /** Was a recorded closure superseded by a later re-hire? `true` explains an
   *  assignment dated after a closure — a rehire is ordinary life, not a
   *  finding. `null` = the source did not say, which forecloses the benign
   *  reading without asserting the hostile one. */
  readonly closureSuperseded: boolean | null;
  readonly assignmentOrder: AssignmentOrder;
  /** CARRIED, NOT GRADED. See the file header. */
  readonly provisioning: ProvisioningState;
  readonly accountPlane: AccountPlaneStanding;
  readonly reportIntegrity: ServiceLifecycleReportIntegrity;
}

export type ServiceLifecyclePosture =
  /** The service plane corroborates a live principal. */
  | "consistent"
  /** Service entitlements gone with no recorded closure — the contradiction. */
  | "stripped"
  /** Entitlements still live past a recorded, unsuperseded closure. */
  | "outlived"
  /** A service assignment dated AFTER a recorded, unsuperseded closure. */
  | "re_armed"
  /** The account plane already carries lifecycle authority; this one stands down. */
  | "deferred"
  /** No service-plane report reached us. A COVERAGE state, never a corroboration. */
  | "unassessed"
  /** Something needed to answer the question could not be read, or the report
   *  contradicts itself. */
  | "indeterminate";

/** A strict subset of the unified ladder (`none < monitor < step_up < alert <
 *  restrict < escalate`). Note the ceiling — see the file header. */
export type ServiceLifecycleAction = "none" | "monitor" | "step_up" | "restrict";

export type ServiceLifecycleReasonCode =
  /** Every input positively confirmed and consistent. */
  | "SERVICE_PLANE_CONSISTENT"
  // Coverage — forecloses nothing, and must never read as corroboration.
  | "SERVICE_PLANE_NOT_REPORTED"
  | "SERVICE_PLANE_REPORTING_UNKNOWN"
  // Dominance: the account plane owns this and has spoken.
  | "ACCOUNT_PLANE_ALREADY_AUTHORITATIVE"
  // Affirmative lifecycle contradictions.
  | "SERVICE_REASSIGNED_AFTER_CLOSURE"
  | "SERVICE_ENTITLEMENT_OUTLIVED_CLOSURE"
  | "SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE"
  | "SERVICE_STRIPPED_CLOSURE_UNKNOWN"
  // Blind spots — foreclose, never punish.
  | "REASSIGNMENT_CHECK_BLINDED"
  | "SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN"
  | "SERVICE_ASSIGNMENT_STATE_UNKNOWN"
  | "LIFECYCLE_CLOSURE_STATE_UNKNOWN"
  | "ASSIGNMENT_ORDER_MALFORMED"
  // The report itself could not be trusted.
  | "SERVICE_REPORT_MALFORMED"
  /** Every field parsed and was read, and together they cannot all be true —
   *  e.g. an assignment ordered against a closure that was never recorded.
   *  Deliberately distinct from MALFORMED (unparseable) and from the `*_UNKNOWN`
   *  codes (unread). */
  | "SERVICE_REPORT_INCOHERENT";

export interface ServiceLifecycleVerdict {
  readonly posture: ServiceLifecyclePosture;
  readonly recommendedAction: ServiceLifecycleAction;
  /** Specific enough to name WHICH property failed. An operator reading
   *  `SERVICE_REASSIGNED_AFTER_CLOSURE` knows to go and look at who re-licensed
   *  a departed account; one reading `LIFECYCLE_PROBLEM` does not. */
  readonly reasonCode: ServiceLifecycleReasonCode;
  readonly reportIntegrity: ServiceLifecycleReportIntegrity;
  readonly principalId: string;
}

export type ServiceLifecycleConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class ServiceLifecycleConnectorError extends Error {
  readonly code: ServiceLifecycleConnectorErrorCode;
  readonly status: number;
  constructor(code: ServiceLifecycleConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ServiceLifecycleConnectorError";
    this.code = code;
    this.status = status;
  }
}
