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
/** Whether the device has a cellular backchannel AT ALL — a hardware/provisioning
 *  fact, distinct from whether it is reachable right now. `present` and `absent`
 *  are both POSITIVE statements from the device-inventory plane; `unknown` means
 *  nobody said, which a carrier read alone can never resolve. */
export type CellularBackchannel = "present" | "absent" | "unknown";
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
  /** Does this device HAVE a cellular backchannel at all?
   *
   *  POSED from the device-inventory plane, never derived from carrier silence —
   *  see the long note on `normalizeSession`. `absent` is a positive statement
   *  that the hardware has no modem (or no provisioned profile of any kind);
   *  `unknown` is the honest default, and it is what a device on a PRIVATE 5G
   *  network reads as, because no public carrier API can see one. */
  cellularBackchannel: CellularBackchannel;
}

// ── Pure evaluator output ──────────────────────────────────────────────────────

export type ReachabilityPosture =
  | "reachable"
  | "degraded"
  | "unreachable"
  | "no_cellular_backchannel"
  /** The device-inventory plane never said whether a radio exists, and the carrier
   *  read could not resolve it either. A COVERAGE state, not a claim about the
   *  device — a private-5G attachment reads exactly like this. */
  | "backchannel_unverified"
  | "unknown";

export type ReachabilityReasonCode =
  | "CELLULAR_ONLINE"
  | "CELLULAR_ONLINE_ROAMING"
  | "CELLULAR_IDLE_SMS_OK"
  | "OFFLINE_SMS_ONLY"
  | "FULLY_UNREACHABLE"
  | "NO_CELLULAR_BACKCHANNEL"
  | "BACKCHANNEL_UNPOSED"
  | "PROVISIONING_SUSPENDED"
  | "STALE_LAST_SEEN"
  | "LAST_SEEN_UNVERIFIED"
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
