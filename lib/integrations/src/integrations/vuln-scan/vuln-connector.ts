import {
  VulnConnectorError,
  type NormalizedVulnFinding,
  type VulnCollection,
  type VulnFindingRaw,
  type VulnSeverity,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/**
 * Read-only vulnerability-scanner connector. Reads per-device findings from a
 * scanner/EDR and normalizes them. READ-ONLY by construction (GET-only, guarded)
 * — it never triggers a scan or a remediation; those stay explicit, separately-
 * authorized actions. Injectable transport for offline proofs.
 */

export interface VulnRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface VulnHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type VulnTransport = (req: VulnRequest) => Promise<VulnHttpResponse>;

export interface VulnConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new VulnConnectorError("read_only_violation", `The vuln-scan connector is read-only; refused a ${method} request.`),
);

export class VulnScanConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: VulnTransport;

  constructor(config: VulnConnectorConfig, transport: VulnTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.vulnscan.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/findings?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listFindings(): Promise<VulnFindingRaw[]> {
    return this.getAllPages<VulnFindingRaw>(`${this.baseUrl}/findings`);
  }

  async fetchFindings(): Promise<NormalizedVulnFinding[]> {
    const findings = await this.listFindings();
    return findings.map(normalizeFinding);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: VulnCollection<T>;
      try {
        body = (await res.json()) as VulnCollection<T>;
      } catch {
        throw new VulnConnectorError("bad_response", "Vuln-scan response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new VulnConnectorError("bad_response", "Vuln-scan collection had no `value` array.", res.status);
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
      throw new VulnConnectorError(
        "incomplete_read",
        `Vulnerability-scan read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<VulnHttpResponse> {
    const req: VulnRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): VulnConnectorError {
  if (status === 401 || status === 403) {
    return new VulnConnectorError("auth_failed", `Vuln scanner returned ${status}.`, status);
  }
  return new VulnConnectorError("upstream_error", `Vuln scanner returned HTTP ${status}.`, status);
}

export function normalizeFinding(finding: VulnFindingRaw): NormalizedVulnFinding {
  return {
    sourceSystem: "vuln-scan",
    deviceId: finding.deviceId,
    cveId: finding.cveId ?? null,
    severity: normalizeSeverity(finding.severity, finding.cvssScore),
    cvssScore: typeof finding.cvssScore === "number" ? finding.cvssScore : null,
    exploitAvailable: finding.exploitAvailable === true,
    component: finding.component ?? null,
    fixedVersion: finding.fixedVersion ?? null,
    detectedAt: finding.detectedAt ?? null,
    source: finding.source ?? "unknown",
  };
}

function normalizeSeverity(severity: string | undefined, cvss: number | undefined): VulnSeverity {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
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
      // Fall back to the CVSS band when the label is missing/unknown.
      if (typeof cvss === "number") {
        if (cvss >= 9.0) return "critical";
        if (cvss >= 7.0) return "high";
        if (cvss >= 4.0) return "medium";
        if (cvss > 0) return "low";
      }
      return "unknown";
  }
}
