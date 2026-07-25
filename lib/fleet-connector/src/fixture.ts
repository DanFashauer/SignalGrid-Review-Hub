// Public-safe, deterministic Fleet host reports — a spread of postures so the
// normalizer's mapping and fail-closed assurance-raising can be exercised. No real
// host, no live Fleet call; timestamps are relative to FLEET_OBSERVED_AT.

import type { FleetHostReport } from "./index";

/** Fixed observation time, so freshness is deterministic. */
export const FLEET_OBSERVED_AT = "2026-07-16T14:00:00.000Z";

const fresh = "2026-07-16T13:30:00.000Z"; // 30m old → fresh
const stale = "2026-07-15T10:00:00.000Z"; // ~28h old → stale
const old = "2026-07-12T09:00:00.000Z"; // ~4d old → expired

export const DEMO_FLEET_REPORTS: FleetHostReport[] = [
  // Fully healthy: enrolled, supervised, encrypted, screen lock on, OS at floor,
  // fresh → the only standard-assurance, fully-enforceable host.
  { hostRef: "ipad-ward-01", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: fresh },
  // Disk encryption OFF → non-compliant + baseline drift + raise step-up.
  { hostRef: "ipad-ward-02", mdmEnrolled: true, supervised: true, diskEncryption: "off", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: fresh },
  // Screen lock OFF → non-compliant + raise step-up.
  { hostRef: "ipad-ward-03", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "off", osMajor: 26, osFloor: 26, lastSeenAt: fresh },
  // OS below the org floor → non-compliant + raise step-up (unpatched).
  { hostRef: "ipad-ward-04", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 24, osFloor: 26, lastSeenAt: fresh },
  // Enrolled but UNSUPERVISED → enforceable=false (kiosk/allowlist/non-removable
  // can't engage) + raise step-up until supervised.
  { hostRef: "ipad-byod-01", mdmEnrolled: true, supervised: false, diskEncryption: "on", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: fresh },
  // Stale check-in → freshness stale + raise step-up.
  { hostRef: "ipad-ward-05", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: stale },
  // Never seen → freshness missing + raise step-up (disk state unknown too).
  { hostRef: "ipad-ward-06", mdmEnrolled: true, supervised: true, diskEncryption: "unknown", lastSeenAt: null, osMajor: 26, osFloor: 26 },
  // Not MDM-enrolled at all → not managed + not enforceable + raise step-up.
  { hostRef: "iphone-personal-01", mdmEnrolled: false, supervised: false, diskEncryption: "unknown", lastSeenAt: old },
];
