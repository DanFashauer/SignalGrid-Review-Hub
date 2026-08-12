// Pure, deterministic evaluator for the entitlement-binding dimension.
//
// No clock, no randomness, no I/O — the same normalized binding always produces the
// same verdict, so a decision can be replayed from its recorded inputs.
//
// THE RULE THIS ENCODES, same as the uem dimension: a grant requires POSITIVE
// CONFIRMATION OF EVERY INPUT. The seed is the grant, so that adding a value to any
// union without handling it here surfaces as an unjustified grant in the exhaustive
// proof sweep rather than passing silently.
//
// Unknowns FORECLOSE the clean verdict and never escalate past `step_up`. An
// unreadable directory is not evidence of a bad grant.

import type {
  EntitlementBindingAction,
  EntitlementBindingPosture,
  EntitlementBindingReasonCode,
  EntitlementBindingVerdict,
  NormalizedEntitlementBinding,
} from "./types";

/** Worst-concern-wins ordering, so a severe concern is never diluted by a calmer one
 *  that happens to be checked later. The evaluator is ORDER-PROOF and the proof
 *  asserts that by shuffling the inputs. */
const ACTION_RANK: Record<EntitlementBindingAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
};

interface Candidate {
  readonly action: EntitlementBindingAction;
  readonly reason: EntitlementBindingReasonCode;
}

/**
 * Grade a normalized entitlement binding.
 *
 * Every condition that applies contributes a candidate; the strongest wins.
 */
export function evaluateEntitlementBinding(
  binding: NormalizedEntitlementBinding,
): EntitlementBindingVerdict {
  // INTEGRITY FIRST, and it short-circuits — a malformed report would otherwise
  // read as a confident list of separate unknowns.
  if (binding.reportIntegrity === "malformed") {
    return {
      posture: "indeterminate",
      recommendedAction: "step_up",
      reasonCode: "BINDING_REPORT_MALFORMED",
      reportIntegrity: "malformed",
      principalId: binding.principalId,
    };
  }

  // COHERENCE SECOND, and it also short-circuits.
  //
  // FOUND BY THE PROOF SWEEP, not by review — worth recording because the naive
  // version of this evaluator leaked. `not_applicable` is the correct reading for
  // carrier and carrier-owner when the permission is pinned straight to the
  // principal: there genuinely is no group. But nothing stopped a report from
  // claiming `mechanism: "group"` AND `carrierOwner: "not_applicable"`, and because
  // `not_applicable` contributes no concern of its own, that combination sailed
  // through as GOVERNABLE. A directory asserting "a group carries this, and the
  // question of who owns that group does not apply" would have cleared the gate.
  //
  // Every AD/Entra group has an owner attribute — possibly empty, which is
  // `ownerless`. So there is no such thing as a group whose ownership is
  // inapplicable, and a report saying otherwise is contradicting itself.
  //
  // This is its own failure class, deliberately not folded into `MALFORMED` or the
  // `*_UNKNOWN` codes: every field parsed cleanly and was read successfully. What
  // failed is the relationship between them, and an operator can only act on that if
  // the verdict says so.
  if (!coherent(binding)) {
    return {
      posture: "indeterminate",
      recommendedAction: "step_up",
      reasonCode: "BINDING_REPORT_INCOHERENT",
      reportIntegrity: "intact",
      principalId: binding.principalId,
    };
  }

  const candidates: Candidate[] = [];

  // ── Affirmative reviewability failures ──────────────────────────────────────
  if (binding.mechanism === "direct_to_principal") {
    // The poster's first and largest mistake, and the reason this dimension exists.
    // A direct ACE is not enumerated by a campaign that walks groups, so it can be
    // simultaneously "certified" by access-governance and invisible to the review
    // that produced the certification.
    candidates.push({ action: "step_up", reason: "PERMISSION_BOUND_DIRECT_TO_PRINCIPAL" });
  }

  if (binding.carrier === "distribution_group") {
    // A mail object carrying authorization. Same reviewability failure as a direct
    // binding, reached differently: a review targeting security groups never sees it.
    //
    // Note this is graded on the CARRIER TYPE, not on whether the group happens to
    // be mail-enabled. `mail_enabled_security_group` is a security principal and IS
    // enumerated by security-group reviews, so it is governable and contributes
    // nothing here. Grading it as a concern would be enforcing naming hygiene
    // through a runtime gate, which is not this dimension's question.
    candidates.push({ action: "step_up", reason: "CARRIER_NOT_A_SECURITY_GROUP" });
  }

  if (binding.carrierOwner === "ownerless") {
    // Tracked separately from certification on purpose. A campaign can mark an
    // ownerless group reviewed — that is how "certified" and "nobody is accountable
    // for this" coexist in real directories.
    candidates.push({ action: "step_up", reason: "CARRIER_HAS_NO_OWNER" });
  }

  // ── Nesting depth, graded ONLY against an operator-supplied budget ───────────
  //
  // MONITOR, not step_up, and the calibration is deliberate. Depth does not make a
  // grant wrong — the access is identical at depth 1 and depth 6. What it reduces is
  // traceability: the administrator who added a member to the outer group may never
  // have known it conferred the inner permission. That is a reason to watch, not a
  // reason to interrupt a worker.
  //
  // Both operands must be present. With no budget the operator has expressed no
  // policy, and inventing a threshold here would apply a number nobody chose to
  // every tenant. With no depth there is nothing to compare. Neither case is graded
  // as a concern, because "not measured" is not "too deep" — but see below: an
  // unmeasured depth is not silently treated as shallow either, since a `group`
  // binding whose depth is unreported still has a confirmed mechanism, carrier and
  // owner, and those are what reviewability turns on.
  if (binding.nestingDepth === "malformed") {
    // A depth was ASSERTED and could not be read. Graded even with no budget set,
    // because the defect is the unreadable assertion itself, not the comparison —
    // and it must never be quieter than an honest over-budget report, which is what
    // collapsing it into `null` achieved.
    candidates.push({ action: "monitor", reason: "NESTING_DEPTH_MALFORMED" });
  } else if (
    binding.nestingDepthBudget !== null &&
    binding.nestingDepth !== null &&
    binding.nestingDepth > binding.nestingDepthBudget
  ) {
    candidates.push({ action: "monitor", reason: "NESTING_DEPTH_OVER_BUDGET" });
  }

  // ── Unconfirmed inputs ──────────────────────────────────────────────────────
  // One reason code each, so the evidence names WHICH property could not be read.
  if (binding.mechanism === "unknown") {
    candidates.push({ action: "step_up", reason: "BINDING_MECHANISM_UNKNOWN" });
  }
  if (binding.carrier === "unknown") {
    candidates.push({ action: "step_up", reason: "CARRIER_TYPE_UNKNOWN" });
  }
  if (binding.carrierOwner === "unknown") {
    candidates.push({ action: "step_up", reason: "CARRIER_OWNER_UNKNOWN" });
  }

  // NOTE ON `not_applicable`. When the mechanism is `direct_to_principal` there is no
  // carrier and no carrier owner, so `not_applicable` is the correct reading for both
  // and contributes nothing of its own — the direct binding is already the finding.
  // Grading the absent carrier as a second concern would double-count one defect and
  // make the reason code depend on evaluation order.

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_RANK[c.action] > ACTION_RANK[max.action] ? c : max),
    { action: "none", reason: "GRANT_GOVERNABLE" },
  );

  return {
    posture: postureFor(winner),
    recommendedAction: winner.action,
    reasonCode: winner.reason,
    reportIntegrity: "intact",
    principalId: binding.principalId,
  };
}

/**
 * Is the report internally consistent about whether a group is involved?
 *
 * `not_applicable` must track the mechanism in BOTH directions:
 *   - a direct binding has no carrier, so both carrier fields must be
 *     `not_applicable` — a report naming a security group AND a direct binding is
 *     describing two different grants;
 *   - a group binding has a carrier, so neither field may be `not_applicable`.
 *
 * When the mechanism itself is `unknown` there is nothing to be consistent WITH, so
 * coherence is not judged — the unknown mechanism is already a step_up on its own,
 * and inventing a contradiction here would report the wrong reason for it.
 */
function coherent(b: NormalizedEntitlementBinding): boolean {
  const carrierAbsent = b.carrier === "not_applicable";
  const ownerAbsent = b.carrierOwner === "not_applicable";
  if (b.mechanism === "direct_to_principal") return carrierAbsent && ownerAbsent;
  if (b.mechanism === "group") return !carrierAbsent && !ownerAbsent;
  return true;
}

function postureFor(winner: Candidate): EntitlementBindingPosture {
  switch (winner.reason) {
    case "GRANT_GOVERNABLE":
      return "governable";
    // No group review would surface this grant at all.
    case "PERMISSION_BOUND_DIRECT_TO_PRINCIPAL":
    case "CARRIER_NOT_A_SECURITY_GROUP":
      return "unreviewable";
    // Findable, but nobody is accountable for attesting it.
    case "CARRIER_HAS_NO_OWNER":
      return "unattestable";
    // Findable and owned, but further from the principal than the operator can trace.
    case "NESTING_DEPTH_OVER_BUDGET":
    case "NESTING_DEPTH_MALFORMED":
      return "obscured";
    // Driven by an input we could not read. Deliberately NOT one of the affirmative
    // postures above: we do not know the grant is unreviewable, only that we cannot
    // establish that it is reviewable. Reporting otherwise asserts a fact not in
    // evidence.
    case "BINDING_MECHANISM_UNKNOWN":
    case "CARRIER_TYPE_UNKNOWN":
    case "CARRIER_OWNER_UNKNOWN":
    case "BINDING_REPORT_MALFORMED":
    // Unreachable in practice — the coherence gate short-circuits before any
    // candidate is built — but listed so the switch stays EXHAUSTIVE. Adding the
    // reason code without this case made `tsc` fail with "function lacks ending
    // return statement", which is the compiler doing the work a default branch
    // would have hidden. There is deliberately no `default` here for that reason.
    case "BINDING_REPORT_INCOHERENT":
      return "indeterminate";
  }
}
