// Types for the read-only OT / IIoT edge-device posture dimension.
//
// The factory floor is the purest case for the grid_collected pattern: a PLC,
// RTU, HMI, or brownfield machine cannot run an agent, exposes no vendor API, and
// speaks Modbus / OPC-UA / DNP3. So SignalGrid reads what an EDGE GATEWAY can see
// about the device — read-only — and turns it into one fail-safe posture the
// fabric fuses. Where even the gateway can't see it, that is a gap, never a green.
//
// Fail-safe by construction: an unpatchable / end-of-life device, an OT device on
// a FLAT network (reachable from IT — a Purdue-model violation), or an
// unauthenticated industrial protocol reachable beyond the cell all RESTRICT; a
// stale gateway (we're blind) or any unreadable control STEPS UP; nothing unknown
// ever reads as secure.
//
// SignalGrid changes no device setting — every signal is read-only. It consumes
// the posture and gates the action (a firmware push, an HMI login, a line command).

/** Firmware currency. `eol` = end-of-life / no patch will ever exist. */
export type OtFirmware = "current" | "outdated" | "eol" | "unknown";
/** Where the device sits. `flat` = same L2/L3 as IT (should be segmented). */
export type OtSegmentation = "segmented" | "flat" | "unknown";
/** Whether the edge gateway's reading is fresh. `stale` = we are effectively blind. */
export type OtGatewayLiveness = "live" | "stale" | "unknown";

/** Raw edge-gateway report about one OT device (loosely typed — any field may
 *  degrade to null / an error string). */
export interface OtDeviceReportRaw {
  deviceType?: unknown; // plc | rtu | hmi | sensor | gateway | ...
  vendor?: unknown;
  firmware?: { status?: unknown; patchable?: boolean | null; [k: string]: unknown };
  network?: { segmentation?: unknown; insecure_protocol_exposed?: boolean | null; protocols?: unknown; [k: string]: unknown };
  gateway?: { liveness?: unknown; last_seen?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

/** The normalized, vendor-neutral OT posture — one shape the fabric reads. */
export interface NormalizedOtPosture {
  sourceSystem: "ot-posture";
  deviceId: string;
  deviceType: string | null;
  firmware: OtFirmware;
  /** false = brownfield/legacy that can never be patched. null = unknown. */
  patchable: boolean | null;
  segmentation: OtSegmentation;
  /** An unauthenticated/plaintext industrial protocol reachable beyond the cell.
   *  null = unknown (fail-safe: raises the bar, never assumed safe). */
  insecureProtocolExposed: boolean | null;
  gatewayLiveness: OtGatewayLiveness;
  source: string;
}

export type OtPosture =
  | "secure"
  | "outdated"
  | "unpatchable"
  | "exposed"
  | "unsegmented"
  | "blind"
  | "unverified"
  | "unknown";

export type OtReasonCode =
  | "FULLY_SECURE"
  | "FIRMWARE_OUTDATED"
  | "FIRMWARE_EOL"
  | "FIRMWARE_UNPATCHABLE"
  | "INSECURE_PROTOCOL_EXPOSED"
  | "FLAT_NETWORK"
  | "GATEWAY_STALE"
  | "OT_STATE_UNKNOWN"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type OtRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface OtPostureVerdict {
  posture: OtPosture;
  reasonCode: OtReasonCode;
  recommendedAction: OtRecommendedAction;
  /** Concerns at restrict level (exposed / unsegmented / unpatchable). */
  criticalFindings: string[];
  /** Signals whose state could NOT be determined (raise assurance, fail-safe). */
  unknownSignals: string[];
  deviceType: string | null;
}

export type OtConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class OtConnectorError extends Error {
  readonly code: OtConnectorErrorCode;
  readonly status: number;
  constructor(code: OtConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "OtConnectorError";
    this.code = code;
    this.status = status;
  }
}
