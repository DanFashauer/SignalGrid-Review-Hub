import type { NetworkRequest, NetworkHttpResponse, NetworkTransport } from "./network-connector";
import type { NetworkPostureRaw } from "./types";

/**
 * Deterministic in-memory stand-in for a NAC / LAN controller — serves real
 * request/response shapes (pageToken pagination, 401 on a bad token) so the
 * connector's paths are covered offline, no network and no real controller.
 */
export interface MockNetworkOptions {
  sessions: NetworkPostureRaw[];
  expectedToken: string;
  pageSize?: number;
  baseUrl?: string;
}

export function createMockNetworkTransport(opts: MockNetworkOptions): NetworkTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.nac.example/v1").replace(/\/$/, "");

  return async (req: NetworkRequest): Promise<NetworkHttpResponse> => {
    if (req.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" });
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) return jsonResponse(401, { error: "invalid_token" });

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/sessions")) return jsonResponse(404, { error: "not_found" });

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.sessions.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.sessions.length) body.nextPageToken = String(nextSkip);
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
function jsonResponse(status: number, body: unknown): NetworkHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
