// Deterministic fixture reports for the device-management-health connector's
// FIXTURE MODE. Synthetic and public-safe throughout — no tenant, no MDM, no
// network. The three devices cover the three states the core's
// `device_management_health` signal can meaningfully take from this family:
//
//   ipad-ward-01    — the seven-way positive confirmation → managed_healthy
//   ipad-ward-02    — MDM channel gone stale → step_up (degraded, not broken)
//   ipad-retired-99 — retired in the MDM but still in someone's hands → restrict
//
// The agent-channel field is `not_applicable` on all three ON PURPOSE: these are
// iPads, and iPadOS has no Intune Management Extension, so asserting the channel's
// absence is the honest platform answer (silence would normalize to `unknown` and
// deny a healthy device).

import { createMockDeviceManagementHealthTransport } from "./mock-transport";
import { DeviceManagementHealthConnector } from "./device-management-health-connector";
import type { DeviceManagementHealthReportRaw } from "./types";

/** Obviously-fake token the fixture transport expects. Never a real secret. */
export const FIXTURE_DEVICE_MANAGEMENT_HEALTH_TOKEN = "fixture-demo-token-not-a-secret";

export const FIXTURE_DEVICE_MANAGEMENT_HEALTH_REPORTS: Readonly<
  Record<string, DeviceManagementHealthReportRaw>
> = {
  "ipad-ward-01": {
    mdmCheckInFreshness: "fresh",
    agentCheckInFreshness: "not_applicable",
    remediationHealth: "not_applicable",
    policyDrift: "on_baseline",
    complianceCoverage: "covered",
    enrollmentState: "enrolled",
    managementReachable: true,
  },
  "ipad-ward-02": {
    mdmCheckInFreshness: "stale",
    agentCheckInFreshness: "not_applicable",
    remediationHealth: "not_applicable",
    policyDrift: "on_baseline",
    complianceCoverage: "covered",
    enrollmentState: "enrolled",
    managementReachable: true,
  },
  "ipad-retired-99": {
    mdmCheckInFreshness: "stale",
    agentCheckInFreshness: "not_applicable",
    remediationHealth: "not_applicable",
    policyDrift: "unknown",
    complianceCoverage: "covered",
    enrollmentState: "retired",
    managementReachable: true,
  },
};

/**
 * A WORKING, fully-offline device-management-health connector over the fixture
 * reports. Same class and same normalize/evaluate code paths as a live bridge
 * read — only the transport is the in-memory mock (bad token → 401, unknown
 * device → 404, never an invented healthy report).
 */
export function createFixtureDeviceManagementHealthConnector(): DeviceManagementHealthConnector {
  const transport = createMockDeviceManagementHealthTransport({
    reports: { ...FIXTURE_DEVICE_MANAGEMENT_HEALTH_REPORTS },
    expectedToken: FIXTURE_DEVICE_MANAGEMENT_HEALTH_TOKEN,
  });
  return new DeviceManagementHealthConnector(
    {
      accessToken: FIXTURE_DEVICE_MANAGEMENT_HEALTH_TOKEN,
      baseUrl: "fixture://device-management-health",
      source: "device-management-health-fixture",
    },
    transport,
  );
}
