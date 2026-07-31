import {
  type BenchmarkSelectionAction,
  type BenchmarkSelectionPosture,
  type BenchmarkSelectionReasonCode,
  type BenchmarkSelectionVerdict,
  type NormalizedBenchmarkSelection,
} from "./types";

/**
 * Pure, deterministic BENCHMARK-SELECTION evaluator. Grades ONE assessment run —
 * which benchmark document it used, from what content, on what platform, covering
 * how much — fail-closed, on the fabric's unified ladder.
 *
 * Doctrine ("a baseline answer is meaningless without the question that produced it"):
 *  - **platform mismatch** → `restrict`. The tool graded a device the benchmark
 *    document does not target. The macOS-26-scored-against-Monterey case, caught
 *    affirmatively rather than inferred: both platform strings come from the
 *    assessor, and the evaluator compares them.
 *  - **assessment empty** → `restrict`. The counts reconcile and ZERO rules were
 *    evaluated. A perfect score over an empty denominator is the fabric's recurring
 *    defect in its rawest mechanical form.
 *  - **not in the catalog** → `alert`. The tool named a standard the published
 *    catalog does not carry — measurement is broken at operator scale, not for one
 *    device.
 *  - **off requirement** → `alert`, NOT restrict. A real benchmark that is not the
 *    one this work demands is a targeting/citation failure; blocking a correctly
 *    hardened device mid-shift over which document was cited is the wrong trade.
 *    Same class as policy-binding's `mixed_membership`.
 *  - **version superseded / version unlisted** → `step_up`. A real document at a bar
 *    the catalog no longer leads with. Cannot be confirmed current.
 *  - **provenance tool-declared only** → `step_up`. A tool that labels its checks
 *    "CIS" has asserted a name, not a provenance. Inferring compliance from that
 *    label is the thing this axis exists to refuse.
 *  - **provenance independent implementation** → `monitor`. Real work by a named
 *    third-party project (kube-bench, Prowler, ComplianceAsCode, macos_security,
 *    ansible-lockdown, steampipe). Not an accusation — simply not CIS's published
 *    content, and the verdict must not represent it as such.
 *  - **coverage partial** → `monitor`. Errors or skipped rules remain.
 *  - **requirement absent** → `step_up`. Nobody stated a bar for this work, so
 *    "the right test" is unestablished. A hole, not a pass.
 *  - **assessment stale** → `step_up`. The run is older than the operator's stated
 *    age bound. An assessment is a statement about the moment it ran — the
 *    temporal unearned affirmative was a "confirmed" that stayed confirmed
 *    forever, and this rung withdraws it. Same class as version_superseded:
 *    a real answer at a bar that can no longer be confirmed current.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *
 * The grant (`none`) requires EIGHT affirmative clauses: clean parse + covered +
 * a recognized current catalog row + CIS-published content + a matched platform +
 * complete coverage + on requirement + a recency that is `current` or explicitly
 * `unbounded` (the operator's carried choice to state no age bound). Not one
 * clause has the form `!== bad`, so a value this design has never heard of
 * satisfies none of them.
 *
 * `alignment` is deliberately ABSENT from the conjunction. This dimension says the
 * test was the right test; it does not say the device passed. `requirement_matched`
 * alongside `drifted` is the honest and useful pair, and the proof pins it.
 */

const ACTION_SEVERITY: Record<BenchmarkSelectionAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateBenchmarkSelectionOptions {
  /** False when no assessment record was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: BenchmarkSelectionPosture;
  action: BenchmarkSelectionAction;
  reason: BenchmarkSelectionReasonCode;
}

export function evaluateBenchmarkSelection(
  report: NormalizedBenchmarkSelection,
  opts: EvaluateBenchmarkSelectionOptions = {},
): BenchmarkSelectionVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceRef: report.deviceRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "selection_unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["coverage_record"],
      selectionConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.recognition === "unknown") unknownSignals.push("benchmark_citation");
  if (report.provenance === "unknown") unknownSignals.push("provenance");
  if (report.platformMatch === "unknown") unknownSignals.push("platform_match");
  if (report.coverage === "ungraded") unknownSignals.push("assessment_coverage");
  if (report.requirementFit === "unknown") unknownSignals.push("requirement");
  if (report.recency === "unknown") unknownSignals.push("assessment_recency");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── which document, and is it current? ──────────────────────────────────────────
  if (report.recognition === "not_in_catalog") {
    criticalFindings.push("benchmark_not_in_catalog");
    candidates.push({ posture: "benchmark_unlisted", action: "alert", reason: "BENCHMARK_NOT_IN_CATALOG" });
  } else if (report.recognition === "version_superseded") {
    criticalFindings.push("benchmark_version_superseded");
    candidates.push({ posture: "version_superseded", action: "step_up", reason: "BENCHMARK_VERSION_SUPERSEDED" });
  } else if (report.recognition === "version_unlisted") {
    candidates.push({ posture: "version_unlisted", action: "step_up", reason: "BENCHMARK_VERSION_NOT_LISTED" });
  } else if (report.recognition === "unknown") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "BENCHMARK_UNKNOWN" });
  }

  // ── whose content was it? ───────────────────────────────────────────────────────
  if (report.provenance === "independent_implementation") {
    // Fail-OPEN in the reporting sense: real work, but reading it as official CIS
    // content is the misrepresentation this axis refuses.
    criticalFindings.push("provenance_not_cis_published");
    candidates.push({ posture: "provenance_independent", action: "monitor", reason: "PROVENANCE_INDEPENDENT_IMPLEMENTATION" });
  } else if (report.provenance === "tool_declared") {
    criticalFindings.push("provenance_tool_declared_only");
    candidates.push({ posture: "provenance_unattributed", action: "step_up", reason: "PROVENANCE_TOOL_DECLARED_ONLY" });
  } else if (report.provenance === "unknown") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "PROVENANCE_UNKNOWN" });
  }

  // ── did the document target the device the tool actually read? ──────────────────
  if (report.platformMatch === "mismatched") {
    criticalFindings.push("assessor_platform_mismatch");
    candidates.push({ posture: "platform_mismatch", action: "restrict", reason: "ASSESSOR_PLATFORM_MISMATCH" });
  } else if (report.platformMatch === "unknown") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "PLATFORM_MATCH_UNKNOWN" });
  }

  // ── how much of it was actually evaluated? ──────────────────────────────────────
  if (report.coverage === "empty") {
    criticalFindings.push("assessment_evaluated_nothing");
    candidates.push({ posture: "assessment_empty", action: "restrict", reason: "ASSESSMENT_EMPTY" });
  } else if (report.coverage === "partial") {
    candidates.push({ posture: "coverage_partial", action: "monitor", reason: "ASSESSMENT_PARTIAL" });
  } else if (report.coverage === "ungraded") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "COVERAGE_UNGRADED" });
  }

  // ── is the answer still current? ────────────────────────────────────────────────
  if (report.recency === "stale") {
    criticalFindings.push("assessment_stale");
    candidates.push({ posture: "assessment_stale", action: "step_up", reason: "ASSESSMENT_STALE" });
  } else if (report.recency === "unknown") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "ASSESSMENT_RECENCY_UNKNOWN" });
  }

  // ── is it the document this work requires? ──────────────────────────────────────
  if (report.requirementFit === "off_requirement") {
    criticalFindings.push("benchmark_off_requirement");
    candidates.push({ posture: "benchmark_off_requirement", action: "alert", reason: "BENCHMARK_OFF_REQUIREMENT" });
  } else if (report.requirementFit === "unrequired") {
    candidates.push({ posture: "requirement_absent", action: "step_up", reason: "REQUIREMENT_ABSENT" });
  } else if (report.requirementFit === "unknown") {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "REQUIREMENT_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on all seven axes plus the parse. The
  // branches above already push a raising candidate for every non-confirmed state,
  // so today this never fires — but if any branch were later weakened so a
  // non-confirmed state produced an empty candidate list, this backstop forces a
  // step_up rather than letting the seed grant survive.
  const positivelySelected =
    report.reportIntegrity === "clean" &&
    report.recognition === "recognized" &&
    report.provenance === "cis_published" &&
    report.platformMatch === "matched" &&
    report.coverage === "complete" &&
    report.requirementFit === "on_requirement" &&
    (report.recency === "current" || report.recency === "unbounded");
  if (!positivelySelected && candidates.length === 0) {
    candidates.push({ posture: "selection_unverified", action: "step_up", reason: "BENCHMARK_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired.
  const seed: Candidate = {
    posture: "requirement_matched",
    action: "none",
    reason: "GRADED_AGAINST_REQUIRED_BENCHMARK",
  };
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
    selectionConfirmed: winner.action === "none",
  };
}
