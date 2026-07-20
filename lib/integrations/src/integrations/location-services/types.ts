// Types for the read-only device location-services dimension.
//
// For mobile shared devices, "where is it" is the single highest-value signal —
// it turns a lost-device event from a guessing game into a bounded, actionable
// one. Privacy is a first-class constraint (the founder's notes call for
// minimizing precise-location fields, short retention, and legal review before
// design freeze — GDPR / BIPA / California precise-geolocation rules). So this
// dimension prefers a coarse **geofence membership** (inside/outside an
// authorized premises) over raw coordinates, and flags whenever precise
// coordinates are actually used.

export type LocationSource = "gps" | "wifi" | "cell" | "mdm_lost_mode" | "unknown";
export type GeofenceState = "inside" | "outside" | "unknown";
export type LocationFreshness = "fresh" | "stale" | "unknown";

/** Raw per-device location fix (a read-only, privacy-minimized subset). */
export interface LocationFixRaw {
  deviceId: string;
  capturedAt?: string | null;
  source?: string;
  accuracyMeters?: number;
  /** Platform-computed membership vs an authorized-premises geofence. */
  geofenceState?: string;
  geofenceId?: string;
  /** Precise coordinates — optional and privacy-sensitive; prefer geofenceState. */
  latitude?: number;
  longitude?: number;
}

export interface LocationCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedLocationSignal {
  sourceSystem: "location-services";
  correlationId: string;
  observedAt: string;
  deviceId: string;
  geofenceState: GeofenceState;
  geofenceId: string | null;
  source: LocationSource;
  accuracyMeters: number | null;
  capturedAt: string | null;
  freshness: LocationFreshness;
  /** Privacy flag: true when a precise lat/lon was present (not just a geofence). */
  hasPreciseCoordinates: boolean;
}

export type LocationPosture = "on_premises" | "off_premises" | "off_premises_stale" | "location_unknown";
export type LocationReasonCode =
  | "INSIDE_AUTHORIZED_GEOFENCE"
  | "OUTSIDE_AUTHORIZED_GEOFENCE"
  | "STALE_LOCATION_FIX"
  | "NO_LOCATION";
export type LocationAction = "none" | "monitor" | "locate" | "alert";

export interface LocationVerdict {
  posture: LocationPosture;
  reasonCode: LocationReasonCode;
  recommendedAction: LocationAction;
  locatable: boolean;
  /** Surfaced so a policy can require coarse-only handling / audit precise use. */
  usesPreciseLocation: boolean;
}

export type LocationConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class LocationConnectorError extends Error {
  readonly code: LocationConnectorErrorCode;
  readonly status: number;
  constructor(code: LocationConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "LocationConnectorError";
    this.code = code;
    this.status = status;
  }
}
