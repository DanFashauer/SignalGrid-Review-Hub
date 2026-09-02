import {
  NetworkConnectorError,
  type NetworkAuthState,
  type NetworkCollection,
  type NetworkPostureRaw,
  type NormalizedNetworkSignal,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/**
 * Read-only network / NAC posture connector. Reads per-device access state from a
 * NAC / LAN controller (Cisco ISE / Catalyst Center / Meraki, FortiNAC, Aruba
 * ClearPass / Central, Arista CloudVision) and normalizes it. READ-ONLY by
 * construction (GET-only, guarded) — it never quarantines, changes a VLAN, or
 * revokes a session; that stays an explicit, separately-authorized enforcement
 * action. Injectable transport for offline proofs.
 */

export interface NetworkRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface NetworkHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type NetworkTransport = (req: NetworkRequest) => Promise<NetworkHttpResponse>;

export interface NetworkConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never enforce/mutate. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new NetworkConnectorError("read_only_violation", `The network/NAC connector is read-only; refused a ${method} request.`),
);

export class NetworkNacConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: NetworkTransport;

  constructor(config: NetworkConnectorConfig, transport: NetworkTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.nac.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/sessions?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listSessions(): Promise<NetworkPostureRaw[]> {
    return this.getAllPages<NetworkPostureRaw>(`${this.baseUrl}/sessions`);
  }

  async fetchNetworkPosture(observedAt: string): Promise<NormalizedNetworkSignal[]> {
    const rows = await this.listSessions();
    return rows.map((r) => normalizeNetwork(r, observedAt));
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: NetworkCollection<T>;
      try {
        body = (await res.json()) as NetworkCollection<T>;
      } catch {
        throw new NetworkConnectorError("bad_response", "NAC response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new NetworkConnectorError("bad_response", "NAC collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    // Exiting the cap with a next-page cursor still in hand means the inventory is
    // INCOMPLETE, and a short list is indistinguishable from a complete one — for a
    // posture fabric, a device missing from the result reads as a device with no
    // problem. Refuse rather than pass a partial inventory off as a whole one; the
    // cap itself stays, because it is the loop/DoS guard against an endless cursor.
    if (url) {
      throw new NetworkConnectorError(
        "incomplete_read",
        `Network/NAC read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<NetworkHttpResponse> {
    const req: NetworkRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): NetworkConnectorError {
  if (status === 401 || status === 403) {
    return new NetworkConnectorError("auth_failed", `NAC controller returned ${status}.`, status);
  }
  return new NetworkConnectorError("upstream_error", `NAC controller returned HTTP ${status}.`, status);
}

export function normalizeNetwork(row: NetworkPostureRaw, observedAt: string): NormalizedNetworkSignal {
  const accessLocation = row.switchPort ?? row.accessPoint ?? null;
  return {
    sourceSystem: "network-nac",
    correlationId: `${row.deviceId}:${row.segment ?? row.vlan ?? "no-segment"}`,
    observedAt,
    deviceId: row.deviceId,
    authState: normalizeAuthState(row.authState),
    segment: row.segment ?? (row.vlan !== undefined ? String(row.vlan) : null),
    accessLocation,
    nacCompliant: typeof row.nacCompliant === "boolean" ? row.nacCompliant : null,
    lastAuthAt: row.lastAuthAt ?? null,
    freshness: "unknown", // freshness is a function of nowMs; the evaluator derives it.
  };
}

function normalizeAuthState(state: string | undefined): NetworkAuthState {
  switch ((state ?? "").toLowerCase()) {
    case "authenticated":
    case "authorized":
    case "connected":
      return "authenticated";
    case "unauthenticated":
    case "unauthorized":
    case "rejected":
    case "failed":
      return "unauthenticated";
    case "quarantined":
    case "isolated":
    case "restricted":
      return "quarantined";
    default:
      return "unknown";
  }
}
