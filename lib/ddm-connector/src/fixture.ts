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
  // update enforcement is declarative (current) → the only standard-assurance device.
  { deviceRef: "mac-noc-01", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative" },
  // Binary control permissive (unmanaged binaries allowed) → baseline drift, raise step-up.
  { deviceRef: "mac-noc-02", enrolled: true, health: "healthy", binaryControl: "permissive", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative" },
  // Binary control disabled entirely → drift + raise step-up.
  { deviceRef: "mac-noc-03", enrolled: true, health: "healthy", binaryControl: "disabled", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative" },
  // Privacy declaration only partial → raise step-up (posture incomplete).
  { deviceRef: "mac-noc-04", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "partial", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative" },
  // Health degraded → non-compliant + raise step-up.
  { deviceRef: "mac-noc-05", enrolled: true, health: "degraded", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "declarative" },
  // Stale check-in → freshness stale + raise step-up.
  { deviceRef: "mac-noc-06", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: stale, osMajor: 27, updateEnforcement: "declarative" },
  // Never checked in → freshness missing + raise step-up (enforcement also unreported).
  { deviceRef: "mac-noc-07", enrolled: true, health: "unreporting", binaryControl: "unknown", privacy: "unknown", lastCheckInAt: null },
  // Not DDM-enrolled at all → not managed + raise step-up.
  { deviceRef: "mac-byod-01", enrolled: false, health: "unknown", binaryControl: "unknown", privacy: "missing", lastCheckInAt: old },
  // THE OS-27 CUTOVER CASE: looks perfect — enrolled, enforced, declared, fresh —
  // but update enforcement is still on the LEGACY command model, which is a silent
  // no-op on OS 27. "Compliant" is not trustworthy → dead → raise step-up.
  { deviceRef: "mac-noc-08", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "legacy" },
  // Legacy enforcement on a pre-27 device — works today, dies on the OS-27 upgrade.
  { deviceRef: "mac-noc-09", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 26, updateEnforcement: "legacy" },
  // No update enforcement configured at all → dead → raise step-up.
  { deviceRef: "mac-noc-10", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh, osMajor: 27, updateEnforcement: "none" },
];
