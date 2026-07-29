// Microsoft Intune (Graph `managedDevices`) → normalized UEM device state.
// READ-ONLY and PURE.
//
// WHAT WAS REMOVED. This file previously exposed remote-lock (`POST
// .../microsoft.graph.remoteLock`), passcode-bypass, tag writes and a generic
// command sender, all ungated. Deleted for the reason set out in jamf.ts: a
// device-lock actuator has no read-only-disciplined form, and AGENTS.md requires
// high-risk actions to be simulated and approval-required.

import type {
  NormalizedUemDeviceState,
  UemCompliance,
  UemEnrollment,
  UemOwnership,
  UemSupervision,
} from "./types";

/** The subset of a Graph `managedDevice` this reads. All optional by design. */
export interface IntuneManagedDevicePayload {
  readonly id?: unknown;
  readonly complianceState?: unknown;
  readonly managementState?: unknown;
  readonly isSupervised?: unknown;
  readonly osVersion?: unknown;
  /** Graph `managedDeviceOwnerType`: `unknown` | `company` | `personal`. */
  readonly managedDeviceOwnerType?: unknown;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * Graph's `complianceState` enum, mapped without inventing members.
 *
 * `conflict` and `error` map to `unknown` rather than to a failure: they mean Intune
 * could not reach a verdict, which is ignorance, not a finding. `notApplicable` and
 * `configManager` mean no Intune policy was evaluated — `not_evaluated`, which the
 * evaluator steps up on. Any unrecognised member falls to `unknown`, so a new Graph
 * enum value cannot silently arrive as a pass.
 */
function complianceFrom(raw: unknown): UemCompliance {
  switch (asString(raw)?.toLowerCase()) {
    case "compliant":
      return "compliant";
    case "noncompliant":
      return "non_compliant";
    case "ingraceperiod":
      return "in_grace_period";
    case "notapplicable":
    case "configmanager":
      return "not_evaluated";
    default:
      return "unknown";
  }
}

/**
 * Graph's `managementState` enum.
 *
 * Every teardown state (`retirePending`, `wipePending`, and their issued/failed
 * variants) maps to `retired`: management is ending, so the posture this device
 * reports is about to stop being maintained. `discovered` means seen but not fully
 * enrolled, which is affirmatively not-enrolled. Unrecognised members fall to
 * `unknown` — this is the exact set the Graph posture adapter silently dropped
 * before the fix in #149, and dropping them is what made an unreadable device read
 * as compliant and managed.
 */
function enrollmentFrom(raw: unknown): UemEnrollment {
  const s = asString(raw)?.toLowerCase();
  if (s === undefined || s === null) return "unknown";
  if (s === "managed") return "enrolled";
  if (s === "discovered") return "not_enrolled";
  if (s.startsWith("retire") || s.startsWith("wipe")) return "retired";
  return "unknown";
}

/**
 * Graph's `managedDeviceOwnerType` enum — `unknown` | `company` | `personal`.
 *
 * Graph spells the corporate case "company"; the fabric calls it `corporate`, so the
 * rename happens here rather than leaking a vendor word into the decision core. The
 * enum's own `unknown` member and any unrecognised value both fall to `unknown` —
 * deliberately NOT to `personal`, which would silently excuse an unsupervised
 * corporate device (see UemOwnership).
 */
function ownershipFrom(raw: unknown): UemOwnership {
  switch (asString(raw)?.toLowerCase()) {
    case "company":
      return "corporate";
    case "personal":
      return "personal";
    default:
      return "unknown";
  }
}

export function normalizeIntuneDevice(raw: IntuneManagedDevicePayload): NormalizedUemDeviceState {
  const deviceId = asString(raw?.id);
  if (deviceId === null) {
    return {
      deviceId: "",
      vendor: "intune",
      enrollment: "unknown",
      compliance: "unknown",
      supervision: "unknown",
      ownership: "unknown",
      osVersion: null,
      lastCheckInAgeSeconds: null,
      reportIntegrity: "malformed",
    };
  }

  const supervised = typeof raw.isSupervised === "boolean" ? raw.isSupervised : null;
  const supervision: UemSupervision =
    supervised === true ? "supervised" : supervised === false ? "unsupervised" : "unknown";

  return {
    deviceId,
    vendor: "intune",
    enrollment: enrollmentFrom(raw.managementState),
    compliance: complianceFrom(raw.complianceState),
    supervision,
    ownership: ownershipFrom(raw.managedDeviceOwnerType),
    osVersion: asString(raw.osVersion),
    lastCheckInAgeSeconds: null,
    reportIntegrity: "intact",
  };
}
