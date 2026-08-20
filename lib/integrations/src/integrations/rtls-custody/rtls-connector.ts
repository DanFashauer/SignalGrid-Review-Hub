import {
  RtlsConnectorError,
  type AssetLocationRaw,
  type CustodyCollection,
  type NormalizedAssetLocation,
  type ZoneType,
} from "./types";

/**
 * Read-only RTLS / badge-dwell custody connector. Reads per-device real-time
 * location + dwell + badge association and normalizes it. READ-ONLY by
 * construction (GET-only, guarded) — it never pages a badge holder, sounds an
 * alarm, or locks a dock; those stay explicit, separately-authorized actions.
 * Injectable transport for offline proofs.
 */

export interface RtlsRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface RtlsHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type RtlsTransport = (req: RtlsRequest) => Promise<RtlsHttpResponse>;

export interface RtlsConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new RtlsConnectorError("read_only_violation", `The RTLS custody connector is read-only; refused a ${method} request.`);
  }
}

export class RtlsCustodyConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: RtlsTransport;

  constructor(config: RtlsConnectorConfig, transport: RtlsTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.rtls.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/asset-locations?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listLocations(): Promise<AssetLocationRaw[]> {
    return this.getAllPages<AssetLocationRaw>(`${this.baseUrl}/asset-locations`);
  }

  async fetchLocations(): Promise<NormalizedAssetLocation[]> {
    const locations = await this.listLocations();
    return locations.map(normalizeLocation);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: CustodyCollection<T>;
      try {
        body = (await res.json()) as CustodyCollection<T>;
      } catch {
        throw new RtlsConnectorError("bad_response", "RTLS response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new RtlsConnectorError("bad_response", "RTLS collection had no `value` array.", res.status);
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
      throw new RtlsConnectorError(
        "incomplete_read",
        `RTLS read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<RtlsHttpResponse> {
    const req: RtlsRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): RtlsConnectorError {
  if (status === 401 || status === 403) {
    return new RtlsConnectorError("auth_failed", `RTLS platform returned ${status}.`, status);
  }
  return new RtlsConnectorError("upstream_error", `RTLS platform returned HTTP ${status}.`, status);
}

export function normalizeLocation(loc: AssetLocationRaw): NormalizedAssetLocation {
  return {
    sourceSystem: "rtls-custody",
    deviceId: loc.deviceId,
    zoneId: loc.zoneId ?? null,
    zoneType: normalizeZoneType(loc.zoneType),
    zoneAuthorized: typeof loc.zoneAuthorized === "boolean" ? loc.zoneAuthorized : null,
    // Only a finite, non-negative duration is a REPORTED one (wedge #10, caught
    // by the shift-1 sweep). A negative fix age claims a fix newer than now — a
    // contradiction that `typeof === "number"` let read as fresh, minting a
    // CUSTODY_OK/none grant; a negative dwell likewise disarmed the abandonment
    // arm. Contradiction resolves to "unverifiable" (null), which the evaluator
    // already fails safe on (stale fix / unconfirmable dwell).
    fixAgeSeconds:
      typeof loc.fixAgeSeconds === "number" && Number.isFinite(loc.fixAgeSeconds) && loc.fixAgeSeconds >= 0
        ? loc.fixAgeSeconds
        : null,
    dwellSeconds:
      typeof loc.dwellSeconds === "number" && Number.isFinite(loc.dwellSeconds) && loc.dwellSeconds >= 0
        ? loc.dwellSeconds
        : null,
    badgeAssociated: typeof loc.badgeAssociated === "boolean" ? loc.badgeAssociated : null,
    atEgress: loc.atEgress === true,
    // Tri-state: an omitted presence field is null (unknown), NOT a positive
    // "present". Only an explicit `present:false` trips the LEFT_AREA escalation;
    // an unknown presence relies on the fix-age fail-safe (a truly departed device
    // stops producing fixes, so its fix goes stale → locate) rather than silently
    // reading as present. This keeps a missing input from resolving to the calmer
    // verdict, matching how fixAge/dwell/tracked treat "unknown" as worse.
    present: typeof loc.present === "boolean" ? loc.present : null,
    source: loc.source ?? "unknown",
  };
}

function normalizeZoneType(zoneType: string | undefined): ZoneType {
  switch ((zoneType ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "clinical":
    case "patient_care":
    case "ward":
    case "unit":
      return "clinical";
    case "storage":
    case "supply":
    case "biomed":
      return "storage";
    case "public":
    case "lobby":
    case "waiting":
      return "public";
    case "egress":
    case "exit":
    case "elevator":
    case "stairwell":
    case "loading_dock":
      return "egress";
    case "unauthorized":
    case "offlimits":
    case "off_limits":
    case "restricted":
      return "unauthorized";
    default:
      return "unknown";
  }
}
