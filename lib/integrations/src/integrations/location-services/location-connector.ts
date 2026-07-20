import {
  LocationConnectorError,
  type GeofenceState,
  type LocationCollection,
  type LocationFixRaw,
  type LocationSource,
  type NormalizedLocationSignal,
} from "./types";

/**
 * Read-only device location connector. Reads per-device location fixes from an
 * MDM lost-mode / location platform and normalizes them into SignalGrid's
 * privacy-minimized location vocabulary. READ-ONLY by construction (GET-only,
 * guarded) — it never issues a locate/wipe command; that stays an explicit,
 * separately-authorized action. Injectable transport for offline proofs.
 */

export interface LocationRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface LocationHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type LocationTransport = (req: LocationRequest) => Promise<LocationHttpResponse>;

export interface LocationConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never command a device. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new LocationConnectorError(
      "read_only_violation",
      `The location connector is read-only; refused a ${method} request.`,
    );
  }
}

export class LocationServicesConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: LocationTransport;

  constructor(config: LocationConnectorConfig, transport: LocationTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.location.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/locations?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listFixes(): Promise<LocationFixRaw[]> {
    return this.getAllPages<LocationFixRaw>(`${this.baseUrl}/locations`);
  }

  async fetchLocations(observedAt: string): Promise<NormalizedLocationSignal[]> {
    const fixes = await this.listFixes();
    return fixes.map((f) => normalizeFix(f, observedAt));
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: LocationCollection<T>;
      try {
        body = (await res.json()) as LocationCollection<T>;
      } catch {
        throw new LocationConnectorError("bad_response", "Location response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new LocationConnectorError("bad_response", "Location collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    return out;
  }

  private async rawGet(url: string): Promise<LocationHttpResponse> {
    const req: LocationRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): LocationConnectorError {
  if (status === 401 || status === 403) {
    return new LocationConnectorError("auth_failed", `Location platform returned ${status}.`, status);
  }
  return new LocationConnectorError("upstream_error", `Location platform returned HTTP ${status}.`, status);
}

export function normalizeFix(fix: LocationFixRaw, observedAt: string): NormalizedLocationSignal {
  const hasPreciseCoordinates = typeof fix.latitude === "number" && typeof fix.longitude === "number";
  return {
    sourceSystem: "location-services",
    correlationId: `${fix.deviceId}:${fix.geofenceId ?? "no-geofence"}`,
    observedAt,
    deviceId: fix.deviceId,
    geofenceState: normalizeGeofence(fix.geofenceState),
    geofenceId: fix.geofenceId ?? null,
    source: normalizeSource(fix.source),
    accuracyMeters: typeof fix.accuracyMeters === "number" ? fix.accuracyMeters : null,
    capturedAt: fix.capturedAt ?? null,
    freshness: "unknown", // freshness is a function of nowMs; the evaluator derives it.
    hasPreciseCoordinates,
  };
}

function normalizeGeofence(state: string | undefined): GeofenceState {
  switch ((state ?? "").toLowerCase()) {
    case "inside":
    case "in":
    case "present":
      return "inside";
    case "outside":
    case "out":
    case "absent":
      return "outside";
    default:
      return "unknown";
  }
}

function normalizeSource(source: string | undefined): LocationSource {
  switch ((source ?? "").toLowerCase()) {
    case "gps":
      return "gps";
    case "wifi":
    case "wi-fi":
      return "wifi";
    case "cell":
    case "cellular":
      return "cell";
    case "mdm_lost_mode":
    case "lost_mode":
    case "lostmode":
      return "mdm_lost_mode";
    default:
      return "unknown";
  }
}
