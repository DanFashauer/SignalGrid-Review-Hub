// Types for the read-only SSE-EGRESS (mandated edge path) dimension.
//
// `network-nac` grades ADMISSION — 802.1X, the segment, the switch port — and
// deliberately stops at the point of connection. `edr-threat` grades the
// ENDPOINT protection agent. Neither asks the question the Security Service
// Edge category exists to answer: **is this device's internet/SaaS traffic
// actually traversing the deployment's mandated edge (SWG/CASB/ZTNA tunnel),
// or is the client bypassed, disabled, or never installed while every console
// still reads "protected"?**
//
// That last state is this repository's defect class on the egress plane: a
// frontline device browsing raw — SSE client toggled off, a stale bypass, an
// image that never got the client — looks identical to a protected one from
// the workflow's side. The SSE's own device API (Zscaler Client Connector
// device status, Netskope client inventory, GlobalProtect — the reference
// shapes) already knows the difference; nothing carried it into the fabric.
//
// GRADED ONLY WHEN POSED: the caller states whether this deployment MANDATES
// the edge for this device. Unposed (or explicitly not mandated) the dimension
// is `unassessed` and forecloses nothing — an air-gapped line terminal, a
// phone-free zone, or a BYOD device outside the mandate is never nagged.
//
// TWO HONESTY RULES:
//  1. A "tunneled" claim is corroborated, never believed: the edge must
//     AFFIRMATIVELY report that it is observing this device's traffic. A
//     tunnel the edge cannot see is not a tunnel; a client label contradicted
//     by the service never grants.
//  2. This connector reads the SSE's evaluated state. It routes no traffic,
//     toggles no client, changes no bypass rule — those stay with the SSE.

/** What the SSE reports about its client on this device — a trusted allowlist
 *  (the SSE is the source of truth for its own client's state).
 *  `bypassed` = client present but traffic deliberately not traversing (a
 *  trusted-network bypass rule, a user toggle the policy allows, a captive-
 *  portal fallback); `disabled` = protection affirmatively OFF;
 *  `not_installed` = the client was never deployed to this device. */
export type SseClientState = "tunneled" | "bypassed" | "disabled" | "not_installed" | "unknown";

/** Raw SSE-bridge report about one device (loosely typed — any slot may carry
 *  anything). */
export interface SseEgressReportRaw {
  client_state?: unknown; // tunneled | bypassed | disabled | not_installed | unknown
  /** Is the edge CURRENTLY observing this device's traffic? The corroboration
   *  a "tunneled" claim requires. */
  service_observing_traffic?: unknown;
  /** Was the SSE bridge reachable to evaluate this device? */
  bridge_reachable?: unknown;
  source_system?: unknown;
  [k: string]: unknown;
}

/** The exact top-level keys this connector understands. */
export const SSE_EGRESS_REPORT_KEYS = ["client_state", "service_observing_traffic", "bridge_reachable", "source_system"] as const;

/** `malformed` = the report asserted something unreadable: an unrecognized key,
 *  a non-boolean in a boolean slot, a non-object report, or a read that threw.
 *  The evaluator never grades PROTECTED on a malformed report. */
export type SseReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral egress posture — one shape the fabric reads. */
export interface NormalizedSseEgress {
  sourceSystem: "sse-egress";
  deviceId: string;
  clientState: SseClientState;
  serviceObservingTraffic: boolean | null;
  bridgeReachable: boolean | null;
  bridgeSource: string | null;
  reportIntegrity: SseReportIntegrity;
  source: string;
}

export type SseEgressPosture =
  | "egress_protected"
  | "egress_bypassed"
  | "egress_disabled"
  | "egress_unprovisioned"
  | "unassessed"
  | "unverified"
  | "unknown";

export type SseEgressReasonCode =
  | "EGRESS_PROTECTED"
  | "EGRESS_BYPASSED"
  | "EGRESS_DISABLED"
  | "EGRESS_NOT_INSTALLED"
  | "TUNNEL_UNCORROBORATED"
  | "EGRESS_STATE_UNKNOWN"
  | "EGRESS_UNPOSED"
  | "BRIDGE_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type SseEgressAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface SseEgressVerdict {
  posture: SseEgressPosture;
  reasonCode: SseEgressReasonCode;
  recommendedAction: SseEgressAction;
  /** Affirmative defects (protection off, never provisioned, a contradicted
   *  tunnel claim). */
  criticalFindings: string[];
  /** Egress facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True ONLY when the mandate is posed, the report is clean, the bridge
   *  answered affirmatively, the client reports tunneled, AND the edge
   *  affirmatively observes this device's traffic. */
  egressProtected: boolean;
  deviceId: string;
}

export type SseEgressConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class SseEgressConnectorError extends Error {
  readonly code: SseEgressConnectorErrorCode;
  readonly status: number;
  constructor(code: SseEgressConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "SseEgressConnectorError";
    this.code = code;
    this.status = status;
  }
}
