import {
  EdrConnectorError,
  type EndpointThreatRaw,
  type NormalizedEndpointThreat,
  type NormalizedThreatDetection,
  type ThreatCollection,
  type ThreatDetectionRaw,
  type ThreatRemediationState,
  type ThreatSeverity,
} from "./types";

/**
 * Read-only EDR/EPP threat-state connector. Reads per-endpoint agent health +
 * threat detections and normalizes them. READ-ONLY by construction (GET-only,
 * guarded) — it never isolates, scans, or remediates a host; those stay explicit,
 * separately-authorized actions. Injectable transport for offline proofs.
 */

export interface EdrRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface EdrHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type EdrTransport = (req: EdrRequest) => Promise<EdrHttpResponse>;

export interface EdrConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate a host. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new EdrConnectorError("read_only_violation", `The EDR/EPP connector is read-only; refused a ${method} request.`);
  }
}

export class EdrThreatConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: EdrTransport;

  constructor(config: EdrConnectorConfig, transport: EdrTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.edr.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/endpoints?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listEndpoints(): Promise<EndpointThreatRaw[]> {
    return this.getAllPages<EndpointThreatRaw>(`${this.baseUrl}/endpoints`);
  }

  async fetchEndpoints(): Promise<NormalizedEndpointThreat[]> {
    const endpoints = await this.listEndpoints();
    return endpoints.map(normalizeEndpoint);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: ThreatCollection<T>;
      try {
        body = (await res.json()) as ThreatCollection<T>;
      } catch {
        throw new EdrConnectorError("bad_response", "EDR/EPP response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new EdrConnectorError("bad_response", "EDR/EPP collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    return out;
  }

  private async rawGet(url: string): Promise<EdrHttpResponse> {
    const req: EdrRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): EdrConnectorError {
  if (status === 401 || status === 403) {
    return new EdrConnectorError("auth_failed", `EDR/EPP returned ${status}.`, status);
  }
  return new EdrConnectorError("upstream_error", `EDR/EPP returned HTTP ${status}.`, status);
}

export function normalizeEndpoint(endpoint: EndpointThreatRaw): NormalizedEndpointThreat {
  return {
    sourceSystem: "edr-epp",
    deviceId: endpoint.deviceId,
    agentInstalled: endpoint.agentInstalled === true,
    agentRunning: endpoint.agentRunning === true,
    realtimeProtection: endpoint.realtimeProtection === true,
    signatureAgeHours: typeof endpoint.signatureAgeHours === "number" ? endpoint.signatureAgeHours : null,
    lastSeen: endpoint.lastSeen ?? null,
    threats: (endpoint.threats ?? []).map(normalizeDetection),
    source: endpoint.source ?? "unknown",
  };
}

export function normalizeDetection(detection: ThreatDetectionRaw): NormalizedThreatDetection {
  const remediationState = normalizeRemediation(detection.remediationState);
  return {
    threatId: detection.threatId ?? null,
    name: detection.name ?? null,
    severity: normalizeSeverity(detection.severity),
    remediationState,
    category: detection.category ?? null,
    detectedAt: detection.detectedAt ?? null,
    active: isActive(remediationState),
  };
}

/**
 * A detection is "active" (a live risk) unless it is provably neutralized. An
 * unknown/unmapped remediation state is treated as active — fail-safe: we never
 * assume a threat we can't classify has been handled.
 */
function isActive(state: ThreatRemediationState): boolean {
  return state === "active" || state === "allowed" || state === "unknown";
}

function normalizeRemediation(state: string | undefined): ThreatRemediationState {
  switch ((state ?? "").toLowerCase()) {
    case "quarantined":
    case "quarantine":
      return "quarantined";
    case "removed":
    case "remediated":
    case "cleaned":
    case "deleted":
      return "removed";
    case "blocked":
    case "prevented":
    case "contained":
      return "blocked";
    case "active":
    case "detected":
    case "running":
    case "not_remediated":
      return "active";
    case "allowed":
    case "suppressed":
    case "exclusion":
    case "ignored":
      return "allowed";
    default:
      return "unknown";
  }
}

function normalizeSeverity(severity: string | undefined): ThreatSeverity {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
    case "severe":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
      return "low";
    case "info":
    case "informational":
    case "none":
      return "info";
    default:
      return "unknown";
  }
}
