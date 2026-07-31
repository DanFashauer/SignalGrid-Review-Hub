import {
  CarrierConnectorError,
  type CarrierCollection,
  type CarrierSessionRaw,
  type CellularReachability,
  type ProvisioningState,
  type ReachabilitySignal,
} from "./types";

/**
 * Read-only carrier / IoT-connectivity reachability connector.
 *
 * Reads per-SIM session + last-seen state from a carrier/IoT platform and
 * normalizes it into SignalGrid's reachability vocabulary. READ-ONLY by
 * construction — every path goes through `get()`, which hard-codes GET and runs a
 * read-only guard, so the connector can never send a device command (that stays
 * an explicit, separately-authorized action, never a side effect of reading
 * posture). The HTTP transport is INJECTED so the proof exercises real
 * request/response/pagination/error flow offline against a deterministic mock.
 */

export interface CarrierRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}

export interface CarrierHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

export type CarrierTransport = (req: CarrierRequest) => Promise<CarrierHttpResponse>;

export interface CarrierConnectorConfig {
  /** Read-only API token for the carrier/IoT connectivity platform. */
  accessToken: string;
  /** Platform base URL. */
  baseUrl?: string;
  /** Hard cap on pages followed (loop/DoS guard). Default 50. */
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never command a device. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new CarrierConnectorError(
      "read_only_violation",
      `The carrier reachability connector is read-only; refused a ${method} request.`,
    );
  }
}

export class CarrierReachabilityConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: CarrierTransport;

  constructor(config: CarrierConnectorConfig, transport: CarrierTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.carrier.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  /** Cheap read to confirm the token works. Never throws — reports health. */
  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/sessions?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  /** Read all SIM sessions, following pagination up to `pageLimit`. */
  async listSessions(): Promise<CarrierSessionRaw[]> {
    return this.getAllPages<CarrierSessionRaw>(`${this.baseUrl}/sessions`);
  }

  /**
   * Read sessions and emit one normalized reachability signal per device.
   * `observedAt` is injected so the emitted provenance is deterministic in tests.
   */
  async fetchReachability(observedAt: string): Promise<ReachabilitySignal[]> {
    const sessions = await this.listSessions();
    return sessions.map((s) => normalizeSession(s, observedAt));
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
      let body: CarrierCollection<T>;
      try {
        body = (await res.json()) as CarrierCollection<T>;
      } catch {
        throw new CarrierConnectorError("bad_response", "Carrier response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new CarrierConnectorError("bad_response", "Carrier collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    // Exiting the cap with a next-page cursor still in hand means the inventory is
    // INCOMPLETE, and a short list is indistinguishable from a complete one. Refuse
    // rather than pass a partial inventory off as a whole one; the cap itself stays,
    // because it is the loop/DoS guard against an endless cursor.
    if (url) {
      throw new CarrierConnectorError(
        "incomplete_read",
        `Carrier read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<CarrierHttpResponse> {
    const req: CarrierRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    // Belt-and-braces: prove at runtime that we only ever issue reads.
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): CarrierConnectorError {
  if (status === 401 || status === 403) {
    return new CarrierConnectorError("auth_failed", `Carrier returned ${status} — token or scope is insufficient.`, status);
  }
  return new CarrierConnectorError("upstream_error", `Carrier returned HTTP ${status}.`, status);
}

export function normalizeSession(session: CarrierSessionRaw, observedAt: string): ReachabilitySignal {
  // A SIM with no ICCID and no SMS capability has no cellular backchannel at all.
  const wifiOnly = !session.iccid && session.smsCapable !== true && session.dataConnected !== true;
  return {
    sourceSystem: "carrier",
    correlationId: `${session.deviceId}:${session.iccid ?? "no-sim"}`,
    observedAt,
    deviceId: session.deviceId,
    cellularReachability: normalizeReachability(session),
    smsReachable: session.smsCapable === true,
    lastSeenAt: session.lastConnectedAt ?? null,
    freshness: "unknown", // freshness is a function of nowMs; the evaluator derives it.
    roaming: session.roaming === true,
    provisioning: normalizeProvisioning(session.billingState),
    wifiOnly,
  };
}

function normalizeReachability(session: CarrierSessionRaw): CellularReachability {
  if (session.dataConnected === true) return "online";
  const s = (session.sessionState ?? "").toLowerCase();
  switch (s) {
    case "active":
    case "connected":
      return "online";
    case "idle":
    case "standby":
      return "idle";
    case "inactive":
    case "offline":
    case "disconnected":
      return "offline";
    default:
      // No data session and no explicit state: idle if SMS-reachable, else unknown.
      if (session.smsCapable === true) return "idle";
      return "unknown";
  }
}

function normalizeProvisioning(billingState: string | undefined): ProvisioningState {
  switch ((billingState ?? "").toLowerCase()) {
    case "active":
    case "activated":
      return "active";
    case "suspended":
    case "paused":
      return "suspended";
    case "deactivated":
    case "retired":
    case "canceled":
    case "cancelled":
      return "deactivated";
    default:
      return "unknown";
  }
}
