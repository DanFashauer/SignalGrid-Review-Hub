import type { NormalizedVulnFinding, VulnSeverity, VulnVerdict } from "./types";

/**
 * Pure, deterministic vulnerability-posture evaluator. Aggregates a device's
 * findings into one risk posture + the action it warrants — fail-safe, so the
 * WORST finding drives the verdict and an unscanned device is never mistaken for
 * a clean one. No clock, no randomness.
 *
 * `scanned=false` means "we have no scan data for this device" → posture unknown
 * (attention), which is different from `scanned=true` with zero findings → clean.
 */

const SEVERITY_RANK: Record<VulnSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  unknown: 0,
};

export interface EvaluateVulnOptions {
  /** False when the device has no scan record at all. Default true. */
  scanned?: boolean;
}

export function evaluateVulnPosture(
  findings: readonly NormalizedVulnFinding[],
  options: EvaluateVulnOptions = {},
): VulnVerdict {
  // DERIVED, not assumed. A non-empty finding set is itself evidence that a scan
  // ran — nobody produces CVEs for a device they never looked at — so that case
  // needs no flag. An EMPTY set is the genuinely ambiguous one (scanned and clean
  // vs never scanned at all), and there the caller has to say which.
  //
  // Defaulting the ambiguous case to `true` was the last place in this package
  // where absence resolved optimistically: `evaluateVulnPosture([], {})` returned
  // clean / NO_FINDINGS / action `none`, so a caller who got `[]` from an errored
  // request or a device with no scan record reported it as a clean device. Every
  // sibling dimension derives its caution from the data; a safety property that
  // depends on the caller remembering an out-of-band flag is not a safety property.
  const scanned = options.scanned ?? findings.length > 0;
  const findingCount = findings.length;
  const exploitableCount = findings.filter((f) => f.exploitAvailable).length;
  const highestSeverity = findings.reduce<VulnSeverity>(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    "unknown",
  );

  if (!scanned) {
    return verdict("unknown", "NOT_SCANNED", "monitor", highestSeverity, findingCount, exploitableCount);
  }
  if (findingCount === 0) {
    return verdict("clean", "NO_FINDINGS", "none", "info", 0, 0);
  }

  // Critical, or a high with a known exploit, is a critical exposure: restrict.
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasExploitableHigh = findings.some((f) => f.severity === "high" && f.exploitAvailable);
  if (hasCritical || hasExploitableHigh) {
    return verdict("critical_exposure", "CRITICAL_OR_EXPLOITABLE", "restrict", highestSeverity, findingCount, exploitableCount);
  }
  if (findings.some((f) => f.severity === "high")) {
    return verdict("at_risk", "HIGH_SEVERITY_PRESENT", "patch", highestSeverity, findingCount, exploitableCount);
  }
  // A finding whose severity could NOT be read is not a low finding (wedge #14,
  // caught by the shift-1 sweep; ordering corrected by Codex review on #221):
  // "low_risk" used to be asserted over evidence that says nothing about
  // severity — a critical CVE whose severity failed to parse read as low. The
  // first version of this guard also sat BELOW the medium branch, so a
  // co-present medium finding re-made the exact unsupported low-risk claim.
  // Checked here, before any calm posture can be claimed; the action is the
  // strongest among the REPORTED remainder (patch when a medium is present,
  // else monitor) — an unreadable severity forecloses calm claims but never
  // invents an escalation beyond what was observed. Reported high/critical
  // (above) still win outright: their postures are alarms, not calm claims.
  if (findings.some((f) => f.severity === "unknown")) {
    const action = findings.some((f) => f.severity === "medium") ? "patch" : "monitor";
    return verdict("unknown", "SEVERITY_UNVERIFIED", action, highestSeverity, findingCount, exploitableCount);
  }
  if (findings.some((f) => f.severity === "medium")) {
    return verdict("low_risk", "MEDIUM_SEVERITY_PRESENT", "patch", highestSeverity, findingCount, exploitableCount);
  }
  // Only low/info severities remain.
  return verdict("low_risk", "LOW_SEVERITY_ONLY", "monitor", highestSeverity, findingCount, exploitableCount);
}

function verdict(
  posture: VulnVerdict["posture"],
  reasonCode: VulnVerdict["reasonCode"],
  recommendedAction: VulnVerdict["recommendedAction"],
  highestSeverity: VulnSeverity,
  findingCount: number,
  exploitableCount: number,
): VulnVerdict {
  return { posture, highestSeverity, findingCount, exploitableCount, reasonCode, recommendedAction };
}
