// break-glass — was this emergency override ACCOUNTABLE?
//
// Intake ledger row 59, from the Healthcare 360 enterprise-architecture map. Almost
// every element of the healthcare wedge already had a dimension; this was the one
// that did not, and it is the one a hospital security reviewer asks about first.
//
// NOT the same break-glass `platform-sso` already grades. That one asks whether a
// break-glass ADMIN ACCOUNT exists, so a tenant is not locked out of its own IdP —
// an administrative-continuity question. This asks whether a CLINICIAN who reached
// past the normal gate to reach a patient record did so accountably. Different
// actor, different plane, different failure.
//
// THE ROW-45 CANDIDATE IS THE SHARPEST IN THE FABRIC. Break-glass is BY DESIGN a
// grant that bypasses the checks. That is its whole function and it is correct: a
// clinician in an emergency must not be stopped by an assignment table. But it means
// an unjustified, unbounded, unreviewed invocation is indistinguishable from a
// legitimate one UNLESS the accountability evidence is graded — and a system that
// treats a missing justification as an acceptable one has not built an emergency
// path, it has built an unauditable universal override with a sympathetic name.
//
// THE CEILING IS `alert`, AND IT IS LOWER THAN EVERY OTHER FAMILY HERE ON PURPOSE.
// This dimension can NEVER restrict, deny, or even step up. Adding friction to
// emergency care is a clinical-safety harm, and under the embedded-UX law the host
// application owns domain safety. The job is to make the override REVIEWABLE, not to
// impede it. A break-glass that was wrong is a finding for the compliance owner
// after the fact; it is never a reason to slow down the person at the bedside.

/**
 * Did the invoker state a reason, and can we read it?
 *
 * `unreadable` is separate from `absent` because they fail differently: a missing
 * justification is a workflow that never asked, and an unreadable one is a workflow
 * that asked and lost the answer. The first is a policy gap, the second a plumbing
 * defect, and they go to different owners.
 */
export type JustificationState = "recorded" | "absent" | "unreadable";

/**
 * How wide the override reached.
 *
 * `single_encounter` is the defensible shape — this patient, this visit. `broad` is
 * a standing bypass, which is the state auditors actually find in the wild and the
 * one that turns an emergency mechanism into an ambient one.
 */
export type InvocationScope = "single_encounter" | "broad" | "unknown";

/**
 * Whether the override ends by itself.
 *
 * An unbounded break-glass is not an emergency measure, it is a permission change
 * that nobody filed. Note this is a STATE, not a duration — no clock is read in this
 * family, and whether a bound has elapsed is the caller's to supply.
 */
export type ExpiryState = "bounded" | "unbounded" | "unknown";

/**
 * What happened AFTERWARDS — the half most deployments never build.
 *
 * A break-glass programme with no review loop produces a growing pile of
 * self-authorised access with nobody reading it. `never_reviewed` is deliberately
 * distinct from `pending`: one is a queue with a backlog, the other is no queue.
 */
export type ReviewState = "reviewed" | "pending" | "never_reviewed" | "unknown";

/**
 * Was the invoker actually outside their assignment at the time?
 *
 * This is what separates a legitimate emergency from misuse. Break-glass by someone
 * who WAS already assigned to the patient did not need to bypass anything — it is
 * either muscle memory, a broken assignment feed, or a deliberate audit dodge, and
 * all three are worth surfacing.
 */
export type AssignmentAtInvocation = "not_assigned" | "assigned" | "unknown";

/** Vendor-reported integrity. One unreadable field makes the whole record malformed. */
export type BreakGlassReportIntegrity = "intact" | "malformed";

export interface NormalizedBreakGlass {
  readonly invocationRef: string;
  readonly justification: JustificationState;
  readonly scope: InvocationScope;
  readonly expiry: ExpiryState;
  readonly review: ReviewState;
  readonly assignmentAtInvocation: AssignmentAtInvocation;
  readonly reportIntegrity: BreakGlassReportIntegrity;
}

export type BreakGlassPosture =
  /** Justified, scoped, bounded, and reviewed. The shape a regulator wants to see. */
  | "accountable"
  /** Real gaps in the accountability record, but the override itself looks legitimate. */
  | "under_documented"
  /** The override did not need to happen, or cannot be accounted for at all. */
  | "unaccountable"
  /** No break-glass programme evidence reached us. */
  | "unassessed";

/**
 * Actions this dimension can recommend.
 *
 * NOTE THE CEILING — `alert`, and NOTHING above it. No `step_up`, no `restrict`, no
 * `deny`. Every other family in this fabric can at least step up; this one cannot,
 * because the moment it does it is standing between a clinician and a patient. The
 * proof asserts this over the entire state space, including the worst state the
 * model can express.
 */
export type BreakGlassAction = "none" | "monitor" | "alert";

export type BreakGlassReasonCode =
  | "BREAK_GLASS_ACCOUNTABLE"
  | "BREAK_GLASS_UNJUSTIFIED"
  | "BREAK_GLASS_JUSTIFICATION_UNREADABLE"
  | "BREAK_GLASS_SCOPE_BROAD"
  | "BREAK_GLASS_UNBOUNDED"
  | "BREAK_GLASS_NEVER_REVIEWED"
  | "BREAK_GLASS_REVIEW_PENDING"
  | "BREAK_GLASS_NOT_NEEDED"
  | "BREAK_GLASS_UNASSESSED"
  | "REPORT_MALFORMED";

export interface BreakGlassVerdict {
  readonly posture: BreakGlassPosture;
  readonly recommendedAction: BreakGlassAction;
  readonly reasonCode: BreakGlassReasonCode;
  readonly reportIntegrity: BreakGlassReportIntegrity;
}

/**
 * What this family will and will not do, stated so it cannot drift.
 *
 * `neverImpedesCare` is the load-bearing one and the proof checks it directly rather
 * than trusting this constant — a promise in a config object is still only a promise.
 */
export const BREAK_GLASS_CONTRACT = {
  /** The strongest action reachable, over the whole state space. */
  ceiling: "alert",
  /** This dimension never delays or blocks emergency access. */
  neverImpedesCare: true,
  /** No actuator: it cannot revoke, close, or expire an override. */
  actuatorsExposed: false,
  /** Emergency access is the EHR's to grant; this only grades the record of it. */
  systemOfRecord: "ehr-audit-plane",
} as const;
