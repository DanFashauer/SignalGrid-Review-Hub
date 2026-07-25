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

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, so it must not read as a confirmation:
 *  `Object.create({ checkInFreshness: "fresh", ... })` asserts nothing and cannot grant,
 *  and a polluted `Object.prototype` is invisible here. This governs READS only — the
 *  unrecognized-key scan below still walks the chain, because an inherited key is an
 *  assertion even though its value is not read. A Proxy that hides its own descriptors
 *  reads as ABSENT, which denies. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? `Reflect.ownKeys` throws on a primitive,
 *  and the transport is injectable, so a non-object must fail closed rather than throw
 *  an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report);
}

/** Depth bound for the prototype scan below. A Proxy may return a fresh object from
 *  `getPrototypeOf` on every call, so the walk must be bounded rather than trusting it
 *  to terminate. Exceeding the bound means we could not establish what the report
 *  carries — which is a failure to understand it, so it fails closed. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand?
 *
 *  This scan walks the PROTOTYPE CHAIN even though every VALUE read is own-only, and the
 *  asymmetry is deliberate — an earlier revision collapsed the two and reopened a hole.
 *  Reading own-only is right: an inherited value is the prototype's claim, not this
 *  report's, so it must not be usable as a confirmation. But *scanning* own-only is
 *  wrong: an inherited `agent_registered` is still a governance assertion in a spelling
 *  we ignore, and this scan is the only thing that notices it. Narrowing both together
 *  let a report grant while ordinary property access on that same object answered
 *  `report.agent_registered === false`.
 *
 *  A symbol key counts. A class instance fails closed (its prototype carries
 *  `constructor`) — deliberate: the transport contract is a plain JSON object. A
 *  `JSON.parse` result is unaffected, since its prototype is `Object.prototype` and the
 *  walk stops there. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        // Beyond the report's own level, ANY key is unrecognized — including one we
        // understand. This is the sharp edge an earlier revision got wrong by flagging
        // only misspelled inherited keys. A correctly-spelled inherited `agentRegistered`
        // is a STRONGER assertion than a misspelled one, not a weaker one, and because
        // values are read own-only it would otherwise be asserted by the report and
        // read by nobody: `report.agentRegistered === true` while the verdict grants.
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    // A hostile Proxy can throw from `ownKeys` or `getPrototypeOf`. We learned nothing.
    return true;
  }
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
  // Every read is OWN-ONLY — see `ownValue`.
  const plain = isPlainReport(report);
  const raw = {
    checkInFreshness: plain ? ownValue(report, "checkInFreshness") : undefined,
    policyDrift: plain ? ownValue(report, "policyDrift") : undefined,
    complianceCoverage: plain ? ownValue(report, "complianceCoverage") : undefined,
    enrollmentState: plain ? ownValue(report, "enrollmentState") : undefined,
    managementReachable: plain ? ownValue(report, "managementReachable") : undefined,
  };

  const checkInFreshness = oneOf<CheckInFreshness>(raw.checkInFreshness, CHECK_IN, "unknown");
  const policyDrift = oneOf<PolicyDrift>(raw.policyDrift, DRIFT, "unknown");
  const complianceCoverage = oneOf<ComplianceCoverage>(raw.complianceCoverage, COVERAGE, "unknown");
  const enrollmentState = oneOf<EnrollmentState>(raw.enrollmentState, ENROLLMENT, "unknown");

  const malformed =
    !plain ||
    hasUnrecognizedKey(report, DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS) ||
    enumMalformed(raw.checkInFreshness, CHECK_IN) ||
    enumMalformed(raw.policyDrift, DRIFT) ||
    enumMalformed(raw.complianceCoverage, COVERAGE) ||
    enumMalformed(raw.enrollmentState, ENROLLMENT) ||
    boolMalformed(raw.managementReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // NOTE — there is deliberately no "consistency guard" here demoting `on_baseline` /
  // `covered` to `unknown` when the device has never checked in. An earlier draft had
  // one, on the reasoning that those claims are derived from a check-in that never
  // happened. Measured over the full raw space it changed the recommended action on
  // ZERO reports and grant-ness on ZERO reports — `never` already denies on its own —
  // while changing the reason code on eight, in every case replacing a specific
  // diagnosis with a generic one. Worse, by rewriting `policyDrift` it made
  // `CHECKIN_NEVER` unreachable at the wire layer entirely: the dimension's motivating
  // case, a ward iPad that stopped checking in, could not be NAMED by its own verdict.
  // A guard that buys no safety and costs the operator the reason is not worth having.

  return {
    sourceSystem: "device-management-health",
    deviceId,
    checkInFreshness,
    policyDrift,
    complianceCoverage,
    enrollmentState,
    managementReachable: boolOrNull(raw.managementReachable),
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
