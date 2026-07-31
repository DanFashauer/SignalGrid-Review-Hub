// Types for the read-only carrier / IoT-connectivity reachability dimension.
//
// This is SignalGrid's answer to the founder's stated "biggest technical
// constraint": post-exit reachability. Once a shared device leaves managed Wi-Fi
// coverage, MDM commands ("find it / ring it / lock it now") become opportunistic
// rather than guaranteed. A carrier/IoT-connectivity backchannel (native
// LTE/5G/eSIM, or an external module in the case/dock) restores an out-of-band
// way to know whether a device is still reachable — and how to reach it — without
// depending on the MDM path that just went dark.
//
// The connector is READ-ONLY (it only reads session/last-seen state), vendor-
// neutral (shaped to fit Verizon ThingSpace, Cisco IoT Control Center / Jasper,
// Twilio Super SIM), and gated exactly like every other live integration.

/** Raw per-SIM connectivity fields we read (a read-only, vendor-neutral subset). */
export interface CarrierSessionRaw {
  deviceId: string;
  iccid?: string;
  imei?: string;
  /** Data-session state as the carrier reports it. */
  sessionState?: string;
  /** Whether a data session is currently established. */
  dataConnected?: boolean;
  /** Whether the SIM can receive an SMS (an out-of-band wake channel). */
  smsCapable?: boolean;
  /** Last time the carrier saw the device on the network. */
  lastConnectedAt?: string | null;
  roaming?: boolean;
  ratType?: string;
  /** Billing/provisioning lifecycle state. */
  billingState?: string;
}

/** A carrier collection response (`{ value: [...], nextPageToken?: "..." }`). */
export interface CarrierCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export type CellularReachability = "online" | "idle" | "offline" | "unknown";
export type ProvisioningState = "active" | "suspended" | "deactivated" | "unknown";
export type Freshness = "fresh" | "stale" | "unknown";

/**
 * The normalized reachability signal the connector emits — a vendor-neutral shape
 * the pure evaluator turns into a posture. Carries provenance for evidence.
 */
export interface ReachabilitySignal {
  sourceSystem: "carrier";
  correlationId: string;
  observedAt: string;
  deviceId: string;
  cellularReachability: CellularReachability;
  smsReachable: boolean;
  lastSeenAt: string | null;
  freshness: Freshness;
  roaming: boolean;
  provisioning: ProvisioningState;
  /** True when the device has NO cellular backchannel at all (Wi-Fi-only). */
  wifiOnly: boolean;
}

// ── Pure evaluator output ──────────────────────────────────────────────────────

export type ReachabilityPosture =
  | "reachable"
  | "degraded"
  | "unreachable"
  | "wifi_only_blindspot"
  | "unknown";

export type ReachabilityReasonCode =
  | "CELLULAR_ONLINE"
  | "CELLULAR_ONLINE_ROAMING"
  | "CELLULAR_IDLE_SMS_OK"
  | "OFFLINE_SMS_ONLY"
  | "FULLY_UNREACHABLE"
  | "WIFI_ONLY_NO_CELLULAR"
  | "PROVISIONING_SUSPENDED"
  | "STALE_LAST_SEEN"
  | "REACHABILITY_UNKNOWN";

/** The self-managing playbook action the posture recommends — never a raw alert storm. */
export type RecommendedAction = "none" | "monitor" | "locate" | "alert" | "escalate";

export interface ReachabilityVerdict {
  posture: ReachabilityPosture;
  reasonCode: ReachabilityReasonCode;
  recommendedAction: RecommendedAction;
  /** Whether an out-of-band locate/ring is possible right now (data OR SMS wake). */
  locatable: boolean;
}

export type CarrierConnectorErrorCode =
  | "incomplete_read"
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class CarrierConnectorError extends Error {
  readonly code: CarrierConnectorErrorCode;
  readonly status: number;
  constructor(code: CarrierConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "CarrierConnectorError";
    this.code = code;
    this.status = status;
  }
}
