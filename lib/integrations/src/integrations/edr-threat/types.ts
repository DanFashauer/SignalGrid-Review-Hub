// Types for the read-only EDR/EPP endpoint threat-state dimension.
//
// This is distinct from the vulnerability dimension. Vuln-scan asks "what known
// CVEs does this device carry?"; this asks "is this endpoint actually protected,
// and is anything live on it RIGHT NOW?" — two questions a shared clinical
// device must both pass before it touches a workflow. It normalizes agent health
// + active threat detections from an EDR/EPP (Microsoft Defender for Endpoint,
// CrowdStrike Falcon, SentinelOne, Jamf Protect, Sophos Intercept X, VMware
// Carbon Black) into one vocabulary and aggregates them into a per-device threat
// posture. Fail-safe by construction: a disabled/absent agent is a blind spot
// (never "clean"), and an active/unremediated threat drives the verdict.

export type ThreatSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

/** Remediation state of a single detection, vendor-normalized. */
export type ThreatRemediationState =
  | "quarantined"
  | "removed"
  | "blocked"
  | "active"
  | "allowed"
  | "unknown";

/** Raw per-detection record (a read-only, vendor-neutral subset). */
export interface ThreatDetectionRaw {
  threatId?: string;
  name?: string;
  severity?: string;
  remediationState?: string;
  category?: string;
  detectedAt?: string;
}

/** Raw per-endpoint record: agent health + its detections. */
export interface EndpointThreatRaw {
  deviceId: string;
  agentInstalled?: boolean;
  agentRunning?: boolean;
  /** Real-time / on-access protection enabled. */
  realtimeProtection?: boolean;
  /** Age of the signature/definition set in hours (staleness signal). */
  signatureAgeHours?: number;
  lastSeen?: string;
  threats?: ThreatDetectionRaw[];
  source?: string;
}

export interface ThreatCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedThreatDetection {
  threatId: string | null;
  name: string | null;
  severity: ThreatSeverity;
  remediationState: ThreatRemediationState;
  category: string | null;
  detectedAt: string | null;
  /** True when NOT neutralized: active, allowed-to-run, or an unproven state. */
  active: boolean;
}

export interface NormalizedEndpointThreat {
  sourceSystem: "edr-epp";
  deviceId: string;
  agentInstalled: boolean;
  agentRunning: boolean;
  realtimeProtection: boolean;
  signatureAgeHours: number | null;
  lastSeen: string | null;
  /**
   * `null` when the source did not report a detection feed at all — distinct from
   * `[]`, which means it reported and found nothing. The same distinction this
   * package already draws for scalars (`signatureAgeHours: number | null`,
   * `keyAttested: boolean | null`, rtls-custody's `present: boolean | null`),
   * extended to the collection.
   *
   * It is not academic. `proof:live-edr` measured that Wazuh's alerts live in a
   * separate indexer, so "reports agent health, cannot report detections" is the
   * real shape of a live EDR. Flattened to `[]` it was indistinguishable from a
   * clean scan and graded `protected` / action `none`.
   */
  threats: NormalizedThreatDetection[] | null;
  source: string;
}

export type ThreatPosture =
  | "protected"
  | "monitored"
  | "degraded_protection"
  | "unprotected"
  | "active_threat"
  | "critical_compromise"
  | "unknown";

export type ThreatReasonCode =
  | "NO_THREATS_HEALTHY"
  | "THREAT_FEED_UNOBSERVED"
  | "NOT_REPORTING"
  | "THREATS_REMEDIATED"
  | "PROTECTION_DEGRADED"
  | "AGENT_ABSENT"
  | "ACTIVE_THREAT"
  | "CRITICAL_ACTIVE_THREAT";

/** All members are on the unified action ladder used by posture-composition. */
export type ThreatAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface ThreatVerdict {
  posture: ThreatPosture;
  highestThreatSeverity: ThreatSeverity;
  threatCount: number;
  activeThreatCount: number;
  protectionHealthy: boolean;
  reasonCode: ThreatReasonCode;
  recommendedAction: ThreatAction;
}

export type EdrConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class EdrConnectorError extends Error {
  readonly code: EdrConnectorErrorCode;
  readonly status: number;
  constructor(code: EdrConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "EdrConnectorError";
    this.code = code;
    this.status = status;
  }
}
