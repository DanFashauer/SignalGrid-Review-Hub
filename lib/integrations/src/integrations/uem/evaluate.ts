// Pure, deterministic evaluator for the read-only UEM dimension.
//
// No clock, no randomness, no I/O — the same normalized state always produces the
// same verdict, so a decision can be replayed from its recorded inputs.
//
// THE RULE THIS ENCODES: a grant requires POSITIVE CONFIRMATION OF EVERY INPUT.
// Not "no bad value was seen" — that is the fail-open shape found in the Graph
// posture adapter, where five specific bad values were tested and everything else
// fell through to an affirmative claim of health. Here the default is a concern
// and only a fully-confirmed state clears it.
//
// Unknowns FORECLOSE the grant but never DENY. An unreadable UEM is not evidence
// of a bad device; restricting on one would strand a clinician mid-shift because a
// vendor API timed out. So every `unknown` contributes `step_up`, never `restrict`.

import type {
  NormalizedUemDeviceState,
  UemAction,
  UemPosture,
  UemReasonCode,
  UemVerdict,
} from "./types";

/** Worst-concern-wins ordering. Higher rank outranks lower, so a severe concern is
 *  never diluted by a calmer one that happens to be checked later — the evaluator
 *  is ORDER-PROOF, and the proof asserts that. */
const ACTION_RANK: Record<UemAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  restrict: 3,
};

interface Candidate {
  readonly action: UemAction;
  readonly reason: UemReasonCode;
}

/**
 * Grade a normalized UEM device state.
 *
 * Every condition that applies contributes a candidate; the strongest wins. The
 * seed is deliberately the grant, so that adding a new state to any union without
 * handling it here shows up as an unjustified grant in the exhaustive proof sweep
 * rather than passing silently.
 */
export function evaluateUem(state: NormalizedUemDeviceState): UemVerdict {
  // INTEGRITY FIRST, and it short-circuits. A malformed report normalizes every
  // field to `unknown`, which would otherwise read as a confident "several things
  // could not be determined" when the truth is "this report is not usable at all".
  // Grant-ness alone cannot see the difference; that is why integrity is tracked
  // as its own axis rather than folded into the state values.
  if (state.reportIntegrity === "malformed") {
    return {
      posture: "indeterminate",
      recommendedAction: "step_up",
      reasonCode: "REPORT_MALFORMED",
      reportIntegrity: "malformed",
    };
  }

  const candidates: Candidate[] = [];

  // ── Affirmative negative facts ──────────────────────────────────────────────
  // A device the UEM positively reports as unmanaged or failing policy.
  if (state.enrollment === "not_enrolled") {
    candidates.push({ action: "restrict", reason: "DEVICE_NOT_ENROLLED" });
  }
  if (state.enrollment === "retired") {
    // Management is being torn down: the posture this device reports is about to
    // stop being maintained, and a shared device whose management is ending should
    // not be trusted on the strength of a report that is itself expiring.
    candidates.push({ action: "restrict", reason: "DEVICE_RETIRED" });
  }
  if (state.compliance === "non_compliant") {
    candidates.push({ action: "restrict", reason: "DEVICE_NON_COMPLIANT" });
  }
  if (state.compliance === "in_grace_period") {
    // Failing, but the operator has deliberately allowed a window. Honour the
    // operator's policy — step up rather than restrict — while refusing to call it
    // compliant, because it is not.
    candidates.push({ action: "step_up", reason: "COMPLIANCE_IN_GRACE_PERIOD" });
  }
  if (state.compliance === "not_evaluated") {
    // No policy has been evaluated against this device. THIS is the state the old
    // Jamf adapter hardcoded to `compliant: true`. Absence of evidence is not a
    // pass, and saying so is the whole point of this dimension existing.
    candidates.push({ action: "step_up", reason: "COMPLIANCE_NOT_EVALUATED" });
  }
  if (state.supervision === "unsupervised") {
    // Supervision is what makes MDM enforcement possible on Apple platforms. An
    // unsupervised device is a materially weaker management story, but it is a
    // legitimate deployment choice, so it raises the bar rather than blocking.
    candidates.push({ action: "step_up", reason: "DEVICE_UNSUPERVISED" });
  }

  // ── Unconfirmed inputs ──────────────────────────────────────────────────────
  // Enumerated separately, one reason code each, so the evidence names WHICH
  // signal could not be confirmed instead of collapsing to a single catch-all.
  if (state.enrollment === "unknown") {
    candidates.push({ action: "step_up", reason: "ENROLLMENT_STATE_UNKNOWN" });
  }
  if (state.compliance === "unknown") {
    candidates.push({ action: "step_up", reason: "COMPLIANCE_STATE_UNKNOWN" });
  }
  if (state.supervision === "unknown") {
    candidates.push({ action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }
  if (state.vendor === "unknown") {
    // An unattributable report. The values may be fine, but nothing establishes
    // who said them, and provenance is part of what makes a signal usable.
    candidates.push({ action: "step_up", reason: "VENDOR_UNKNOWN" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_RANK[c.action] > ACTION_RANK[max.action] ? c : max),
    { action: "none", reason: "UEM_MANAGED_COMPLIANT" },
  );

  return {
    posture: postureFor(winner),
    recommendedAction: winner.action,
    reasonCode: winner.reason,
    reportIntegrity: "intact",
  };
}

function postureFor(winner: Candidate): UemPosture {
  if (winner.action === "none") return "managed_compliant";
  // `unmanaged` is claimed ONLY where enrollment is affirmatively absent or ending.
  // A device that is enrolled but non-compliant is degraded, not unmanaged, and
  // conflating the two would misdirect whoever acts on the verdict.
  if (winner.reason === "DEVICE_NOT_ENROLLED" || winner.reason === "DEVICE_RETIRED") {
    return "unmanaged";
  }
  // Anything driven by an unconfirmed input is INDETERMINATE, not degraded: we do
  // not know that the device is in a worse state, only that we cannot say it is in
  // a good one. Reporting "degraded" there would assert a fact not in evidence.
  if (
    winner.reason === "ENROLLMENT_STATE_UNKNOWN" ||
    winner.reason === "COMPLIANCE_STATE_UNKNOWN" ||
    winner.reason === "SUPERVISION_STATE_UNKNOWN" ||
    winner.reason === "VENDOR_UNKNOWN" ||
    winner.reason === "COMPLIANCE_NOT_EVALUATED"
  ) {
    return "indeterminate";
  }
  return "managed_degraded";
}
