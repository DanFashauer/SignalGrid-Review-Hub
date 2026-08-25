import {
  GraphConnectorError,
  type DeviceComplianceState,
  type DeviceManagementState,
  type DeviceRegistrationState,
  type GraphCollection,
  type GraphManagedDeviceRaw,
  type GraphPostureSignal,
  type GraphUserRaw,
  type IdentityStatus,
  type UserRisk,
} from "./types";

/**
 * Read-only Microsoft Graph posture connector.
 *
 * Reads identity + device posture from Microsoft Graph and normalizes it into
 * SignalGrid's posture vocabulary. It is READ-ONLY by construction — every path
 * goes through `get()`, which hard-codes the GET method and runs a read-only
 * guard, so a non-GET request throws instead of ever mutating a customer's
 * tenant. The HTTP transport is INJECTED, which lets the proof exercise real
 * request/response/pagination/error flow offline against a deterministic mock,
 * with no network and no live tenant.
 */

export interface GraphRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}

export interface GraphHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

export type GraphTransport = (req: GraphRequest) => Promise<GraphHttpResponse>;

export interface GraphConnectorConfig {
  /** Bearer access token with READ-ONLY Graph scopes (e.g. User.Read.All, DeviceManagementManagedDevices.Read.All). */
  accessToken: string;
  /** Graph base URL. Default the v1.0 endpoint. */
  baseUrl?: string;
  /** Hard cap on pages followed via `@odata.nextLink` (loop/DoS guard). Default 50. */
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never write. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new GraphConnectorError(
      "read_only_violation",
      `The Graph posture connector is read-only; refused a ${method} request.`,
    );
  }
}

export class GraphPostureConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: GraphTransport;

  constructor(config: GraphConnectorConfig, transport: GraphTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  /** Cheap read to confirm the token + scopes work. Never throws — reports health. */
  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/deviceManagement/managedDevices?$top=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  /** Read all users, following pagination up to `pageLimit`. */
  async listUsers(): Promise<GraphUserRaw[]> {
    return this.getAllPages<GraphUserRaw>(
      `${this.baseUrl}/users?$select=id,userPrincipalName,accountEnabled`,
    );
  }

  /** Read all managed devices, following pagination up to `pageLimit`. */
  async listManagedDevices(): Promise<GraphManagedDeviceRaw[]> {
    return this.getAllPages<GraphManagedDeviceRaw>(
      `${this.baseUrl}/deviceManagement/managedDevices`,
    );
  }

  /**
   * Read users + devices and emit one normalized posture signal per managed
   * device, joined to its owning user. `observedAt` is injected so the emitted
   * provenance is deterministic in tests.
   */
  async fetchPosture(observedAt: string): Promise<GraphPostureSignal[]> {
    const [users, devices] = await Promise.all([this.listUsers(), this.listManagedDevices()]);
    const userById = new Map<string, GraphUserRaw>();
    const userByUpn = new Map<string, GraphUserRaw>();
    for (const u of users) {
      userById.set(u.id, u);
      if (u.userPrincipalName) userByUpn.set(u.userPrincipalName.toLowerCase(), u);
    }

    return devices.map((device) => {
      const user =
        (device.userId ? userById.get(device.userId) : undefined) ??
        (device.userPrincipalName ? userByUpn.get(device.userPrincipalName.toLowerCase()) : undefined);
      const subjectId = user?.id ?? device.userId ?? device.userPrincipalName ?? "unknown";
      return {
        sourceSystem: "microsoft-graph",
        correlationId: `${subjectId}:${device.id}`,
        observedAt,
        subjectId,
        identityStatus: normalizeIdentityStatus(user?.accountEnabled),
        userRisk: normalizeUserRisk(user?.riskLevel),
        deviceId: device.id,
        deviceComplianceState: normalizeCompliance(device.complianceState),
        deviceManagementState: normalizeManagement(device.managementState, device.managementAgent),
        deviceRegistrationState: normalizeRegistration(device.deviceRegistrationState),
        deviceLastSeenAt: device.lastSyncDateTime ?? null,
      };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) {
        throw errorFor(res.status);
      }
      let body: GraphCollection<T>;
      try {
        body = (await res.json()) as GraphCollection<T>;
      } catch {
        throw new GraphConnectorError("bad_response", "Graph response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new GraphConnectorError("bad_response", "Graph collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body["@odata.nextLink"];
      pages += 1;
    }
    // Exiting the cap with a next-page cursor still in hand means the inventory is
    // INCOMPLETE, and a short list is indistinguishable from a complete one. Refuse
    // rather than pass a partial inventory off as a whole one; the cap itself stays,
    // because it is the loop/DoS guard against an endless cursor.
    if (url) {
      throw new GraphConnectorError(
        "incomplete_read",
        `Graph read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<GraphHttpResponse> {
    const req: GraphRequest = {
      method: "GET",
      url,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: "application/json",
      },
    };
    // Belt-and-braces: prove at runtime that we only ever issue reads.
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): GraphConnectorError {
  if (status === 401 || status === 403) {
    return new GraphConnectorError("auth_failed", `Graph returned ${status} — token or scope is insufficient.`, status);
  }
  return new GraphConnectorError("upstream_error", `Graph returned HTTP ${status}.`, status);
}

function normalizeIdentityStatus(accountEnabled: boolean | undefined): IdentityStatus {
  if (accountEnabled === true) return "enabled";
  if (accountEnabled === false) return "disabled";
  return "unknown";
}

function normalizeUserRisk(riskLevel: string | undefined): UserRisk {
  switch ((riskLevel ?? "").toLowerCase()) {
    case "none":
      return "none";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "unknown";
  }
}

function normalizeCompliance(state: string | undefined): DeviceComplianceState {
  switch ((state ?? "").toLowerCase()) {
    case "compliant":
      return "compliant";
    case "noncompliant":
    case "non_compliant":
      return "non_compliant";
    case "ingraceperiod":
    case "in_grace_period":
      return "in_grace_period";
    case "":
    case "unknown":
      return "missing";
    default:
      return "unknown";
  }
}

/**
 * Microsoft Graph `managementAgent` values that establish MDM enrollment.
 *
 * Deliberately an ALLOWLIST, and deliberately conservative: an agent this set does
 * not name yields "unknown" rather than "managed", which `posture-composition`
 * grades as step_up. Being wrong in that direction costs a challenge; being wrong
 * the other way admits an unmanaged device. Notably ABSENT and absent on purpose —
 * `eas` (ActiveSync only), `msSense` (Defender sensor) and `configurationManagerClient`
 * (SCCM without an MDM channel), none of which mean the device is MDM-managed.
 */
const MDM_ENROLLMENT_AGENTS = new Set([
  "mdm",
  "easmdm",
  "intuneclient",
  "configurationmanagerclientmdm",
  "configurationmanagerclientmdmeas",
  "microsoft365managedmdm",
  "googleclouddevicepolicycontroller",
  "jamf",
]);

function normalizeManagement(
  state: string | undefined,
  agent: string | undefined,
): DeviceManagementState {
  const s = (state ?? "").toLowerCase();
  const a = (agent ?? "").toLowerCase();
  if (s === "retirepending" || s === "retire_pending") return "retire_pending";
  if (s === "unmanaged" || a === "unknown") return "unmanaged";
  if (s === "managed") return "managed";
  // No explicit state. An agent NAME may still establish MDM enrollment — but only
  // if it is one of the agents that actually denotes it.
  //
  // This was `if (s === "" && a !== "") return "managed"`, and any non-empty string
  // earned the affirmative. Graph's own vocabulary makes that unsound: `eas` is
  // ActiveSync only and `msSense` is the Defender sensor — BOTH mean the device is
  // NOT MDM-managed — and a typo qualified just as well. Adding one arbitrary
  // string to one optional field moved a device from step_up to allow. The four
  // sibling normalizers in this file all fall through to "unknown" on silence;
  // this was the one that did not.
  if (s === "" && MDM_ENROLLMENT_AGENTS.has(a)) return "managed";
  return "unknown";
}

function normalizeRegistration(state: string | undefined): DeviceRegistrationState {
  switch ((state ?? "").toLowerCase()) {
    case "registered":
      return "registered";
    case "notregistered":
    case "not_registered":
      return "not_registered";
    default:
      return "unknown";
  }
}
