// Types for the read-only physical access-control (PACS) dimension.
//
// SignalGrid's identity dimensions ask about the LOGICAL session (sso-session,
// oauth-consent, token-binding) and rtls-custody asks where the DEVICE physically
// is. Neither asks the physical-access-control question a badge reader at the door
// answers: **did the person now holding this shared device legitimately badge into
// this controlled area, are they authorized to be here right now, and is the door
// itself secure?** On a shared, badge-checked-out frontline device this ties the
// physical world to the grid — a person actively DENIED or REVOKED at the door, a
// tailgating (anti-passback) breach, a forced door, or a badge-holder who does not
// match the checked-out device holder are all physical signals the logical layer
// cannot see.
//
// This connector normalizes a physical access-control system's already-evaluated
// view of the controlled entry the device sits behind (Control iD / ZKTeco-class
// biometric door/turnstile controllers, HID Wiegand/OSDP readers, ZKBio /
// Verkada-class cloud access control). It consumes access-log + access-rule +
// alarm state; it opens no door, unlocks no turnstile, and revokes no credential
// (those stay with the PACS).

/** Was the badge/biometric presentation at the controlled entry granted? */
export type AccessResult = "granted" | "denied" | "unknown";

/** How the holder authenticated at the reader. */
export type CredentialType = "biometric" | "card" | "mobile" | "pin" | "unknown";

/** Is the holder authorized for THIS door/zone right now, per the PACS access
 *  rules + time zones? `out_of_schedule` = outside their permitted hours;
 *  `out_of_zone` = not authorized for this area; `revoked` = the credential/grant
 *  has been revoked. */
export type AccessAuthorization = "authorized" | "out_of_schedule" | "out_of_zone" | "revoked" | "unknown";

/** Anti-passback / tailgating state. `violation` = a badge used to admit a second
 *  person, or reused without an exit (passback) — a tailgating signature. */
export type AntipassbackState = "ok" | "violation" | "unknown";

/** Physical door state from the controller. `forced` = opened without a valid
 *  grant (door-forced alarm); `held_open` = propped/held past its relock timer. */
export type DoorState = "secured" | "forced" | "held_open" | "unknown";

/** Raw PACS report about one controlled entry / holder (loosely typed — any field
 *  may degrade to null / an error string). */
export interface PacsAccessReportRaw {
  accessResult?: unknown; // granted | denied | unknown
  credentialType?: unknown; // biometric | card | mobile | pin | unknown
  authorization?: unknown; // authorized | out_of_schedule | out_of_zone | revoked | unknown
  antipassback?: unknown; // ok | violation | unknown
  doorState?: unknown; // secured | forced | held_open | unknown
  /** Does the PACS badge-holder match the checked-out device holder? */
  identityMatched?: boolean | null;
  /** The PACS-attested holder and the expected checked-out badge-holder, when present. */
  pacsSubject?: unknown;
  expectedSubject?: unknown;
  /** Was the PACS bridge reachable to evaluate this entry? */
  bridgeReachable?: boolean | null;
  [k: string]: unknown;
}

/** The normalized, vendor-neutral PACS posture — one shape the fabric reads. */
export interface NormalizedPacsAccess {
  sourceSystem: "pacs-access";
  deviceId: string;
  accessResult: AccessResult;
  credentialType: CredentialType;
  authorization: AccessAuthorization;
  antipassback: AntipassbackState;
  doorState: DoorState;
  /** true = PACS holder confirmed == checked-out holder; false = a mismatch;
   *  null = not reported. */
  identityMatched: boolean | null;
  pacsSubject: string | null;
  expectedSubject: string | null;
  bridgeReachable: boolean | null;
  source: string;
}

export type PacsAccessPosture =
  | "physical_access_ok"
  | "access_denied"
  | "credential_revoked"
  | "identity_mismatch"
  | "antipassback_breach"
  | "door_forced"
  | "out_of_bounds"
  | "door_held"
  | "unverified"
  | "unknown";

export type PacsAccessReasonCode =
  | "PHYSICAL_ACCESS_GRANTED"
  | "ACCESS_DENIED"
  | "CREDENTIAL_REVOKED"
  | "IDENTITY_MISMATCH"
  | "ANTIPASSBACK_VIOLATION"
  | "DOOR_FORCED"
  | "OUT_OF_SCHEDULE"
  | "OUT_OF_ZONE"
  | "DOOR_HELD_OPEN"
  | "PACS_STATE_UNKNOWN"
  | "BRIDGE_UNREACHABLE"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type PacsAccessAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface PacsAccessVerdict {
  posture: PacsAccessPosture;
  reasonCode: PacsAccessReasonCode;
  recommendedAction: PacsAccessAction;
  /** Containment-level findings (denied / revoked / identity mismatch / forced door / tailgating). */
  criticalFindings: string[];
  /** PACS facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the holder is confirmed to have a legitimate, authorized,
   *  in-bounds physical entry at a secure door AND their PACS identity matches the
   *  checked-out device holder (never true for a denied/revoked/mismatched/forced/
   *  tailgating/unverified entry). */
  physicalAccessConfirmed: boolean;
  deviceId: string;
}

export type PacsAccessConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class PacsAccessConnectorError extends Error {
  readonly code: PacsAccessConnectorErrorCode;
  readonly status: number;
  constructor(code: PacsAccessConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "PacsAccessConnectorError";
    this.code = code;
    this.status = status;
  }
}
