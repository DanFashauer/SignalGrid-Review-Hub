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
  // Fully healthy: enrolled, binary control enforced, privacy declared, fresh.
  { deviceRef: "mac-noc-01", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh },
  // Binary control permissive (unmanaged binaries allowed) → baseline drift, raise step-up.
  { deviceRef: "mac-noc-02", enrolled: true, health: "healthy", binaryControl: "permissive", privacy: "declared", lastCheckInAt: fresh },
  // Binary control disabled entirely → drift + raise step-up.
  { deviceRef: "mac-noc-03", enrolled: true, health: "healthy", binaryControl: "disabled", privacy: "declared", lastCheckInAt: fresh },
  // Privacy declaration only partial → raise step-up (posture incomplete).
  { deviceRef: "mac-noc-04", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "partial", lastCheckInAt: fresh },
  // Health degraded → non-compliant + raise step-up.
  { deviceRef: "mac-noc-05", enrolled: true, health: "degraded", binaryControl: "enforced", privacy: "declared", lastCheckInAt: fresh },
  // Stale check-in → freshness stale + raise step-up.
  { deviceRef: "mac-noc-06", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: stale },
  // Never checked in → freshness missing + raise step-up.
  { deviceRef: "mac-noc-07", enrolled: true, health: "unreporting", binaryControl: "unknown", privacy: "unknown", lastCheckInAt: null },
  // Not DDM-enrolled at all → not managed + raise step-up.
  { deviceRef: "mac-byod-01", enrolled: false, health: "unknown", binaryControl: "unknown", privacy: "missing", lastCheckInAt: old },
];
