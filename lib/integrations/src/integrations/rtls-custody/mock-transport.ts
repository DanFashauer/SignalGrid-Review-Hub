import type { RtlsRequest, RtlsHttpResponse, RtlsTransport } from "./rtls-connector";
import type { AssetLocationRaw } from "./types";

/**
 * Deterministic in-memory stand-in for an RTLS platform — serves real
 * request/response shapes (pageToken pagination, 401 on a bad token, 405 on a
 * non-GET) so the connector's paths are covered offline, with no network and no
 * real location data.
 */
export interface MockRtlsOptions {
  locations: AssetLocationRaw[];
  expectedToken: string;
  pageSize?: number;
  baseUrl?: string;
}

export function createMockRtlsTransport(opts: MockRtlsOptions): RtlsTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.rtls.example/v1").replace(/\/$/, "");

  return async (req: RtlsRequest): Promise<RtlsHttpResponse> => {
    if (req.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" });
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) return jsonResponse(401, { error: "invalid_token" });

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/asset-locations")) return jsonResponse(404, { error: "not_found" });

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.locations.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.locations.length) body.nextPageToken = String(nextSkip);
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
function jsonResponse(status: number, body: unknown): RtlsHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
