// Omnissa Workspace ONE UEM → normalized UEM device state. READ-ONLY and PURE.
//
// WHAT WAS REMOVED. Tag writes, quarantine/unquarantine and a generic command
// sender, all ungated. Same reasoning as jamf.ts and intune.ts.
//
// WIRE FORMAT, corrected against the published Workspace ONE UEM 2604 API
// specification. The previous implementation had eight defects that would each have
// produced a 404 or a silently wrong field. They are recorded here because the
// fixes are invisible otherwise, and because the ORDER mattered: they were left in
// place until this connector had a gate and a proof, since correcting them first
// would have converted "visibly wrong" into "plausibly wrong but still untested".
//
//   1. base path was `/api/v1/mdm` — the spec's `basePath` is `/api/mdm`
//   2. `searchBy` query parameter — the spec spells it lowercase `searchby`
//   3. `data.Devices[0]` off `GET /devices` — that endpoint returns a SINGLE
//      `Device` object; the `{ Devices: [...] }` wrapper belongs to `/devices/search`
//   4. `DeviceUUID` does not exist — the canonical fields are `Uuid` and `Udid`
//   5. `OSVersion` does not exist — it is `OperatingSystem`
//   6. `DeviceGroups` does not exist — the organisation group is `LocationGroupName`
//   7. tenant header was `aw-tenant-identifier` — the spec's header is `aw-tenant-code`
//   8. the commands endpoint takes `command` as a required QUERY parameter, not a
//      `{commandType}` body — moot here, since the command path is deleted entirely
//
// These are release-independent: the specification is byte-identical across all six
// published releases, so nothing here is pinned to 2604 and there is no version to
// go stale.

import type {
  NormalizedUemDeviceState,
  UemCompliance,
  UemEnrollment,
  UemSupervision,
} from "./types";

/** Canonical Workspace ONE `Device` fields this reads. All optional by design. */
export interface WorkspaceOneDevicePayload {
  readonly Uuid?: unknown;
  readonly Udid?: unknown;
  readonly EnrollmentStatus?: unknown;
  readonly ComplianceStatus?: unknown;
  readonly IsSupervised?: unknown;
  readonly OperatingSystem?: unknown;
  readonly LocationGroupName?: unknown;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * Workspace ONE `EnrollmentStatus`.
 *
 * The wipe/unenrol-pending states are teardown, so they map to `retired` for the
 * same reason Intune's do: management is ending and the posture it reports is about
 * to stop being maintained. `Discovered` and `Registered` are seen-but-not-managed.
 * Anything unrecognised is `unknown`, never a pass.
 */
function enrollmentFrom(raw: unknown): UemEnrollment {
  switch (asString(raw)?.toLowerCase()) {
    case "enrolled":
      return "enrolled";
    case "unenrolled":
    case "discovered":
    case "registered":
      return "not_enrolled";
    case "enterprisewipepending":
    case "devicewipepending":
    case "unenrollmentpending":
      return "retired";
    default:
      return "unknown";
  }
}

/**
 * Workspace ONE `ComplianceStatus`.
 *
 * `NotAvailable` means no compliance policy result exists for the device — an
 * absence of evidence, mapped to `not_evaluated` rather than to a pass. This is the
 * same distinction the Jamf normalizer now makes explicit.
 */
function complianceFrom(raw: unknown): UemCompliance {
  switch (asString(raw)?.toLowerCase()) {
    case "compliant":
      return "compliant";
    case "noncompliant":
    case "non-compliant":
      return "non_compliant";
    case "notavailable":
      return "not_evaluated";
    default:
      return "unknown";
  }
}

export function normalizeWorkspaceOneDevice(
  raw: WorkspaceOneDevicePayload,
): NormalizedUemDeviceState {
  // `Uuid` preferred, `Udid` as the documented fallback — both are canonical, and
  // the field the old code read (`DeviceUUID`) is neither.
  const deviceId = asString(raw?.Uuid) ?? asString(raw?.Udid);
  if (deviceId === null) {
    return {
      deviceId: "",
      vendor: "workspace-one",
      enrollment: "unknown",
      compliance: "unknown",
      supervision: "unknown",
      osVersion: null,
      lastCheckInAgeSeconds: null,
      reportIntegrity: "malformed",
    };
  }

  const supervised = typeof raw.IsSupervised === "boolean" ? raw.IsSupervised : null;
  const supervision: UemSupervision =
    supervised === true ? "supervised" : supervised === false ? "unsupervised" : "unknown";

  return {
    deviceId,
    vendor: "workspace-one",
    enrollment: enrollmentFrom(raw.EnrollmentStatus),
    compliance: complianceFrom(raw.ComplianceStatus),
    supervision,
    osVersion: asString(raw.OperatingSystem),
    lastCheckInAgeSeconds: null,
    reportIntegrity: "intact",
  };
}

/** Canonical request shape for a read, exported so the gate and any future live
 *  transport share ONE definition of the corrected wire format rather than each
 *  re-deriving it. No function here performs a request. */
export const WORKSPACE_ONE_READ_CONTRACT = {
  basePath: "/api/mdm",
  deviceByIdPath: "/devices",
  deviceSearchPath: "/devices/search",
  /** lowercase, per the specification */
  searchByParam: "searchby",
  tenantHeader: "aw-tenant-code",
  /** `/devices` returns a single Device; only `/devices/search` wraps in `Devices`. */
  searchResponseArrayKey: "Devices",
} as const;
