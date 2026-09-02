// A REAL Microsoft Graph transport for the device-management-health dimension.
//
// WHY THIS EXISTS. This family is documented as the Intune/Graph management-plane
// dimension, and its only live transport pointed at
// `https://device-management-bridge.local/device-management-health` — a bespoke
// bridge that does not exist and that nobody has ever run. `graph` was the only
// family in the repository whose live transport actually addressed
// graph.microsoft.com. That gap is declared in the launch profile, and it is the
// concrete content of launch Blocker 5: the connector could not be pointed at a real
// tenant, because there was nothing to point it at.
//
// This transport talks to the real endpoint:
//
//     GET {baseUrl}/deviceManagement/managedDevices/{id}
//
// Read-only, by construction: one GET, no POST/PATCH/DELETE anywhere in this file.
// SignalGrid enrolls nothing, assigns no policy, pushes no profile and wipes nothing.
//
// ── WHAT ONE GRAPH CALL DOES NOT ANSWER, which is the finding ────────────────
//
// `DeviceManagementHealthReportRaw` has SEVEN axes. `managedDevices/{id}` answers
// five of them. It does NOT answer:
//
//   policyDrift        — needs deviceConfigurationStates / deviceCompliancePolicyStates
//                        per device (a separate call per policy, and a baseline to
//                        compare against that Graph does not hold).
//   remediationHealth  — needs deviceHealthScripts run states, a different resource
//                        under deviceManagement entirely.
//
// Both are returned as `"unknown"`. That is not a placeholder to fill in later — it
// is the correct answer, and the fail-closed law makes it the SAFE one: an unknown
// signal raises assurance, never lowers it. Mapping them to a plausible-looking value
// derived from `complianceState` would be inventing a measurement, and a fabricated
// axis that reads as measured is precisely the defect class this repository keeps
// finding in its own docs.
//
// A tenant-ready connector that honestly answers five of seven axes is worth more
// than one that appears to answer seven.
//
// ── DETERMINISM ──────────────────────────────────────────────────────────────
//
// Freshness is a comparison against a clock, and the decision core forbids
// `Date.now()` in decision paths. The clock is therefore a REQUIRED option with no
// default: a caller (and every proof) must supply it, so the same tenant response
// always produces the same report for a given instant.

import { ageMs } from "../../utils/freshness";
import { DeviceManagementHealthConnectorError, type DeviceManagementHealthReportRaw } from "./types";
import type { DeviceManagementHealthTransport } from "./device-management-health-connector";

/** The default Microsoft Graph v1.0 root. */
export const GRAPH_V1_ROOT = "https://graph.microsoft.com/v1.0";

/**
 * Exactly the `managedDevice` properties this mapping reads. Sent as `$select` so the
 * tenant returns nothing more than SignalGrid needs — data minimisation at the wire,
 * not after it.
 */
export const GRAPH_MANAGED_DEVICE_SELECT = [
  "id",
  "lastSyncDateTime",
  "complianceState",
  "managementState",
  "deviceRegistrationState",
  "managementAgent",
  "configurationManagerClientHealthState",
] as const;

export interface GraphDeviceManagementHealthOptions {
  /** Graph root. Defaults to the public v1.0 endpoint; override for a sovereign cloud. */
  baseUrl?: string;
  /**
   * REQUIRED, and deliberately has no default. Freshness is a comparison against a
   * clock; a hidden `Date.now()` here would make the connector non-deterministic and
   * unprovable. Proofs pass a fixed instant.
   */
  now: () => Date;
  /** A check-in older than this is `stale`. Intune's own default cadence is ~8h. */
  staleAfterHours?: number;
  /** Request timeout, ms. */
  timeoutMs?: number;
}

/** Freshness from a last-sync timestamp, or `unknown` when Graph gives us nothing usable. */
export function mapCheckInFreshness(lastSyncDateTime: unknown, now: Date, staleAfterHours: number): string {
  if (typeof lastSyncDateTime !== "string" || lastSyncDateTime.trim() === "") return "unknown";
  const t = Date.parse(lastSyncDateTime);
  if (!Number.isFinite(t)) return "unknown";
  // Graph returns the Unix epoch for a device that has never checked in.
  if (t <= 0) return "never";
  // A timestamp in the future is not "extremely fresh" — it is a clock or tenant
  // problem, and reading it as fresh would let a skewed device look healthy forever.
  // Tolerance 0: `now` is injected by the caller (`GraphTransportOptions.now`) for
  // determinism, so it is a posed reference, not a wall clock racing the tenant's.
  const age = ageMs(t, now.getTime(), 0);
  if (age === null) return "unknown";
  return age / 3_600_000 <= staleAfterHours ? "fresh" : "stale";
}

/**
 * Enrollment state. `managementState` and `deviceRegistrationState` disagree in real
 * tenants, so the MORE RESTRICTIVE answer wins — a device mid-retire is not enrolled
 * however it is registered.
 */
export function mapEnrollmentState(managementState: unknown, registrationState: unknown): string {
  const m = typeof managementState === "string" ? managementState : "";
  const r = typeof registrationState === "string" ? registrationState : "";
  if (/^(retirePending|retireFailed|retireIssued|retired|wipePending|wipeFailed|discovered)$/i.test(m)) return "retired";
  if (/^(revoked|notRegistered|unknown)$/i.test(r) && r !== "") return r.toLowerCase() === "unknown" ? "unknown" : "failed";
  if (/^(managed|retireCanceled|wipeCanceled)$/i.test(m) && /^registered$/i.test(r)) return "enrolled";
  if (m === "" && r === "") return "unknown";
  return "unknown";
}

/** Compliance coverage. `unknown`/`conflict`/`error` are NOT coverage. */
export function mapComplianceCoverage(complianceState: unknown): string {
  const c = typeof complianceState === "string" ? complianceState.toLowerCase() : "";
  if (c === "compliant" || c === "noncompliant" || c === "ingraceperiod") return "covered";
  if (c === "" || c === "unknown" || c === "conflict" || c === "error" || c === "configmanager") return "unknown";
  return "unknown";
}

/**
 * The agent channel is a SEPARATE plane from MDM check-in, and it does not always
 * apply: an MDM-only device has no Configuration Manager agent, and reporting that as
 * a broken agent would be a false signal on a correctly configured device.
 */
export function mapAgentFreshness(managementAgent: unknown, cmHealth: unknown): string {
  const agent = typeof managementAgent === "string" ? managementAgent.toLowerCase() : "";
  if (agent === "mdm" || agent === "eas" || agent === "easmdm" || agent === "intunecliententerprise") {
    return "not_applicable";
  }
  if (agent === "") return "unknown";
  const state = cmHealth && typeof cmHealth === "object" ? (cmHealth as Record<string, unknown>).state : undefined;
  if (typeof state !== "string" || state.trim() === "") return "unknown";
  return /^(healthy|installed)$/i.test(state) ? "fresh" : "stale";
}

/** Map a Graph `managedDevice` onto the connector's raw report. */
export function mapManagedDeviceToRaw(
  device: Record<string, unknown>,
  now: Date,
  staleAfterHours: number,
): DeviceManagementHealthReportRaw {
  return {
    mdmCheckInFreshness: mapCheckInFreshness(device.lastSyncDateTime, now, staleAfterHours),
    agentCheckInFreshness: mapAgentFreshness(device.managementAgent, device.configurationManagerClientHealthState),
    enrollmentState: mapEnrollmentState(device.managementState, device.deviceRegistrationState),
    complianceCoverage: mapComplianceCoverage(device.complianceState),
    // NOT ANSWERABLE from managedDevices/{id}. See the header. `unknown` is the
    // correct value and the fail-closed one; it raises assurance rather than
    // granting on a fabricated measurement.
    policyDrift: "unknown",
    remediationHealth: "unknown",
    // The call itself succeeded, so the management plane answered.
    managementReachable: true,
  };
}

/** Build a read-only Microsoft Graph transport for this dimension. */
export function makeGraphDeviceManagementHealthTransport(
  opts: GraphDeviceManagementHealthOptions,
): DeviceManagementHealthTransport {
  const root = (opts.baseUrl ?? GRAPH_V1_ROOT).replace(/\/+$/, "");
  const staleAfterHours = opts.staleAfterHours ?? 8;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const now = opts.now;
  if (typeof now !== "function") {
    throw new DeviceManagementHealthConnectorError(
      "bad_response",
      "graph transport requires an explicit `now` clock (determinism law: no hidden Date.now in a signal path)",
    );
  }

  return async ({ deviceId, token }) => {
    const url =
      `${root}/deviceManagement/managedDevices/${encodeURIComponent(deviceId)}` +
      `?$select=${GRAPH_MANAGED_DEVICE_SELECT.join(",")}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new DeviceManagementHealthConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `graph returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new DeviceManagementHealthConnectorError("bad_response", "graph returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new DeviceManagementHealthConnectorError("bad_response", "graph returned a non-object body", res.status);
    }
    return mapManagedDeviceToRaw(body as Record<string, unknown>, now(), staleAfterHours);
  };
}
