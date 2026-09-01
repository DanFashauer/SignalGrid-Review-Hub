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

/**
 * Which network segments this device is expected on. CALLER-SUPPLIED POLICY.
 *
 * WHY THIS IS A PARAMETER AND NOT A TAXONOMY. VLAN names and numbering are a local
 * design decision — one site's "VLAN 10 / users" is another's "corp-wired" — so a
 * built-in classification would be a guess applied to every tenant. The operator
 * declares what is expected; the evaluator only compares. Same discipline as
 * `staleFixSeconds` in rtls-custody and the entitlement nesting budget: the caller owns
 * policy, the evaluator owns the comparison.
 *
 * Comparison is trimmed and case-insensitive, because vendors report the same VLAN as
 * "VLAN10", "vlan10" and "  VLAN10 " across NAC, RADIUS and switch inventories.
 */
export interface SegmentPolicy {
  /** Segments this device may legitimately be on. Empty = no policy expressed, and
   *  the segment is then NOT graded — see AUTHENTICATED_SEGMENT_UNVERIFIED. */
  readonly expected: readonly string[];
  /** Segments that are high-consequence to land on unexpectedly — a management,
   *  security or OT VLAN. Reaching one of these while not expected there is lateral
   *  movement into the control plane, which is a different severity from merely
   *  being on the wrong user VLAN. */
  readonly restricted?: readonly string[];
}

export type NetworkPosture =
  /** Authenticated, fresh, AND confirmed on an expected segment. */
  | "on_trusted_segment"
  /** Authenticated and fresh, but no segment policy was supplied, so the segment
   *  was not checked. Deliberately distinct from `on_trusted_segment`: the old code
   *  emitted "trusted" for any authenticated device on ANY VLAN, which asserted a
   *  property nothing had verified. */
  | "on_unverified_segment"
  /** Authenticated, but on a segment the operator did not expect. */
  | "on_unexpected_segment"
  | "unauthenticated"
  | "quarantined"
  | "network_unknown";
export type NetworkReasonCode =
  | "AUTHENTICATED_TRUSTED_SEGMENT"
  /** Authenticated and fresh, segment NOT evaluated because no policy was supplied.
   *  Grants — an operator who has expressed no segment policy has not asked for the
   *  check — but says plainly that trust was not established, rather than claiming it. */
  | "AUTHENTICATED_SEGMENT_UNVERIFIED"
  /** Authenticated and the segment cleared (or was ungraded), but the session-plane
   *  claims behind the grant were NOT reported: `nacCompliant` null and/or auth
   *  freshness unknown. Grades `monitor`, not `none` — an unreported posture must
   *  never produce the same verdict as a verified-good one. It also does not
   *  step_up: per docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md these two fields are not
   *  authentication facts and never arrive with a plain RADIUS auth result, so a
   *  challenge here would fire on every decision of every posture-less deployment
   *  forever — the always-on failure mode this repo has been bitten by twice. */
  | "AUTHENTICATED_POSTURE_UNVERIFIED"
  /** On a segment outside the expected set. */
  | "SEGMENT_UNEXPECTED"
  /** On a segment the operator marked high-consequence (management / security / OT)
   *  while not expected there. */
  | "SEGMENT_RESTRICTED"
  /** A policy exists but the source did not report which segment the device is on,
   *  so the policy cannot be applied. Forecloses rather than assuming compliance. */
  | "SEGMENT_UNREPORTED_UNDER_POLICY"
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

export type NetworkConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

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
