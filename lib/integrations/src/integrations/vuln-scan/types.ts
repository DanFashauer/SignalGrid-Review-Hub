// Types for the read-only vulnerability-scanning dimension.
//
// Device vulnerability posture is the signal that ties the others together: a
// shared clinical device carrying a critical, exploitable CVE should be
// restricted or stepped-up BEFORE it touches a workflow — regardless of whether
// it is otherwise compliant and reachable. This normalizes findings from a
// scanner/EDR (Microsoft Defender, Qualys, Tenable, Jamf Protect, CrowdStrike)
// into one vocabulary and aggregates them into a per-device risk posture.

export type VulnSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

/** Raw per-device finding (a read-only, vendor-neutral subset). */
export interface VulnFindingRaw {
  deviceId: string;
  cveId?: string;
  title?: string;
  severity?: string;
  cvssScore?: number;
  component?: string;
  fixedVersion?: string;
  detectedAt?: string;
  /** Whether a known exploit exists in the wild (CISA KEV-style). */
  exploitAvailable?: boolean;
  source?: string;
}

export interface VulnCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedVulnFinding {
  sourceSystem: "vuln-scan";
  deviceId: string;
  cveId: string | null;
  severity: VulnSeverity;
  cvssScore: number | null;
  exploitAvailable: boolean;
  component: string | null;
  fixedVersion: string | null;
  detectedAt: string | null;
  source: string;
}

export type VulnPosture = "clean" | "low_risk" | "at_risk" | "critical_exposure" | "unknown";
export type VulnReasonCode =
  | "NO_FINDINGS"
  | "NOT_SCANNED"
  | "LOW_SEVERITY_ONLY"
  | "SEVERITY_UNVERIFIED"
  | "MEDIUM_SEVERITY_PRESENT"
  | "HIGH_SEVERITY_PRESENT"
  | "CRITICAL_OR_EXPLOITABLE";
export type VulnAction = "none" | "monitor" | "patch" | "restrict" | "escalate";

export interface VulnVerdict {
  posture: VulnPosture;
  highestSeverity: VulnSeverity;
  findingCount: number;
  exploitableCount: number;
  reasonCode: VulnReasonCode;
  recommendedAction: VulnAction;
}

export type VulnConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class VulnConnectorError extends Error {
  readonly code: VulnConnectorErrorCode;
  readonly status: number;
  constructor(code: VulnConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "VulnConnectorError";
    this.code = code;
    this.status = status;
  }
}
