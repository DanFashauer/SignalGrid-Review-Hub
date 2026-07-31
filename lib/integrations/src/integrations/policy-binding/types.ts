// Types for the read-only POLICY-BINDING (group-assignment correctness) dimension.
//
// Origin: the Intune endpoint-onboarding flow — users → enrollment group, devices →
// dynamic groups / enrollment-profile groups, and then "policies are assigned to
// security groups, not to each device one by one." The decision-relevant heart of
// that flow: **membership IS the policy binding**. A device's group decides every
// policy it receives, so a wrong binding applies the wrong policies SILENTLY —
// nothing errors, the device even reports "compliant", but it is compliant with the
// wrong bar. Every management plane this fabric documents has the same mechanism
// under a different name (see docs/POLICY_BINDING.md for the full mapping):
//
//   Intune / Entra   → dynamic device groups + enrollment-profile groups
//   Fleet            → teams (the normal-vs-locked-down split; the enforcement
//                      client that carried normalTeamId/restrictedTeamId moved to
//                      the private core and is not in this public tree)
//   Apple ABM / DDM  → ADE enrollment profile + declaration assignment
//   Jamf (candidate) → smart groups
//   PACS             → access levels / clearance groups
//   IdP / Entra CA   → user security groups + Conditional Access scoping
//   WMS / task plane → queue and zone assignment
//   EDR              → sensor policy groups
//   SignalGrid itself→ per-vertical policy bundles (the fabric's own binding is
//                      subject to exactly the same drift)
//
// The failure modes this dimension grades, uniformly:
//   • **unbound** — enrolled but in no policy group: the device receives NO policy
//     at all. Affirmatively ungoverned.
//   • **binding too WIDE** — the device holds a MORE permissive binding than its
//     observed properties warrant (the corporate supervised iPhone sitting in the
//     BYOD group). Fail-open, silent, and the worst case.
//   • **binding too NARROW** — over-restricted. A fail-closed mistake: an
//     operations nuisance, not a trust hole.
//   • **mixed membership** — users inside a device group (the flow's own hygiene
//     rule: "device groups contain devices only"). Policy targeting is broken at
//     group scale.
//   • **bound to a policy that does not ACT** — the binding is perfect and the
//     policy behind it is in report-only/audit mode, or switched off. See
//     `PolicyEnforcement` below; this is the axis that stops a correct binding
//     from being mistaken for an enforced one.
//   • **unknown anything** — raises, never grants.
//
// The match verdict comes from the management plane's OWN rule re-evaluation
// (Intune re-reads OS type / ownership / management type / enrollment profile
// against its dynamic-group rules), reported to the fabric — this dimension never
// re-implements a vendor's grouping engine, it grades the reported outcome.

/** Is the device assigned to any policy-bearing group/team at all? */
export type BindingState = "bound" | "unbound" | "unknown";

/** The management plane's own answer: does the CURRENT binding match what its
 *  rules derive from the device's observed properties? */
export type ProfileMatch = "matched" | "mismatched" | "unknown";

/** When mismatched: is the actual binding MORE permissive than warranted
 *  ("wider" — fail-open) or LESS ("narrower" — fail-closed)? */
export type MismatchDirection = "wider" | "narrower" | "unknown";

/** The flow's hygiene rule: device groups contain devices only. `mixed` = users
 *  (or other foreign principals) found inside the device group. */
export type MembershipHygiene = "clean" | "mixed" | "unknown";

/**
 * Does the policy behind the binding actually ACT on this device?
 *
 * A device can be in exactly the right group, matched by the plane's own rules,
 * with clean membership — and receive nothing, because the policy assigned to that
 * group evaluates without enforcing. Every plane ships this mode deliberately, and
 * recommends it as a rollout stage:
 *
 *   Entra Conditional Access → "report-only" (evaluates, logs, does not block)
 *   Intune compliance policy → actions for noncompliance limited to "notify", with
 *                              no mark-noncompliant/block action configured
 *   Defender ASR rules       → audit mode
 *   Update rings             → a deferral/grace window where the deadline has not
 *                              yet arrived, so nothing installs
 *
 * The failure this axis names is NOT the mode itself — a staged rollout is correct
 * practice. It is that `bound_correctly` reads as protection, and a report-only
 * policy provides none. Without this axis the dimension's own grant is exactly the
 * watermelon `response-accountability` exists to catch: every process metric green,
 * nothing actually gated.
 *
 * `disabled` is the harder state: the policy neither acts NOR observes, which is
 * indistinguishable in effect from having no binding at all — and, unlike
 * report-only, is nobody's recommended stage.
 */
export type PolicyEnforcement = "enforcing" | "report_only" | "disabled" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — management planes are EXTERNAL systems and may
 *  emit anything in any slot; the normalizer makes values safe). */
export interface PolicyBindingReportRaw {
  binding?: unknown; // bound | unbound | unknown
  profile_match?: unknown; // matched | mismatched | unknown
  mismatch_direction?: unknown; // wider | narrower | unknown
  membership_hygiene?: unknown; // clean | mixed | unknown
  enforcement?: unknown; // enforcing | report_only | disabled | unknown
  [k: string]: unknown;
}

export const POLICY_BINDING_REPORT_KEYS = [
  "binding",
  "profile_match",
  "mismatch_direction",
  "membership_hygiene",
  "enforcement",
] as const;

export interface NormalizedPolicyBinding {
  sourceSystem: "policy-binding";
  deviceRef: string;
  binding: BindingState;
  profileMatch: ProfileMatch;
  mismatchDirection: MismatchDirection;
  membershipHygiene: MembershipHygiene;
  enforcement: PolicyEnforcement;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type PolicyBindingPosture =
  | "bound_correctly" // bound + matched + clean hygiene + ENFORCING + clean parse — the grant
  | "unbound" // enrolled but ungoverned
  | "binding_too_wide" // fail-open: more permissive than the properties warrant
  | "binding_too_narrow" // fail-closed mistake: over-restricted
  | "mixed_membership" // users inside the device group
  | "binding_report_only" // correctly bound to a policy that evaluates but does not act
  | "binding_disabled" // bound to a policy that neither acts nor observes
  | "binding_unverified"; // any axis unknown / malformed

export type PolicyBindingAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type PolicyBindingReasonCode =
  | "BOUND_CORRECTLY"
  | "UNBOUND_UNGOVERNED"
  | "BINDING_TOO_WIDE"
  | "BINDING_TOO_NARROW"
  | "MISMATCH_DIRECTION_UNKNOWN"
  | "MATCH_UNKNOWN"
  | "BINDING_UNKNOWN"
  | "MIXED_MEMBERSHIP"
  | "HYGIENE_UNKNOWN"
  | "BINDING_REPORT_ONLY"
  | "BINDING_DISABLED"
  | "ENFORCEMENT_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface PolicyBindingVerdict {
  deviceRef: string;
  posture: PolicyBindingPosture;
  reasonCode: PolicyBindingReasonCode;
  recommendedAction: PolicyBindingAction;
  /** Affirmative binding concerns (unbound, too-wide, mixed membership, and a
   *  binding whose policy does not act). Fail-OPEN states only — `too_narrow` is a
   *  real finding but a fail-closed one, so it is not listed here. */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the binding is positively correct AND enforcing: bound +
   *  matched + clean hygiene + enforcing + clean parse. A correct binding to a
   *  report-only policy is NOT a confirmation — that is the whole point of the
   *  enforcement axis. */
  bindingConfirmed: boolean;
}

export class PolicyBindingConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PolicyBindingConnectorError";
  }
}
