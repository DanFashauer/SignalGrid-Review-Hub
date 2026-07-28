// Types for the read-only custody-BEACON (asset-recovery) dimension.
//
// Every other location/custody dimension in this fabric is ONLINE and
// INFRASTRUCTURE-DEPENDENT — RTLS needs deployed anchors and a broadcasting device,
// location-services needs the device powered and reporting a geofence, reachability
// needs the device on a network, dock-state needs it seated in a bay. They all go
// blind at the SAME moment: the instant a device is powered off, battery-dead,
// network-detached, or walked out the door — which is exactly the theft/loss case.
//
// Native recovery does not cover shared enterprise fleets here. Consumer Find My needs
// a personal Apple ID (shared, supervised, ABM-enrolled devices do not have one); the
// supervised-device equivalent (MDM Lost Mode / Activation Lock) needs the device
// POWERED and reaching APNs — a thief just powers it off or pulls the SIM and it goes
// dark. That is a structural blind spot.
//
// This dimension consumes an INDEPENDENT recovery beacon — a case-embedded, weeks-long,
// infrastructure-free tag (a Find My-network accessory, or a dedicated cellular/LoRaWAN
// asset tracker) that survives the phone being off and reports a coarse last-seen zone
// through its own finding network. It is physically separable from the device it
// protects. This is RECOVERY, not live surveillance: the reading is coarse and lagging.
//
// The DECISION value is the FUSION. A dot on a map is commodity asset-tracking. The
// beacon is the out-of-band channel that breaks the tie when every online signal has
// gone dark together: unreachable + beacon-in-zone is benign (powered off in its bay);
// unreachable + beacon-off-premises is high-confidence removal. No other dimension can
// make that distinction, because they all go blind with the device.
//
// It normalizes an already-resolved beacon reading + the device's reachability. It takes
// no action of its own; it reports a posture the fabric fuses fail-closed.

/** The recovery beacon's coarse zone verdict, relative to the device's custody
 *  boundary (facility/ward/depot geofence the beacon network resolves against).
 *  `departing` = moving away from the zone but not yet clear of it. */
export type BeaconZone = "in_custody_zone" | "departing" | "off_premises" | "unknown";

/** How RECENT the beacon's last sighting is. A recovery beacon reports intermittently
 *  through a crowd/independent network, so an in-zone reading is only trustworthy if it
 *  is fresh; a stale reading cannot confirm CURRENT location. Lagging by design. */
export type BeaconFreshness = "fresh" | "stale" | "expired" | "unknown";

/** The out-of-band tie-breaker: is the DEVICE itself responding on the network right
 *  now? This is the independent axis the beacon fuses with — the whole point is that the
 *  beacon still reports when the device does not. */
export type DeviceReachability = "reachable" | "unreachable" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw beacon reading about one device (loosely typed — a beacon network / tracker is an
 *  EXTERNAL system and may emit `"true"`, `1`, `["off_premises"]`, or `"ERR: timeout"`
 *  in any slot). The normalizer, not the compiler, is what makes a value safe. */
export interface CustodyBeaconReportRaw {
  zone?: unknown; // in_custody_zone | departing | off_premises | unknown
  freshness?: unknown; // fresh | stale | expired | unknown
  reachability?: unknown; // reachable | unreachable | unknown
  [k: string]: unknown;
}

export const CUSTODY_BEACON_REPORT_KEYS = ["zone", "freshness", "reachability"] as const;

export interface NormalizedCustodyBeacon {
  sourceSystem: "custody-beacon";
  deviceRef: string;
  zone: BeaconZone;
  freshness: BeaconFreshness;
  reachability: DeviceReachability;
  reportIntegrity: ReportIntegrity;
  source: string;
}

/** The posture this dimension can report. */
export type CustodyBeaconPosture =
  | "in_custody_confirmed" // in zone, reachable, fresh — the grant
  | "in_zone_offline" // in zone but the device is dark — benign (powered off in its bay)
  | "in_zone_stale" // in zone + reachable but the beacon reading is not current
  | "departing"
  | "off_premises"
  | "off_premises_dark" // off premises AND the device is dark — highest-confidence removal
  | "location_unknown"
  | "unverified"; // malformed / unreadable

export type CustodyBeaconAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type CustodyBeaconReasonCode =
  | "CUSTODY_CONFIRMED"
  | "IN_ZONE_OFFLINE_BENIGN"
  | "IN_ZONE_STALE"
  | "DEPARTING"
  | "DEPARTING_DARK"
  | "OFF_PREMISES"
  | "OFF_PREMISES_DARK"
  | "LOCATION_UNKNOWN"
  | "LOCATION_UNKNOWN_DARK"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface CustodyBeaconVerdict {
  deviceRef: string;
  posture: CustodyBeaconPosture;
  reasonCode: CustodyBeaconReasonCode;
  recommendedAction: CustodyBeaconAction;
  /** Affirmative recovery concerns (device off-premises / departing / dark). */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when custody is positively confirmed: in zone, reachable, fresh, clean. */
  custodyConfirmed: boolean;
  /** True when the fused reading indicates the device has likely been REMOVED — the
   *  case an online-only fabric cannot see. Drives lost-mode/wipe recommendation. */
  removalSuspected: boolean;
}

export class CustodyBeaconConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CustodyBeaconConnectorError";
  }
}
