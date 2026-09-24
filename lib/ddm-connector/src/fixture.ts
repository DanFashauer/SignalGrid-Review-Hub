// Public-safe, deterministic DDM device reports — a spread of postures so the
// normalizer's mapping and fail-closed assurance-raising can be exercised. No
// real device, no live MDM call; timestamps are relative to DDM_OBSERVED_AT.

import type { DdmDeviceReport } from "./index";

/** Fixed observation time, so freshness is deterministic. */
export const DDM_OBSERVED_AT = "2026-07-16T14:00:00.000Z";

const fresh = "2026-07-16T13:30:00.000Z"; // 30m old → fresh
const stale = "2026-07-15T10:00:00.000Z"; // ~28h old → stale
const old = "2026-07-12T09:00:00.000Z"; // ~4d old → expired

export const DEMO_DDM_REPORTS: DdmDeviceReport[] = [
  // Fully healthy: enrolled, binary control enforced, privacy declared, fresh, and
  // update enforcement is declarative (current) → the only standard-assurance Mac.
  { deviceRef: "mac-noc-01", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Binary control permissive (unmanaged binaries allowed) → baseline drift, raise step-up.
  { deviceRef: "mac-noc-02", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "permissive", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Binary control disabled entirely → drift + raise step-up.
  { deviceRef: "mac-noc-03", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "disabled", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Privacy declaration only partial → raise step-up (posture incomplete).
  { deviceRef: "mac-noc-04", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "partial", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Health degraded → non-compliant + raise step-up.
  { deviceRef: "mac-noc-05", platform: "macOS", enrolled: true, health: "degraded", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Stale check-in → freshness stale + raise step-up.
  { deviceRef: "mac-noc-06", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: stale, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
  // Never checked in → freshness missing + raise step-up (enforcement also unreported).
  { deviceRef: "mac-noc-07", platform: "macOS", enrolled: true, health: "unreporting", binaryControl: "unknown", privacy: "unknown", lastCheckInAt: null },
  // Not DDM-enrolled at all → not managed + raise step-up.
  { deviceRef: "mac-byod-01", platform: "macOS", enrolled: false, health: "unknown", binaryControl: "unknown", privacy: "missing", lastCheckInAt: old },
  // THE OS-27 CUTOVER CASE: looks perfect — enrolled, enforced, declared, fresh —
  // but update enforcement is still on the LEGACY command model, which is a silent
  // no-op on OS 27. "Compliant" is not trustworthy → dead → raise step-up.
  { deviceRef: "mac-noc-08", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "legacy", enrollmentType: "supervised" },
  // Legacy enforcement on a pre-27 device — works today, dies on the OS-27 upgrade.
  { deviceRef: "mac-noc-09", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 26, updateEnforcement: "legacy", enrollmentType: "supervised" },
  // No update enforcement configured at all → dead → raise step-up.
  { deviceRef: "mac-noc-10", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "none", enrollmentType: "supervised" },
  // 27.0 `mdm.enrollment-type`: otherwise perfect, but USER-enrolled rather than
  // supervised. Golden rule 4's captive-device claim rests on supervision, so this is
  // the device an org believes it holds and does not → raise step-up.
  { deviceRef: "mac-noc-11", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "user" },
  // 27.0 `mdm.is-return-to-service` is reported on iOS/visionOS 27+ only (Apple marks it
  // n/a on macOS, which is why no Mac above carries the key). Three otherwise-perfect
  // shared iPhones, one per arm. `binaryControl: "enforced"` and `privacy: "declared"` are
  // STAND-INS so the return-to-service arm is isolated: iOS has no Endpoint Security or
  // PPPC, no ingest path produces either value, and a real iPhone reads unknown on both
  // and raises (docs/BUILD_BACKLOG.md).
  // Reported false → in_service → standard.
  { deviceRef: "iphone-shared-01", platform: "iOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised", returnToService: false },
  // Reported true → configured for return to service with app preservation. A standing
  // shared-device mode, not an erase in flight, so the RTS axis itself does not raise —
  // but Apple disables software updates in this mode except at a reset, so declarative
  // update enforcement reads unknown (reset-bound) → raise step-up.
  { deviceRef: "iphone-shared-02", platform: "iOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised", returnToService: true },
  // Not reported where Apple says it is required → unknown → raise step-up.
  { deviceRef: "iphone-shared-03", platform: "iOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" },
];
