// Types for the READ-ONLY entitlement-binding dimension.
//
// THE QUESTION THIS ANSWERS, and it is deliberately narrow: **is the permission
// this principal is using GOVERNABLE — could an accountable human find it, review
// it, and revoke it?**
//
// That is NOT the question `access-governance` answers. That dimension grades
// whether a grant is CORRECT: in scope, certified, conflict-free, not standing
// privilege. It assumes the grant is reviewable, and says so explicitly in its own
// header — it "consumes the evaluated governance state (it does NOT re-pull raw
// directory group membership)".
//
// The gap is the assumption. A permission pinned DIRECTLY to a user can be
// `in_scope`, `certified`, free of SoD conflict and unprivileged, and still be
// invisible to every access-certification campaign that will ever run, because
// those campaigns enumerate GROUPS. It passes every existing check by never
// appearing in one. Correctness and reviewability are different properties, and
// only one of them was modelled.
//
// NOR is it what `policy-binding` answers. That dimension grades a DEVICE's binding
// to a management group — bound/unbound, wider/narrower than the plane's own rules
// derive. This one grades a PRINCIPAL's binding to a permission. Same word,
// different subject; the two are kept apart on purpose and neither reads the
// other's fields.
//
// WHY IT MATTERS ON A SHARED FRONTLINE DEVICE. Ungovernable grants accumulate.
// Nobody removes what nobody can see, so the direct ACE added during an incident
// three years ago outlives the incident, the project and the employee. On a
// badge-checked-out device the identity changes every shift while the grant does
// not.
//
// THE CEILING, stated up front: this dimension never returns `alert`, `restrict` or
// `escalate`. An ungovernable grant is a REVIEW failure, not evidence that anything
// bad is happening — the permission may be perfectly appropriate. Restricting a
// worker mid-shift because an administrator took a shortcut years ago would punish
// the wrong person for the wrong thing. It raises the bar and names the finding.

/** HOW the permission reaches the principal.
 *
 *  - `group`                — carried by a group the principal belongs to. The
 *                             reviewable case: a certification campaign that
 *                             enumerates groups will find it.
 *  - `direct_to_principal`  — pinned to the user or service account itself (a
 *                             direct ACE / direct role assignment). The permission
 *                             exists nowhere a group review would look.
 *  - `unknown`              — could not be determined. NOT the same as `group`;
 *                             assuming the reviewable case is the fail-open
 *                             direction. */
export type BindingMechanism = "group" | "direct_to_principal" | "unknown";

/** WHAT KIND of object carries the permission, when a group carries it.
 *
 *  - `security_group`              — a security principal. The governed path.
 *  - `mail_enabled_security_group` — also a security principal, and also a mail
 *                                    object. Discouraged for hygiene reasons, but
 *                                    it IS enumerated by security-group reviews, so
 *                                    it is governable and graded as such. Hygiene
 *                                    is not this dimension's question.
 *  - `distribution_group`          — a mail object being used to carry
 *                                    authorization. It sits outside the
 *                                    security-group governance path, so a review
 *                                    targeting security groups does not see it —
 *                                    the same reviewability failure as a direct
 *                                    binding, arrived at differently.
 *  - `not_applicable`              — no group carries it (mechanism is direct).
 *                                    A real answer, not an absence.
 *  - `unknown`                     — could not be determined. */
export type CarrierType =
  | "security_group"
  | "mail_enabled_security_group"
  | "distribution_group"
  | "not_applicable"
  | "unknown";

/** Whether the carrier has an accountable owner.
 *
 *  An ownerless group cannot be attested by anyone, even in principle. A
 *  certification campaign can still mark it reviewed — which is how "certified"
 *  and "nobody is accountable for this" coexist, and why this is tracked as its
 *  own axis rather than folded into certification state. */
export type CarrierOwnerState = "owner_assigned" | "ownerless" | "not_applicable" | "unknown";

/** Whether the report itself parsed. Tracked SEPARATELY, because a malformed report
 *  normalizes every field to `unknown` and would otherwise read as a confident
 *  "several things could not be determined" rather than "this is not usable". */
export type BindingReportIntegrity = "intact" | "malformed";

/** The vendor-neutral binding state the evaluator grades. */
export interface NormalizedEntitlementBinding {
  /** The directory principal whose grant this describes. Echoed into the verdict so
   *  a downstream driver carries the subject. */
  readonly principalId: string;
  readonly mechanism: BindingMechanism;
  readonly carrier: CarrierType;
  readonly carrierOwner: CarrierOwnerState;
  /** Hops from the principal to the group holding the permission. 0 = the principal
   *  is a direct member of the group that carries it.
   *
   *  `null`      = not reported at all (the directory said nothing).
   *  `"malformed"` = reported, but unreadable (negative, fractional, a string).
   *
   *  THOSE TWO ARE DIFFERENT and collapsing them was a defect found by adversarial
   *  review. Both used to become `null`, and `null` skips the budget comparison — so
   *  a report claiming `nestingDepth: -1` graded CLEANER than an honest report of a
   *  genuinely over-budget depth. A broken input must never outrank a truthful one.
   *
   *  A COUNT SUPPLIED BY THE CALLER, never traversed here — walking a directory
   *  would put I/O in a decision path, and the graph/uem connectors own that read.
   *  Same discipline as `fixAgeSeconds` in the rtls-custody dimension. */
  readonly nestingDepth: number | null | "malformed";
  /** The deepest nesting the operator considers reviewable. Caller-supplied POLICY,
   *  not a constant in this file.
   *
   *  A threshold hardcoded here would be a number nobody chose, applied to every
   *  tenant — and directory designs legitimately differ. `null` means the operator
   *  has expressed no budget, in which case depth is not graded at all rather than
   *  graded against a guess. */
  readonly nestingDepthBudget: number | null;
  readonly reportIntegrity: BindingReportIntegrity;
}

export type EntitlementBindingPosture =
  /** Carried by a security principal, owned, within depth budget. */
  | "governable"
  /** Reachable, but no group review would surface it. */
  | "unreviewable"
  /** Reviewable in principle, but nobody is accountable for it. */
  | "unattestable"
  /** Reviewable and owned, but reached through more nesting than the operator
   *  considers traceable. */
  | "obscured"
  /** Something needed to answer the question could not be read. */
  | "indeterminate";

/** Actions this dimension can recommend — a strict subset of the unified ladder
 *  (`none < monitor < step_up < alert < restrict < escalate`).
 *
 *  NOTE THE CEILING: never `alert`, `restrict` or `escalate`. See the file header. */
export type EntitlementBindingAction = "none" | "monitor" | "step_up";

export type EntitlementBindingReasonCode =
  /** Every input positively confirmed. */
  | "GRANT_GOVERNABLE"
  // Affirmative reviewability failures.
  | "PERMISSION_BOUND_DIRECT_TO_PRINCIPAL"
  | "CARRIER_NOT_A_SECURITY_GROUP"
  | "CARRIER_HAS_NO_OWNER"
  | "NESTING_DEPTH_OVER_BUDGET"
  /** A depth was asserted but could not be read. Distinct from "not reported". */
  | "NESTING_DEPTH_MALFORMED"
  // Unconfirmed inputs — foreclose the grant, never deny.
  | "BINDING_MECHANISM_UNKNOWN"
  | "CARRIER_TYPE_UNKNOWN"
  | "CARRIER_OWNER_UNKNOWN"
  // The report itself could not be trusted.
  | "BINDING_REPORT_MALFORMED"
  /** The report asserts a combination that cannot be true — e.g. a group carries the
   *  permission, but the carrier owner is `not_applicable`. Distinct from
   *  `MALFORMED` (unparseable) and from the `*_UNKNOWN` codes (unread): every field
   *  parsed and was read, and together they contradict. */
  | "BINDING_REPORT_INCOHERENT";

export interface EntitlementBindingVerdict {
  readonly posture: EntitlementBindingPosture;
  readonly recommendedAction: EntitlementBindingAction;
  /** Specific enough to name WHICH property failed. An operator reading
   *  `PERMISSION_BOUND_DIRECT_TO_PRINCIPAL` learns what to go and fix; one reading
   *  `NOT_GOVERNED` does not. */
  readonly reasonCode: EntitlementBindingReasonCode;
  readonly reportIntegrity: BindingReportIntegrity;
  readonly principalId: string;
}
