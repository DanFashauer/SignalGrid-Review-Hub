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
  const scanned = options.scanned ?? true;
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
  if (findings.some((f) => f.severity === "medium")) {
    return verdict("low_risk", "MEDIUM_SEVERITY_PRESENT", "patch", highestSeverity, findingCount, exploitableCount);
  }
  // Only low/info/unknown severities remain.
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
