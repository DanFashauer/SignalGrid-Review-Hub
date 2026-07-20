// Types for the read-only network / NAC (Network Access Control) posture
// dimension. From the Enterprise LAN "Mandatory Features": "Access Security … for
// authenticating users and devices, and for creating and enforcing access
// policies at the point of connection." This is the cyber-plane complement to
// physical custody: is the shared device authenticated at the point of network
// connection, on the segment it should be, or already quarantined? The switch
// port / access point it is attached to is also a COARSE indoor-location signal
// that fuses with location-services + RTLS.
//
// This dimension is READ-ONLY. Network isolation / microsegmentation / 802.1X
// revocation is a separate, explicitly-authorized ENFORCEMENT action (the "act"
// plane), never a side effect of reading posture.

export type NetworkAuthState = "authenticated" | "unauthenticated" | "quarantined" | "unknown";
export type NacFreshness = "fresh" | "stale" | "unknown";

/** Raw per-device network posture (a read-only, vendor-neutral subset). */
export interface NetworkPostureRaw {
  deviceId: string;
  /** 802.1X / NAC authentication state at the point of connection. */
  authState?: string;
  /** The network segment / VLAN the device landed on. */
  segment?: string;
  vlan?: string | number;
  /** Switch port or access point the device is attached to (coarse location). */
  switchPort?: string;
  accessPoint?: string;
  ssid?: string;
  /** Whether the device met the NAC posture policy at connection. */
  nacCompliant?: boolean;
  lastAuthAt?: string | null;
}

export interface NetworkCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedNetworkSignal {
  sourceSystem: "network-nac";
  correlationId: string;
  observedAt: string;
  deviceId: string;
  authState: NetworkAuthState;
  segment: string | null;
  /** Coarse physical hint: the switch port or AP the device is on. */
  accessLocation: string | null;
  nacCompliant: boolean | null;
  lastAuthAt: string | null;
  freshness: NacFreshness;
}

export type NetworkPosture = "on_trusted_segment" | "unauthenticated" | "quarantined" | "network_unknown";
export type NetworkReasonCode =
  | "AUTHENTICATED_TRUSTED_SEGMENT"
  | "UNAUTHENTICATED_AT_CONNECTION"
  | "QUARANTINED_SEGMENT"
  | "NAC_NONCOMPLIANT"
  | "STALE_NETWORK_STATE"
  | "NETWORK_STATE_UNKNOWN";
export type NetworkAction = "none" | "monitor" | "step_up" | "restrict";

export interface NetworkVerdict {
  posture: NetworkPosture;
  reasonCode: NetworkReasonCode;
  recommendedAction: NetworkAction;
  /** Where on the network the device is — carried through for evidence + location fusion. */
  accessLocation: string | null;
}

export type NetworkConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class NetworkConnectorError extends Error {
  readonly code: NetworkConnectorErrorCode;
  readonly status: number;
  constructor(code: NetworkConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "NetworkConnectorError";
    this.code = code;
    this.status = status;
  }
}
