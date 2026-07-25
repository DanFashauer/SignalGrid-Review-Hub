// Read-only normalization + transport for the device-management-health connector.
//
// The source is a management-plane bridge (Intune / Microsoft Graph-class, or any MDM
// exposing device check-in, enrollment, policy-assignment and configuration state)
// that has already evaluated the device. This connector normalizes that evaluated
// result. Every operation here is a read; there is no write path — it enrolls no
// device, assigns no policy, pushes no profile, and wipes nothing.

import {
  DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS,
  DeviceManagementHealthConnectorError,
  type CheckInFreshness,
  type ComplianceCoverage,
  type DeviceManagementHealthReportRaw,
  type EnrollmentState,
  type NormalizedDeviceManagementHealth,
  type PolicyDrift,
  type ReportIntegrity,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new DeviceManagementHealthConnectorError(
      "read_only_violation",
      `device management health is read-only; refused ${method}`,
    );
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Did the report ASSERT something here that we could not parse?
 *
 *  `oneOf` and `boolOrNull` are lossy by design — they collapse "absent" and
 *  "unreadable" into one sentinel. That is right for choosing a value and wrong for
 *  deciding whether the report was UNDERSTOOD. Presence, not parsed value, is what
 *  makes something an assertion. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  // `null` counts as ABSENT, matching `boolMalformed`. It is the standard wire spelling
  // of "no value", and a bridge emitting a fixed row shape with nulls rather than
  // omitting keys is being honest, not unreadable.
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** Does the report carry any key this connector does not understand?
 *
 *  Walks the PROTOTYPE CHAIN and uses `Reflect.ownKeys`, not `Object.keys`. The shipped
 *  HTTP transport hands us a `JSON.parse` result where every key is an own enumerable
 *  string, but the transport is injectable — an in-process adapter may return a class
 *  instance or a Proxy, and an assertion hiding on the prototype, behind
 *  `enumerable: false`, or under a symbol would otherwise be invisible. A class instance
 *  fails closed; the transport contract is a plain JSON object. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  for (let o: object | null = report; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const k of Reflect.ownKeys(o)) {
      if (typeof k === "symbol") return true;
      if (!known.includes(k)) return true;
    }
  }
  return false;
}

const CHECK_IN = ["fresh", "stale", "never", "unknown"] as const;
const DRIFT = ["on_baseline", "drifted", "unknown"] as const;
const COVERAGE = ["covered", "uncovered", "unknown"] as const;
const ENROLLMENT = ["enrolled", "failed", "retired", "unknown"] as const;

/** Normalize a management-health report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown/null, never a fabricated "fresh"/"enrolled". */
export function normalizeReport(
  deviceId: string,
  report: DeviceManagementHealthReportRaw,
  source = "device-management-health-bridge",
): NormalizedDeviceManagementHealth {
  const checkInFreshness = oneOf<CheckInFreshness>(report.checkInFreshness, CHECK_IN, "unknown");
  let policyDrift = oneOf<PolicyDrift>(report.policyDrift, DRIFT, "unknown");
  let complianceCoverage = oneOf<ComplianceCoverage>(report.complianceCoverage, COVERAGE, "unknown");
  const enrollmentState = oneOf<EnrollmentState>(report.enrollmentState, ENROLLMENT, "unknown");

  const unknownKey = hasUnrecognizedKey(report, DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS);
  const malformed =
    unknownKey ||
    enumMalformed(report.checkInFreshness, CHECK_IN) ||
    enumMalformed(report.policyDrift, DRIFT) ||
    enumMalformed(report.complianceCoverage, COVERAGE) ||
    enumMalformed(report.enrollmentState, ENROLLMENT) ||
    boolMalformed(report.managementReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // Self-consistency. Both of these positive claims are DERIVED from the device having
  // reported: a device that has never checked in cannot have been observed on its
  // baseline, and a device whose enrollment failed or was retired is not in scope of a
  // compliance policy however the bridge summarized it. Where the claim is unfounded we
  // demote it to `unknown`.
  //
  // This only ever DOWNGRADES. A guard that could also promote `unknown` → `covered`
  // when the surrounding fields looked agreeable would be manufacturing the very
  // confirmation the grant is supposed to demand.
  if (checkInFreshness === "never") {
    if (policyDrift === "on_baseline") policyDrift = "unknown";
    if (complianceCoverage === "covered") complianceCoverage = "unknown";
  }
  if ((enrollmentState === "failed" || enrollmentState === "retired") && complianceCoverage === "covered") {
    complianceCoverage = "unknown";
  }

  return {
    sourceSystem: "device-management-health",
    deviceId,
    checkInFreshness,
    policyDrift,
    complianceCoverage,
    enrollmentState,
    managementReachable: boolOrNull(report.managementReachable),
    reportIntegrity,
    source,
  };
}

export interface DeviceManagementHealthRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated management health from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type DeviceManagementHealthTransport = (
  req: DeviceManagementHealthRequest,
) => Promise<DeviceManagementHealthReportRaw>;

export interface DeviceManagementHealthConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class DeviceManagementHealthConnector {
  constructor(
    private readonly config: DeviceManagementHealthConnectorConfig,
    private readonly transport: DeviceManagementHealthTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof DeviceManagementHealthConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchHealth(deviceId: string): Promise<NormalizedDeviceManagementHealth> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
