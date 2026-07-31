// Types for the read-only RTLS / badge-dwell physical-custody dimension.
//
// This is the PHYSICAL-plane signal that ties the cyber signals back to the
// two-plane custody model: where is the shared device physically (room/zone-
// level, real-time), and is its custody consistent with the badge checkout? It
// normalizes a Real-Time Location System (CenTrak, Stanley/HID AeroScout, Zebra
// MotionWorks, Sonitor, Cisco Spaces) into one vocabulary and turns it into a
// per-device custody posture. Distinct from location-services (GPS/geofence,
// on/off premises) — this is INDOOR, zone-level, and custody-aware. Fail-safe by
// construction: a device that isn't currently detected in the monitored area is a
// custody breach (escalate), a stale/unconfirmable fix means "go locate it", and
// an untracked device is a blind spot (never "in custody").

/** Normalized physical zone category. */
export type ZoneType =
  | "clinical"
  | "storage"
  | "public"
  | "egress"
  | "unauthorized"
  | "unknown";

/** Raw per-device RTLS observation (a read-only, vendor-neutral subset). */
export interface AssetLocationRaw {
  deviceId: string;
  zoneId?: string;
  zoneType?: string;
  /** Whether this zone is authorized for the device's current checkout. */
  zoneAuthorized?: boolean;
  /** Age of the last RTLS fix in seconds (staleness signal). */
  fixAgeSeconds?: number;
  /** Time the device has dwelled in the current zone, in seconds. */
  dwellSeconds?: number;
  /** Whether an authorized badge / active checkout is associated with the device. */
  badgeAssociated?: boolean;
  /** Detected at an egress / exit reader. */
  atEgress?: boolean;
  /** Currently detected somewhere in the monitored area. */
  present?: boolean;
  source?: string;
}

export interface CustodyCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedAssetLocation {
  sourceSystem: "rtls-custody";
  deviceId: string;
  zoneId: string | null;
  zoneType: ZoneType;
  zoneAuthorized: boolean | null;
  fixAgeSeconds: number | null;
  dwellSeconds: number | null;
  badgeAssociated: boolean | null;
  atEgress: boolean;
  /** null when the source did not report presence (distinct from an explicit false). */
  present: boolean | null;
  source: string;
}

export type CustodyPosture =
  | "in_zone"
  | "stale_fix"
  | "zone_unverified"
  | "off_zone"
  | "at_egress"
  | "abandoned"
  | "left_area"
  | "unknown";

export type CustodyReasonCode =
  | "CUSTODY_OK"
  | "NOT_TRACKED"
  | "STALE_FIX"
  | "ZONE_UNVERIFIED"
  | "OFF_ZONE"
  | "AT_EGRESS"
  | "ABANDONED"
  | "LEFT_AREA";

/** All members are on the unified action ladder used by posture-composition. */
export type CustodyAction = "none" | "monitor" | "locate" | "alert" | "escalate";

export interface CustodyVerdict {
  posture: CustodyPosture;
  zoneId: string | null;
  zoneType: ZoneType;
  fixAgeSeconds: number | null;
  dwellSeconds: number | null;
  badgeAssociated: boolean | null;
  reasonCode: CustodyReasonCode;
  recommendedAction: CustodyAction;
}

export type RtlsConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class RtlsConnectorError extends Error {
  readonly code: RtlsConnectorErrorCode;
  readonly status: number;
  constructor(code: RtlsConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "RtlsConnectorError";
    this.code = code;
    this.status = status;
  }
}
