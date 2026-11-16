// Apple canonical Declarative Device Management (DDM) schema alignment for the
// ddm-connector.
//
// The sibling of macos-posture's apple-schema.ts: it pins the subset of Apple's
// apple/device-management (MIT, schema v27.0) DDM `declarative/status/` items this
// connector's inputs correspond to, and maps each substantive DdmDeviceReport
// field to its canonical Apple provenance. DDM status is the authoritative,
// push/subscription-based channel for Apple (macOS / iOS / visionOS) device state — aligning to its names
// keeps the connector's vocabulary honest and lets a schema change on a new OS
// release surface as a failing check instead of silent drift.
//
// THE PIN IS NOW HELD AGAINST APPLE'S OWN YAML, which it was not before. This header
// promised that "a schema change surfaces as a failing check" while `proof:ddm-connector`
// compared the catalog only against itself — a self-consistent catalog stays
// self-consistent through any upstream change. The pinned items are vendored verbatim at
// `APPLE_SCHEMA_PIN_SHA` under `third_party/apple-device-management/` (Apple's MIT
// LICENSE.txt included), and the proof resolves every name below to a vendored file and
// checks its `statusitemtype` and the keys this connector reads. A pin with no vendored
// file now fails.
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
//   declarative/status/device.operating-system.family.yaml
//   declarative/status/management.client-capabilities.yaml
//   declarative/status/mdm.enrollment-type.yaml            (new in 27.0)
//   declarative/status/mdm.is-return-to-service.yaml       (new in 27.0)
//
// KNOWN AND DELIBERATELY UNMODELLED, so their absence reads as a decision rather than an
// oversight: 27.0 also adds `mdm.is-shared-ipad`, `mdm.is-awaiting-configuration`,
// `security.lockdown-mode` and `device.system.health`. Nothing in this tree reads them,
// so they are neither pinned nor vendored — a pin no code consumes is a pin nobody
// re-verifies.

/** The apple/device-management schema release this alignment is pinned to. Must
 *  match the macos-posture alignment's pinned version. */
export const DDM_APPLE_SCHEMA_VERSION = "27.0";

/** The upstream commit the vendored YAML under `third_party/apple-device-management/`
 *  was taken at (tag `Release-v27.0`). A version string alone names a release; this
 *  names the bytes, which is what a proof can actually resolve. */
export const APPLE_SCHEMA_PIN_SHA = "09f249a06e7e3289930bf6d05f38fb562f748ebf";

/** Where the vendored copy lives, repo-relative. One definition, so the proof and the
 *  re-vendoring note cannot disagree about it. */
export const APPLE_SCHEMA_VENDOR_DIR = "third_party/apple-device-management/declarative/status";

/** Canonical DDM `declarative/status/` item types the connector aligns to (pinned
 *  subset). */
export const DDM_APPLE_STATUS_ITEMS = [
  "management.declarations",
  "management.client-capabilities",
  "softwareupdate.install-state",
  "softwareupdate.failure-reason",
  "device.operating-system.version",
  // Read to decide where a 27.0 item applies: Apple marks `mdm.is-return-to-service`
  // n/a on macOS/tvOS/watchOS, so its absence there must not read as unknown.
  "device.operating-system.family",
  // New in 27.0.
  "mdm.enrollment-type",
  "mdm.is-return-to-service",
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
  "platform",
  "updateEnforcement",
  "enrollmentType",
  "returnToService",
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
    note: "macOS: Endpoint Security binary allow/deny is a CONFIGURATION declaration, not a status item — no DDM status key. Reported out-of-band / on-device. iOS has no Endpoint Security: the iOS fixtures use `enforced` as a stand-in for the supervised app allow-list, no ingest path produces it, and a real iOS report reads unknown and raises (BUILD_BACKLOG).",
  },
  privacy: {
    note: "macOS: the declarative privacy posture (PPPC replacement) is configuration-declared, not a status item — no DDM status key. No iOS meaning is defined; the iOS fixtures carry `declared` as a stand-in only, and a real iOS report reads unknown and raises (BUILD_BACKLOG).",
  },
  lastCheckInAt: {
    note: "Check-in recency is a transport/control-plane fact, not a device-reported status item.",
  },
  osMajor: { ddmStatusItem: "device.operating-system.version" },
  platform: {
    ddmStatusItem: "device.operating-system.family",
    note: "Apple's value is a free string (\"such as macOS or iOS\"), no rangelist; the connector accepts only the five supportedOS family names and reads anything else as unknown, which tightens.",
  },
  enrollmentType: {
    ddmStatusItem: "mdm.enrollment-type",
    note: "Apple's rangelist is none | supervised | device | user. Golden rule 4 rests on SUPERVISED specifically, so only that exact value is read as supervised; absent or unrecognized is unknown, and unknown tightens.",
  },
  returnToService: {
    ddmStatusItem: "mdm.is-return-to-service",
    note: "Apple: \"If true, the device is using the return to service with app preservation mode\" — a standing shared-device configuration, not an erase in flight (that is MDM command status / a device_returned event). Reported on iOS and visionOS 27.0+ only; n/a on macOS, tvOS, watchOS, where absence is not_applicable. Absent where it applies, a pre-27 iOS/visionOS (Apple-correct n/a, not signed off as a loosening), or an unknown platform/OS/non-whole OS major, is unknown, and unknown tightens. `true` does not raise on this axis, but Apple: \"If Return to Service with app preservation is active, the device disables software updates—both automatic and user-initiated\" — updates apply only at a reset, so declarative update enforcement on such a device reads unknown (reset-bound) and raises.",
  },
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
