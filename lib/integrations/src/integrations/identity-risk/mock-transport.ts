import type { IdentityRequest, IdentityHttpResponse, IdentityTransport } from "./identity-connector";
import type { PrincipalRiskRaw } from "./types";

/**
 * Deterministic in-memory stand-in for an IdP risk engine — serves real
 * request/response shapes (pageToken pagination, 401 on a bad token, 405 on a
 * non-GET) so the connector's paths are covered offline, with no network and no
 * real identity data.
 */
export interface MockIdentityOptions {
  principals: PrincipalRiskRaw[];
  expectedToken: string;
  pageSize?: number;
  baseUrl?: string;
}

export function createMockIdentityTransport(opts: MockIdentityOptions): IdentityTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.identity.example/v1").replace(/\/$/, "");

  return async (req: IdentityRequest): Promise<IdentityHttpResponse> => {
    if (req.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" });
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) return jsonResponse(401, { error: "invalid_token" });

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/risky-principals")) return jsonResponse(404, { error: "not_found" });

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.principals.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.principals.length) body.nextPageToken = String(nextSkip);
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
function jsonResponse(status: number, body: unknown): IdentityHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
