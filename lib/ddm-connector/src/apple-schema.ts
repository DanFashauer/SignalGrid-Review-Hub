// Apple canonical Declarative Device Management (DDM) schema alignment for the
// ddm-connector.
//
// The sibling of macos-posture's apple-schema.ts: it pins the subset of Apple's
// apple/device-management (MIT, schema v26.4) DDM `declarative/status/` items this
// connector's inputs correspond to, and maps each substantive DdmDeviceReport
// field to its canonical Apple provenance. DDM status is the authoritative,
// push/subscription-based channel for macOS device state — aligning to its names
// keeps the connector's vocabulary honest and lets a schema change on a new OS
// release surface as a failing check instead of silent drift.
//
// Naming / provenance alignment only: it changes no normalization logic and adds
// no runtime dependency. Fields that DDM does not expose as a status item (a
// configuration-declared control like binary allow/deny or the privacy posture, or
// a transport-level fact like check-in recency) declare that explicitly, never a
// fabricated key.
//
// Source (pinned, do not track HEAD): https://github.com/apple/device-management
//   declarative/status/management.declarations.yaml
//   declarative/status/softwareupdate.install-state.yaml (+ .failure-reason)
//   declarative/status/device.operating-system.version.yaml
//   declarative/status/management.client-capabilities.yaml

/** The apple/device-management schema release this alignment is pinned to. Must
 *  match the macos-posture alignment's pinned version. */
export const DDM_APPLE_SCHEMA_VERSION = "26.4";

/** Canonical DDM `declarative/status/` item types the connector aligns to (pinned
 *  subset). */
export const DDM_APPLE_STATUS_ITEMS = [
  "management.declarations",
  "management.client-capabilities",
  "softwareupdate.install-state",
  "softwareupdate.failure-reason",
  "device.operating-system.version",
] as const;
export type DdmAppleStatusItem = (typeof DDM_APPLE_STATUS_ITEMS)[number];

/** The substantive DdmDeviceReport fields — the ones carrying a device fact
 *  (excludes deviceRef / sourceReference, which are addressing/provenance meta).
 *  The alignment proof asserts every one is mapped to its Apple provenance. */
export const DDM_REPORT_FIELDS = [
  "enrolled",
  "health",
  "binaryControl",
  "privacy",
  "lastCheckInAt",
  "osMajor",
  "updateEnforcement",
] as const;
export type DdmReportField = (typeof DDM_REPORT_FIELDS)[number];

export interface DdmAppleAlias {
  /** Canonical DDM status item, when this field maps to one. */
  ddmStatusItem?: DdmAppleStatusItem;
  /** Clarifying context, or why there is no DDM status item (a config-declared or
   *  transport-level fact rather than a reported status). */
  note?: string;
}

/** Every substantive DdmDeviceReport field → its provenance in Apple's DDM status
 *  schema. A field DDM does not report as status declares so in `note`. Keyed by
 *  DdmReportField so the map is exhaustive at COMPILE time — a missing or extra
 *  entry is a build error, not just a runtime proof failure. */
export const DDM_REPORT_APPLE_ALIASES: Record<DdmReportField, DdmAppleAlias> = {
  enrolled: {
    ddmStatusItem: "management.declarations",
    note: "Enrollment is reflected by the presence of active management declarations.",
  },
  health: {
    ddmStatusItem: "management.declarations",
    note: "DDM health = the active/valid state of the device's declarations (management.declarations[].valid).",
  },
  binaryControl: {
    note: "Endpoint Security binary allow/deny is a CONFIGURATION declaration, not a status item — no DDM status key. Reported out-of-band / on-device.",
  },
  privacy: {
    note: "The declarative privacy posture (PPPC replacement) is configuration-declared, not a status item — no DDM status key.",
  },
  lastCheckInAt: {
    note: "Check-in recency is a transport/control-plane fact, not a device-reported status item.",
  },
  osMajor: { ddmStatusItem: "device.operating-system.version" },
  updateEnforcement: {
    ddmStatusItem: "softwareupdate.install-state",
    note: "Update enforcement state maps to softwareupdate install/failure status; the OS-27 legacy-vs-declarative distinction is SignalGrid's own currency model on top.",
  },
};

// Compile-time bridge (type-only import → no runtime cycle) giving DDM_REPORT_FIELDS
// real teeth against the DdmDeviceReport interface: adding a fact-bearing field to
// the report without listing it (or marking it meta) is a compile error, forcing a
// deliberate Apple-provenance mapping decision.
import type { DdmDeviceReport } from "./index";

type DdmReportMetaField = "deviceRef" | "sourceReference";
const _ddmFieldsAreRealKeys: readonly (keyof DdmDeviceReport)[] = DDM_REPORT_FIELDS;
type _DdmUncoveredField = Exclude<keyof DdmDeviceReport, DdmReportField | DdmReportMetaField>;
const _ddmNoUncoveredField: _DdmUncoveredField extends never ? true : false = true;
void _ddmFieldsAreRealKeys;
void _ddmNoUncoveredField;
