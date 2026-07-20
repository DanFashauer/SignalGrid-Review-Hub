import type { VulnRequest, VulnHttpResponse, VulnTransport } from "./vuln-connector";
import type { VulnFindingRaw } from "./types";

/**
 * Deterministic in-memory stand-in for a vulnerability scanner — serves real
 * request/response shapes (pageToken pagination, 401 on a bad token) so the
 * connector's paths are covered offline, no network and no real scan data.
 */
export interface MockVulnOptions {
  findings: VulnFindingRaw[];
  expectedToken: string;
  pageSize?: number;
  baseUrl?: string;
}

export function createMockVulnTransport(opts: MockVulnOptions): VulnTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.vulnscan.example/v1").replace(/\/$/, "");

  return async (req: VulnRequest): Promise<VulnHttpResponse> => {
    if (req.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" });
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) return jsonResponse(401, { error: "invalid_token" });

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/findings")) return jsonResponse(404, { error: "not_found" });

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.findings.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.findings.length) body.nextPageToken = String(nextSkip);
    return jsonResponse(200, body);
  };
}

function baseUrlPath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}
function jsonResponse(status: number, body: unknown): VulnHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
