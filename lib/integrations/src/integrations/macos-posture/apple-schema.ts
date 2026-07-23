// Apple canonical device-management schema alignment for the macOS posture path.
//
// apple/device-management (MIT-licensed, schema version 26.4) is Apple's
// authoritative, machine-readable vocabulary for macOS security state: the MDM
// `SecurityInfo` command response, the Declarative Device Management (DDM) status
// items, and the Managed Device Attestation leaf-certificate OIDs. SignalGrid's
// grid_collected macOS reads (via signalgrid-mcp) and any future vendor
// SecurityInfo path (Intune / Jamf) should speak ONE vocabulary — Apple's.
//
// This module pins that vocabulary and maps each NormalizedMacosPosture field to
// its canonical Apple key, so every posture fact is traceable to Apple's own
// schema and a schema change on a new OS release surfaces as a failing check
// instead of silent drift. It is a NAMING / PROVENANCE alignment only: it changes
// no verdict logic and adds no runtime dependency.
//
// Source (pinned, do not track HEAD): https://github.com/apple/device-management
//   mdm/commands/information.security.yaml   (SecurityInfo keys)
//   declarative/status/*.yaml                (DDM status items)
//   mdm/commands/information.device.yaml     (DevicePropertiesAttestation OIDs)
// Apple accepts schema feedback via Feedback Assistant, not pull requests.

/** The apple/device-management schema release this alignment is pinned to. Bump
 *  deliberately when re-reconciling against a newer OS schema. */
export const APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION = "26.4";

/** Canonical MDM `SecurityInfo` response keys we align to (pinned subset of
 *  mdm/commands/information.security.yaml). A dotted key denotes a nested-
 *  dictionary path, e.g. FirewallSettings.StealthMode. */
export const APPLE_SECURITYINFO_KEYS = [
  "FDE_Enabled",
  "SystemIntegrityProtectionEnabled",
  "FirewallSettings.FirewallEnabled",
  "FirewallSettings.StealthMode",
  "FirewallSettings.BlockAllIncoming",
  "SecureBoot.SecureBootLevel",
  "FirmwarePasswordStatus.PasswordExists",
  "ManagementStatus.EnrolledViaDEP",
  "ManagementStatus.UserApprovedEnrollment",
  "RemoteDesktopEnabled",
] as const;
export type AppleSecurityInfoKey = (typeof APPLE_SECURITYINFO_KEYS)[number];

/** Canonical DDM `declarative/status/` item types we align to (pinned subset).
 *  DDM status is push/subscription-based and fresher than polling SecurityInfo. */
export const APPLE_DDM_STATUS_ITEMS = [
  "diskmanagement.filevault.enabled",
  "softwareupdate.install-state",
  "softwareupdate.failure-reason",
  "management.declarations",
  "security.certificate.list",
  "passcode.is-compliant",
  "device.operating-system.version",
] as const;
export type AppleDdmStatusItem = (typeof APPLE_DDM_STATUS_ITEMS)[number];

/** Leaf-certificate OIDs from Managed Device Attestation
 *  (DeviceInformation → DevicePropertiesAttestation, Apple silicon, macOS 14.2+),
 *  the hardware-rooted posture tier. Reserved for a future deviceAttestation
 *  dimension; pinned here so the vocabulary lives in one place. */
export const APPLE_ATTESTATION_OIDS = {
  serialNumber: "1.2.840.113635.100.8.9.1",
  udid: "1.2.840.113635.100.8.9.2",
  softwareUpdateDeviceId: "1.2.840.113635.100.8.9.4",
  osVersion: "1.2.840.113635.100.8.10.1",
  sepOsVersion: "1.2.840.113635.100.8.10.2",
  llbVersion: "1.2.840.113635.100.8.10.3",
  freshnessCode: "1.2.840.113635.100.8.11.1",
  sipStatus: "1.2.840.113635.100.8.13.1",
  secureBootStatus: "1.2.840.113635.100.8.13.2",
  thirdPartyKextAllowed: "1.2.840.113635.100.8.13.3",
} as const;
/** One of the pinned attestation OIDs — a free-form OID string cannot be aliased,
 *  so a fabricated OID fails to compile (same drift discipline as the key catalogs). */
export type AppleAttestationOid = (typeof APPLE_ATTESTATION_OIDS)[keyof typeof APPLE_ATTESTATION_OIDS];

export interface AppleFieldAlias {
  /** Canonical MDM SecurityInfo key, when this field maps to one. */
  securityInfoKey?: AppleSecurityInfoKey;
  /** Canonical DDM status item, when this field maps to one. */
  ddmStatusItem?: AppleDdmStatusItem;
  /** Attestation OID that cryptographically attests this field, when one exists. */
  attestationOid?: AppleAttestationOid;
  /** Clarifying context, or why there is no Apple key (an on-device-only signal). */
  note?: string;
}

/** Every substantive NormalizedMacosPosture field → its provenance in Apple's
 *  canonical schema. A field with no MDM/DDM key is an on-device-only
 *  (grid_collected) signal and says so in `note` — never silently unmapped. The
 *  alignment proof asserts this covers exactly NORMALIZED_MACOS_POSTURE_FIELDS and
 *  references only keys in the pinned catalogs above (the drift guard). */
export const MACOS_POSTURE_APPLE_ALIASES: Record<string, AppleFieldAlias> = {
  sip: { securityInfoKey: "SystemIntegrityProtectionEnabled", attestationOid: APPLE_ATTESTATION_OIDS.sipStatus },
  fileVault: { securityInfoKey: "FDE_Enabled", ddmStatusItem: "diskmanagement.filevault.enabled" },
  firewall: { securityInfoKey: "FirewallSettings.FirewallEnabled" },
  gatekeeper: {
    note: "No SecurityInfo/DDM key — Gatekeeper is assessed on-device (spctl). grid_collected only.",
  },
  mdmEnrolled: {
    securityInfoKey: "ManagementStatus.UserApprovedEnrollment",
    note: "SecurityInfo has no direct is-enrolled boolean; UserApprovedEnrollment is the closest — false degrades trust even when enrolled (the device may reject security payloads).",
  },
  autoUpdate: {
    ddmStatusItem: "softwareupdate.install-state",
    note: "Closest DDM update-posture signal (install progress / failure). Whether auto-update is ENABLED is a config declaration, not a status item; the on-device read (AutomaticCheckEnabled) remains the enablement source.",
  },
  malwareDefs: { note: "XProtect / MRT definitions — no MDM/DDM key; on-device read only." },
  sysextResidual: { note: "systemextensionsctl on-device inventory — no MDM/DDM key." },
  sysextConflict: { note: "systemextensionsctl on-device inventory — no MDM/DDM key." },
  osVersion: {
    ddmStatusItem: "device.operating-system.version",
    attestationOid: APPLE_ATTESTATION_OIDS.osVersion,
  },
};

/** Canonical SecurityInfo keys SignalGrid does NOT yet collect but which Apple's
 *  schema exposes — the honest roadmap of read-only controls a future macOS
 *  posture read could add (surfaced so the gap is explicit, never implied
 *  covered). */
export const APPLE_SECURITYINFO_NOT_YET_COLLECTED = [
  "FirewallSettings.StealthMode",
  "FirewallSettings.BlockAllIncoming",
  "SecureBoot.SecureBootLevel",
  "FirmwarePasswordStatus.PasswordExists",
  "ManagementStatus.EnrolledViaDEP",
  "RemoteDesktopEnabled",
] as const;
