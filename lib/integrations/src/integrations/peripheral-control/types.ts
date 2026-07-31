// Types for the read-only removable-media / peripheral-control dimension.
//
// The data-exfiltration / malware-ingress surface: is an unauthorized or
// unencrypted removable device attached to the shared device? On a shared
// frontline (especially clinical) workstation, a writable USB drive is a real
// HIPAA/exfil and ingress vector. This normalizes a device-control platform
// (Microsoft Intune device control, Defender for Endpoint device control,
// CrowdStrike Falcon Device Control, Ivanti Device Control, Forcepoint) into one
// vocabulary and turns it into a per-device peripheral posture. Fail-safe by
// construction: a writable removable whose authorization/encryption we cannot
// confirm is treated as the risk it might be (never assumed safe), and a device
// with no device-control coverage is a blind spot (never "clean").

/** Normalized peripheral device class. */
export type PeripheralClass =
  | "mass_storage"
  | "mtp"
  | "imaging"
  | "input"
  | "printer"
  | "network"
  | "other"
  | "unknown";

/** Normalized host access granted to the peripheral. */
export type PeripheralAccess = "blocked" | "read_only" | "read_write" | "unknown";

/** Raw per-peripheral record (a read-only, vendor-neutral subset). */
export interface PeripheralRaw {
  peripheralId?: string;
  class?: string;
  access?: string;
  encrypted?: boolean;
  /** Allowlisted / known-good per device-control policy. */
  authorized?: boolean;
  productName?: string;
}

/** Raw per-device record: device-control policy state + attached peripherals. */
export interface PeripheralPostureRaw {
  deviceId: string;
  /** Whether a device-control policy is applied/enforced on the device. */
  policyEnforced?: boolean;
  peripherals?: PeripheralRaw[];
  source?: string;
}

export interface PeripheralCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedPeripheral {
  peripheralId: string | null;
  class: PeripheralClass;
  access: PeripheralAccess;
  encrypted: boolean | null;
  authorized: boolean | null;
  productName: string | null;
}

export interface NormalizedPeripheralPosture {
  sourceSystem: "peripheral-control";
  deviceId: string;
  policyEnforced: boolean | null;
  /**
   * `null` when the source did not report a peripheral/removable-media inventory at all — distinct from `[]`,
   * which means it reported and found nothing. The same distinction this package
   * already draws for scalars (`null = not reported`), extended to the collection:
   * a feed that was never read must not be gradeable as a clean one.
   */
  peripherals: NormalizedPeripheral[] | null;
  source: string;
}

export type PeripheralPosture =
  | "no_removable"
  | "controlled"
  | "unclassified_media"
  | "policy_unenforced"
  | "unencrypted_media"
  | "unauthorized_media"
  | "exfil_risk"
  | "unknown";

export type PeripheralReasonCode =
  | "NO_REMOVABLE"
  | "PERIPHERAL_FEED_UNOBSERVED"
  | "NOT_COVERED"
  | "CONTROLLED_MEDIA"
  | "UNCLASSIFIED_PERIPHERAL"
  | "POLICY_UNENFORCED"
  | "UNENCRYPTED_WRITABLE_MEDIA"
  | "UNAUTHORIZED_MEDIA"
  | "UNAUTHORIZED_UNENCRYPTED_MEDIA";

/** All members are on the unified action ladder used by posture-composition. */
export type PeripheralAction = "none" | "monitor" | "step_up" | "alert" | "restrict";

export interface PeripheralVerdict {
  posture: PeripheralPosture;
  removableCount: number;
  writableRemovableCount: number;
  policyEnforced: boolean | null;
  reasonCode: PeripheralReasonCode;
  recommendedAction: PeripheralAction;
}

export type PeripheralConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class PeripheralConnectorError extends Error {
  readonly code: PeripheralConnectorErrorCode;
  readonly status: number;
  constructor(code: PeripheralConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "PeripheralConnectorError";
    this.code = code;
    this.status = status;
  }
}
