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
  type AgentCheckInFreshness,
  type ComplianceCoverage,
  type DeviceManagementHealthReportRaw,
  type EnrollmentState,
  type RootCauseEvidence,
  type MdmCheckInFreshness,
  type NormalizedDeviceManagementHealth,
  type PolicyDrift,
  type RemediationHealth,
  type ReportIntegrity,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new DeviceManagementHealthConnectorError("read_only_violation", `device management health is read-only; refused ${method}`),
);

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
 *  `Object.create({ mdmCheckInFreshness: "fresh", ... })` asserts nothing and cannot grant,
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
 *  an untyped TypeError out of the normalizer.
 *
 *  Two of the three clauses are deliberately REDUNDANT, and saying so is the point —
 *  a reader should not have to mutation-test the file to learn which conditions carry
 *  weight. `!Array.isArray` is belt-and-braces: an array already fails the key scan on
 *  its own `length`. `report !== Object.prototype` is NOT redundant, and it closes a
 *  real hole: the scan's loop condition is `o !== Object.prototype`, evaluated before
 *  the first iteration, so a report that IS `Object.prototype` was never scanned at all
 *  and a polluted prototype normalized to a clean, granting verdict. The stop condition
 *  answers "have we reached the chain terminus", which is not the same question as
 *  "is this the report". */
function isPlainReport(report: unknown): report is object {
  // Three of these four clauses are REDUNDANT, established by mutation testing rather
  // than assumed, and labelled so a reader can tell defence-in-depth from load-bearing.
  // A primitive or a function reaching the scan makes `Reflect.ownKeys` throw or return
  // unrecognized keys; `hasOwnProperty.call(null, …)` throws into the wrapped read and
  // sets `readFailed`; an array fails the scan on its own `length`. Every one ends at
  // `malformed` regardless. They are kept because "the transport contract is a plain
  // JSON object" is the rule, and each states one clause of it plainly.
  //
  // `report !== Object.prototype` is the exception and is genuinely load-bearing: the
  // scan's stop condition is `o !== Object.prototype`, evaluated before the first
  // iteration, so a report that IS the prototype was never scanned at all and a polluted
  // prototype normalized to clean and granted.
  return (
    typeof report === "object" &&
    report !== null &&
    !Array.isArray(report) &&
    report !== Object.prototype
  );
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
        // Redundant by construction — `known` holds only strings, so the
        // `includes` below already rejects every symbol. Kept as an explicit
        // statement of intent so a future edit that widens `known` cannot quietly
        // start accepting symbol keys, and flagged as redundant so nobody mistakes
        // it for a load-bearing guard.
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

const MDM_CHECK_IN = ["fresh", "stale", "never", "unknown"] as const;
const AGENT_CHECK_IN = ["fresh", "stale", "never", "not_applicable", "unknown"] as const;
const REMEDIATION = ["healthy", "issues_detected", "failed", "not_applicable", "unknown"] as const;
const DRIFT = ["on_baseline", "drifted", "unknown"] as const;
const COVERAGE = ["covered", "uncovered", "unknown"] as const;
const ENROLLMENT = ["enrolled", "failed", "retired", "unknown"] as const;
const ROOT_CAUSE_EVIDENCE = ["available", "unavailable", "not_supported", "unknown"] as const;

/** Normalize a management-health report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown/null, never a fabricated "fresh"/"enrolled". */
export function normalizeReport(
  deviceId: string,
  report: DeviceManagementHealthReportRaw,
  source = "device-management-health-bridge",
): NormalizedDeviceManagementHealth {
  // Every read is OWN-ONLY — see `ownValue`.
  //
  // The reads are wrapped because a property can be an ACCESSOR that throws. `isPlainReport`
  // exists so a non-object fails closed rather than throwing an untyped TypeError out of
  // the normalizer, and `hasUnrecognizedKey` catches for the same reason; leaving these
  // seven reads unguarded left the one hole in that story, where an own getter would
  // propagate a bare `Error` out of `fetchHealth` instead of a typed connector error. A
  // report we could not even read the fields of is unreadable by definition, so it lands
  // where every unreadable report lands: all values absent, integrity malformed.
  const plain = isPlainReport(report);
  let readFailed = false;
  const read = (key: string): unknown => {
    if (!plain) return undefined;
    try {
      return ownValue(report, key);
    } catch {
      readFailed = true;
      return undefined;
    }
  };
  const raw = {
    mdmCheckInFreshness: read("mdmCheckInFreshness"),
    agentCheckInFreshness: read("agentCheckInFreshness"),
    remediationHealth: read("remediationHealth"),
    policyDrift: read("policyDrift"),
    complianceCoverage: read("complianceCoverage"),
    enrollmentState: read("enrollmentState"),
    managementReachable: read("managementReachable"),
    rootCauseEvidence: read("rootCauseEvidence"),
  };

  const mdmCheckInFreshness = oneOf<MdmCheckInFreshness>(raw.mdmCheckInFreshness, MDM_CHECK_IN, "unknown");
  const agentCheckInFreshness = oneOf<AgentCheckInFreshness>(raw.agentCheckInFreshness, AGENT_CHECK_IN, "unknown");
  const remediationHealth = oneOf<RemediationHealth>(raw.remediationHealth, REMEDIATION, "unknown");
  const policyDrift = oneOf<PolicyDrift>(raw.policyDrift, DRIFT, "unknown");
  const complianceCoverage = oneOf<ComplianceCoverage>(raw.complianceCoverage, COVERAGE, "unknown");
  const enrollmentState = oneOf<EnrollmentState>(raw.enrollmentState, ENROLLMENT, "unknown");
  // Absent normalizes to "unknown" — every bridge written before this field existed
  // keeps working and simply reports that it does not say. "unknown" is graded as
  // "no evidence", so silence never buys a diagnosis.
  const rootCauseEvidence = oneOf<RootCauseEvidence>(raw.rootCauseEvidence, ROOT_CAUSE_EVIDENCE, "unknown");

  const malformed =
    !plain ||
    readFailed ||
    hasUnrecognizedKey(report, DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS) ||
    enumMalformed(raw.mdmCheckInFreshness, MDM_CHECK_IN) ||
    enumMalformed(raw.agentCheckInFreshness, AGENT_CHECK_IN) ||
    enumMalformed(raw.remediationHealth, REMEDIATION) ||
    enumMalformed(raw.policyDrift, DRIFT) ||
    enumMalformed(raw.complianceCoverage, COVERAGE) ||
    enumMalformed(raw.enrollmentState, ENROLLMENT) ||
    enumMalformed(raw.rootCauseEvidence, ROOT_CAUSE_EVIDENCE) ||
    boolMalformed(raw.managementReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // NOTE — there is deliberately no "consistency guard" here demoting `on_baseline` /
  // `covered` to `unknown` when the device has never checked in. An earlier draft had
  // one, on the reasoning that those claims are derived from a check-in that never
  // happened. Measured over the full raw space it changed the recommended action on
  // ZERO reports and grant-ness on ZERO reports — `never` already denies on its own —
  // while changing the reason code on eight, in every case replacing a specific
  // diagnosis with a generic one. Worse, by rewriting `policyDrift` it made
  // `MDM_CHECKIN_NEVER` unreachable at the wire layer entirely: the dimension's motivating
  // case, a ward iPad that stopped checking in, could not be NAMED by its own verdict.
  // A guard that buys no safety and costs the operator the reason is not worth having.
  //
  // The same reasoning governs the two channel fields: a report claiming the device has
  // no agent channel while also reporting a state only that channel can produce is
  // self-contradictory, and self-contradictory input must never grant — but the
  // normalizer does not resolve it by rewriting either value. It reports both, and the
  // EVALUATOR raises the contradiction as its own candidate with its own reason code.
  // Rewriting here would erase the very fields an operator needs to see to know which
  // side of the report to fix.

  return {
    sourceSystem: "device-management-health",
    deviceId,
    mdmCheckInFreshness,
    agentCheckInFreshness,
    remediationHealth,
    policyDrift,
    complianceCoverage,
    enrollmentState,
    rootCauseEvidence,
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

  /**
   * NOTE ON `status: null`. The success path returns null, NOT 200.
   *
   * This connector is handed an INJECTED transport that resolves a payload — there is
   * no HTTP response here and therefore no status code to read. The old `status: 200`
   * was invented: a 201, 202 or 204 upstream reported as 200, and a reviewer reading
   * the field believed a server had said it. `null` is the honest value — "the
   * transport resolved; no status was observed" — and the type can now say it.
   *
   * The failure path keeps a real number because the error carries one.
   *
   * NOT FIXED HERE, and stated so the remaining gap is not mistaken for closed:
   * `healthy: true` still means "the injected transport resolved", which in fixture
   * mode is true without anything being contacted. That fix belongs at the resolution
   * layer, which already reports `mode: "fixture"` with a reason — see the backlog.
   */
  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number | null }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: null };
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
