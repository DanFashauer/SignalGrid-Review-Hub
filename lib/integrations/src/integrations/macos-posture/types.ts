// Types for the read-only macOS endpoint-posture dimension — the grid_collected
// path for a Mac.
//
// This is the connector that consumes a `signalgrid-mcp` posture report (the
// public, read-only MCP server that reads a Mac's native security state on the
// device: SIP, FileVault, Gatekeeper, firewall, MDM enrollment, update settings,
// XProtect definition readability) and normalizes it into ONE endpoint-hardening posture the
// fabric can fuse. It is the concrete realization of the `grid_collected`
// acquisition path: no vendor cloud API hands you these facts faithfully in real
// time, so SignalGrid reads them on the endpoint and does the lifting itself.
//
// Fail-safe by construction, mirroring the MCP server's own discipline: a control
// whose state could NOT be determined (null / missing binary / needs elevation)
// is `unknown` and RAISES the assurance bar — it is NEVER read as "on". A disabled
// hardening control restricts. A device with no report at all is a blind spot,
// never "hardened". "unknown ≠ off, and unknown ≠ on" is the whole point.
//
// SignalGrid does NOT change any macOS setting — every signal here is read-only.
// It consumes the posture and turns it into a runtime allow/step-up/restrict/deny
// decision for a shared, checked-out device.

/** A control whose live state the collector reports on. `unknown` is a real,
 *  first-class value — the check could not run, NOT a claim that it is off. */
export type MacosControl = "on" | "off" | "unknown";

/** Whether the endpoint's malware definitions (XProtect/MRT) were readable.
 *  Honest: without a definition date we do not fabricate staleness — we only
 *  distinguish "a real value was present" from "could not read it". */
export type MacosDefsState = "present" | "unknown";

/**
 * The raw `signalgrid-mcp` posture-report shape (the default sections), typed
 * loosely because any section can degrade to `{ error }` and any probe can be
 * null. We read defensively and never assume a field is present.
 */
export interface MacosPostureReportRaw {
  identity?: Record<string, unknown>;
  os?: { product_version?: unknown; build_version?: unknown; [k: string]: unknown };
  security?: {
    sip?: { enabled?: boolean | null };
    filevault?: { enabled?: boolean | null };
    gatekeeper?: { enabled?: boolean | null };
    firewall?: { enabled?: boolean | null };
    [k: string]: unknown;
  };
  mdm?: { mdm_enrolled?: boolean | null; dep_enrolled?: boolean | null; [k: string]: unknown };
  updates?: {
    AutomaticCheckEnabled?: boolean | null;
    AutomaticallyInstallMacOSUpdates?: boolean | null;
    [k: string]: unknown;
  };
  xprotect?: { xprotect_definitions?: unknown; [k: string]: unknown };
  /** Optional enrichment from signalgrid_system_extensions. When absent it is
   *  simply not assessed (contributes nothing); when present-but-unreadable it
   *  raises the bar (see evaluate). */
  system_extensions?: {
    available?: unknown;
    reliable?: unknown;
    residual_count?: unknown;
    extensions?: Array<{ category?: unknown; status?: unknown; enabled?: unknown }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** The normalized, vendor-neutral endpoint posture — one shape the fabric reads. */
export interface NormalizedMacosPosture {
  sourceSystem: "macos-posture";
  deviceId: string;
  osVersion: string | null;
  sip: MacosControl;
  fileVault: MacosControl;
  gatekeeper: MacosControl;
  firewall: MacosControl;
  /** null = enrollment state could not be determined (unknown, not "unmanaged"). */
  mdmEnrolled: boolean | null;
  autoUpdate: MacosControl;
  malwareDefs: MacosDefsState;
  /** Stranded security extensions (registered after their app is gone). null =
   *  not assessed or unreadable. > 0 = a real hardening concern (blocks reinstall). */
  sysextResidual: number | null;
  /** Two+ enabled endpoint-security extensions fighting. null = not assessed/unreadable. */
  sysextConflict: boolean | null;
  /** True when a system_extensions section WAS provided but could not be trusted
   *  (available/reliable false, or counts unreadable) — raises the bar, fail-safe. */
  sysextUnreliable: boolean;
  source: string;
}

/** The four core hardening controls, in a fixed order (used for reporting). */
export const CORE_CONTROLS = ["sip", "fileVault", "gatekeeper", "firewall"] as const;
export type CoreControl = (typeof CORE_CONTROLS)[number];

/** The substantive posture fields on NormalizedMacosPosture — the ones that carry
 *  an observed device-security fact (excludes the meta fields sourceSystem /
 *  deviceId / source and the derived sysextUnreliable flag). The Apple-schema
 *  alignment proof asserts every one of these is mapped to its canonical Apple
 *  provenance, so adding a new posture field forces a deliberate mapping decision. */
export const NORMALIZED_MACOS_POSTURE_FIELDS = [
  "sip",
  "fileVault",
  "gatekeeper",
  "firewall",
  "mdmEnrolled",
  "autoUpdate",
  "malwareDefs",
  "sysextResidual",
  "sysextConflict",
  "osVersion",
] as const;
export type NormalizedMacosPostureField = (typeof NORMALIZED_MACOS_POSTURE_FIELDS)[number];

/** Meta fields on NormalizedMacosPosture that carry no device-security fact (so
 *  they are deliberately NOT in NORMALIZED_MACOS_POSTURE_FIELDS / the Apple map). */
type MacosPostureMetaField = "sourceSystem" | "deviceId" | "source" | "sysextUnreliable";

// Compile-time bridges giving the hand-maintained field list real teeth against the
// interface: (1) every listed field is a genuine key of NormalizedMacosPosture, and
// (2) the listed fields + meta fields EXHAUSTIVELY cover the interface — so adding a
// new field to NormalizedMacosPosture without listing it (or marking it meta) is a
// compile error, forcing a deliberate Apple-provenance mapping decision.
const _macosFieldsAreRealKeys: readonly (keyof NormalizedMacosPosture)[] = NORMALIZED_MACOS_POSTURE_FIELDS;
type _MacosUncoveredField = Exclude<keyof NormalizedMacosPosture, NormalizedMacosPostureField | MacosPostureMetaField>;
const _macosNoUncoveredField: _MacosUncoveredField extends never ? true : false = true;
void _macosFieldsAreRealKeys;
void _macosNoUncoveredField;

export type MacosPosture =
  | "hardened"
  | "patch_lagging"
  | "unmanaged"
  | "unverified"
  | "weakened"
  | "unknown";

export type MacosReasonCode =
  | "FULLY_HARDENED"
  | "AUTO_UPDATE_OFF"
  | "DEVICE_UNMANAGED"
  | "HARDENING_STATE_UNKNOWN"
  | "HARDENING_CONTROL_OFF"
  | "SECURITY_EXTENSION_STRANDED"
  | "SECURITY_EXTENSION_CONFLICT"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type MacosRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface MacosPostureVerdict {
  posture: MacosPosture;
  reasonCode: MacosReasonCode;
  recommendedAction: MacosRecommendedAction;
  /** Core controls the report says are explicitly OFF. */
  controlsOff: string[];
  /** Signals whose state could NOT be determined (raise assurance, fail-safe). */
  controlsUnknown: string[];
  mdmEnrolled: boolean | null;
  osVersion: string | null;
  /** Stranded security extensions counted (null = not assessed/unreadable). */
  sysextResidual: number | null;
  /** Conflicting endpoint-security extensions (null = not assessed/unreadable). */
  sysextConflict: boolean | null;
}

export type MacosPostureConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class MacosPostureConnectorError extends Error {
  readonly code: MacosPostureConnectorErrorCode;
  readonly status: number;
  constructor(code: MacosPostureConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "MacosPostureConnectorError";
    this.code = code;
    this.status = status;
  }
}
