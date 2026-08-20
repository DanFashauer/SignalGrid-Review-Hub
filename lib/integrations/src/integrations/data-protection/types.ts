// Types for the read-only data-protection / DLP posture dimension.
//
// The peripheral-control dimension covers the HARDWARE exfil surface (attached
// removable media). This one covers the DATA exfil surface across ALL channels —
// a sensitive file leaving via cloud upload, personal email, web post, print, or
// clipboard is a data-loss event regardless of hardware. It normalizes a DLP /
// data-protection platform (Microsoft Purview DLP, Forcepoint, Symantec/Broadcom
// DLP, Zscaler, Netskope) into one vocabulary and turns per-device violation +
// policy state into a data-protection posture. Fail-safe by construction: a
// violation we can't confirm was blocked is treated as data that may have left,
// unenforced DLP policy is a gap, and a device with no DLP coverage is a blind
// spot (never "protected").

/** Channel a data-egress attempt used. */
export type DlpChannel =
  | "usb"
  | "cloud"
  | "email"
  | "web"
  | "print"
  | "clipboard"
  | "network_share"
  | "unknown";

/** What the DLP control did about the attempt. */
export type DlpAction = "blocked" | "audited" | "allowed" | "overridden" | "unknown";

export type DlpSeverity = "critical" | "high" | "medium" | "low" | "unknown";

/** Classification of the data involved (regulated data raises the stakes). */
export type DataClass = "phi" | "pii" | "pci" | "confidential" | "internal" | "unclassified" | "unknown";

/** Raw per-violation record (a read-only, vendor-neutral subset). */
export interface DlpViolationRaw {
  violationId?: string;
  channel?: string;
  action?: string;
  severity?: string;
  dataClass?: string;
  detectedAt?: string;
}

/** Raw per-device record: DLP policy state + recent violations. */
export interface DataProtectionRaw {
  deviceId: string;
  /** Whether a DLP policy is applied/enforced on the device. */
  dlpPolicyEnforced?: boolean;
  violations?: DlpViolationRaw[];
  source?: string;
}

export interface DlpCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedDlpViolation {
  violationId: string | null;
  channel: DlpChannel;
  action: DlpAction;
  severity: DlpSeverity;
  dataClass: DataClass;
  detectedAt: string | null;
  /** True when the data was NOT provably contained (allowed/overridden, or an unproven state). */
  egressed: boolean;
  /** True when the data class is regulated (PHI/PII/PCI). */
  regulated: boolean;
}

export interface NormalizedDataProtection {
  sourceSystem: "data-protection";
  deviceId: string;
  dlpPolicyEnforced: boolean | null;
  /**
   * `null` when the source did not report a DLP violation feed at all — distinct from `[]`,
   * which means it reported and found nothing. The same distinction this package
   * already draws for scalars (`null = not reported`), extended to the collection:
   * a feed that was never read must not be gradeable as a clean one.
   */
  violations: NormalizedDlpViolation[] | null;
  source: string;
}

export type DlpPosture =
  | "protected"
  | "monitored"
  | "policy_unenforced"
  | "data_egress"
  | "confirmed_exfiltration"
  | "unknown";

export type DlpReasonCode =
  | "NO_VIOLATIONS"
  | "DLP_FEED_UNOBSERVED"
  | "NOT_COVERED"
  | "VIOLATIONS_CONTAINED"
  | "POLICY_UNENFORCED"
  | "POLICY_ENFORCEMENT_UNVERIFIED"
  | "DATA_EGRESS"
  | "REGULATED_DATA_EGRESS";

/** All members are on the unified action ladder used by posture-composition. */
export type DlpRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface DlpVerdict {
  posture: DlpPosture;
  violationCount: number;
  egressCount: number;
  highestSeverity: DlpSeverity;
  dlpPolicyEnforced: boolean | null;
  reasonCode: DlpReasonCode;
  recommendedAction: DlpRecommendedAction;
}

export type DlpConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class DlpConnectorError extends Error {
  readonly code: DlpConnectorErrorCode;
  readonly status: number;
  constructor(code: DlpConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "DlpConnectorError";
    this.code = code;
    this.status = status;
  }
}
