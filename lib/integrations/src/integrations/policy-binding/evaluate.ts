import {
  type PolicyBindingAction,
  type PolicyBindingPosture,
  type PolicyBindingReasonCode,
  type PolicyBindingVerdict,
  type NormalizedPolicyBinding,
} from "./types";

/**
 * Pure, deterministic POLICY-BINDING evaluator. Grades one device's group/team
 * assignment against what the management plane's own rules say it should be,
 * fail-closed, on the fabric's unified ladder.
 *
 * Doctrine ("membership IS the policy binding — wrong group applies the wrong
 * policies silently"):
 *  - **unbound** → `restrict`. An enrolled device outside every policy group
 *    receives NO policy at all: affirmatively ungoverned, not merely unknown.
 *  - **mismatched, WIDER** → `restrict`. The fail-open case — the device holds a
 *    more permissive binding than its observed properties warrant (the corporate
 *    supervised device sitting in the BYOD group), and everything still reports
 *    "compliant" against the wrong bar.
 *  - **mismatched, NARROWER** → `monitor`. A fail-closed mistake: over-restricted
 *    is an operations nuisance, not a trust hole.
 *  - **mismatched, direction unreadable** → `step_up` — it cannot be confirmed
 *    NOT to be the fail-open case.
 *  - **mixed membership** (users inside the device group — the flow's own "device
 *    groups contain devices only" rule) → `alert`: policy targeting is broken at
 *    group scale, not for one device.
 *  - **report-only enforcement** → `monitor`. The binding is right and the policy
 *    behind it does not act: Conditional Access in report-only, a compliance policy
 *    whose only noncompliance action is "notify", ASR in audit mode. Staged rollout
 *    is CORRECT practice, so this is not an alert — but it is not a grant either,
 *    and that is the whole point. Without this rung, `bound_correctly` would report
 *    protection the device does not have.
 *  - **disabled enforcement** → `restrict`. Neither acting nor observing is, in
 *    effect, no binding at all — the same posture as `unbound`, and unlike
 *    report-only it is nobody's recommended stage.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *
 * The grant (`none`) requires: clean parse + bound + matched + clean hygiene +
 * ENFORCING. The mismatch DIRECTION is deliberately moot when matched (it only
 * exists in service of a mismatch) — the enumeration pins exactly that granting set.
 *
 * `covered=false` = no binding report came back for this device → step_up.
 */

const ACTION_SEVERITY: Record<PolicyBindingAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluatePolicyBindingOptions {
  /** False when no binding report was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: PolicyBindingPosture;
  action: PolicyBindingAction;
  reason: PolicyBindingReasonCode;
}

export function evaluatePolicyBinding(
  report: NormalizedPolicyBinding,
  opts: EvaluatePolicyBindingOptions = {},
): PolicyBindingVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceRef: report.deviceRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "binding_unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["coverage"],
      bindingConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the grant below).
  // The mismatch direction is only tracked while a mismatch is asserted — it
  // exists in service of the mismatch and is moot otherwise.
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.binding === "unknown") unknownSignals.push("binding");
  if (report.profileMatch === "unknown") unknownSignals.push("profile_match");
  if (report.membershipHygiene === "unknown") unknownSignals.push("membership_hygiene");
  if (report.enforcement === "unknown") unknownSignals.push("enforcement");
  if (report.profileMatch === "mismatched" && report.mismatchDirection === "unknown") unknownSignals.push("mismatch_direction");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── the binding itself ──────────────────────────────────────────────────────────
  if (report.binding === "unbound") {
    criticalFindings.push("unbound_ungoverned");
    candidates.push({ posture: "unbound", action: "restrict", reason: "UNBOUND_UNGOVERNED" });
  } else if (report.binding === "unknown") {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "BINDING_UNKNOWN" });
  }

  // ── does the binding match the device's observed properties? ────────────────────
  if (report.profileMatch === "mismatched") {
    if (report.mismatchDirection === "wider") {
      criticalFindings.push("binding_too_wide");
      candidates.push({ posture: "binding_too_wide", action: "restrict", reason: "BINDING_TOO_WIDE" });
    } else if (report.mismatchDirection === "narrower") {
      candidates.push({ posture: "binding_too_narrow", action: "monitor", reason: "BINDING_TOO_NARROW" });
    } else {
      // Mismatched and the direction is unreadable — cannot confirm it is not
      // the fail-open case.
      candidates.push({ posture: "binding_unverified", action: "step_up", reason: "MISMATCH_DIRECTION_UNKNOWN" });
    }
  } else if (report.profileMatch === "unknown") {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "MATCH_UNKNOWN" });
  }

  // ── membership hygiene ──────────────────────────────────────────────────────────
  if (report.membershipHygiene === "mixed") {
    criticalFindings.push("mixed_membership");
    candidates.push({ posture: "mixed_membership", action: "alert", reason: "MIXED_MEMBERSHIP" });
  } else if (report.membershipHygiene === "unknown") {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "HYGIENE_UNKNOWN" });
  }

  // ── does the bound policy actually ACT? ─────────────────────────────────────────
  // Pushed AFTER the branches above so that when several axes are unreadable at once
  // the more specific binding/match/hygiene reason still leads the record (the fold
  // keeps the FIRST candidate at a given severity).
  if (report.enforcement === "report_only") {
    // Fail-OPEN: the device is governed on paper and gated by nothing. A finding
    // even though a report-only rollout stage is correct practice — the fabric
    // grades what is true of the device, not whether an operator meant it.
    criticalFindings.push("binding_report_only");
    candidates.push({ posture: "binding_report_only", action: "monitor", reason: "BINDING_REPORT_ONLY" });
  } else if (report.enforcement === "disabled") {
    criticalFindings.push("binding_disabled");
    candidates.push({ posture: "binding_disabled", action: "restrict", reason: "BINDING_DISABLED" });
  } else if (report.enforcement === "unknown") {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "ENFORCEMENT_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on parse, binding, match, hygiene,
  // and enforcement. The branches above already push a raising candidate for every
  // non-confirmed state, so today this never fires — but if any branch were later
  // weakened so a non-confirmed state produced an empty candidate list, this
  // backstop forces a step_up rather than letting the seed grant survive.
  const positivelyBound =
    report.reportIntegrity === "clean" &&
    report.binding === "bound" &&
    report.profileMatch === "matched" &&
    report.enforcement === "enforcing" &&
    report.membershipHygiene === "clean";
  if (!positivelyBound && candidates.length === 0) {
    candidates.push({ posture: "binding_unverified", action: "step_up", reason: "BINDING_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: bound,
  // matched, clean hygiene, enforcing, clean parse. (Direction is moot when
  // matched.)
  const seed: Candidate = { posture: "bound_correctly", action: "none", reason: "BOUND_CORRECTLY" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    bindingConfirmed: winner.action === "none",
  };
}
