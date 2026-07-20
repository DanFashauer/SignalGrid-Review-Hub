import type { CarrierRequest, CarrierHttpResponse, CarrierTransport } from "./reachability-connector";
import type { CarrierSessionRaw } from "./types";

/**
 * A deterministic, in-memory stand-in for a carrier / IoT-connectivity platform,
 * used to exercise the connector end to end WITHOUT a network or real SIMs. It
 * serves the same request/response shapes a real platform uses — including
 * pageToken pagination and a 401 for a bad token — so the connector's real code
 * paths (paging, error mapping, normalization) are all covered offline.
 */

export interface MockCarrierOptions {
  sessions: CarrierSessionRaw[];
  /** Token the mock accepts; any other bearer yields 401. */
  expectedToken: string;
  /** Page size for collection responses (drives pageToken paging). Default 100. */
  pageSize?: number;
  /** Base URL the connector was configured with. */
  baseUrl?: string;
}

export function createMockCarrierTransport(opts: MockCarrierOptions): CarrierTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.carrier.example/v1").replace(/\/$/, "");

  return async (req: CarrierRequest): Promise<CarrierHttpResponse> => {
    if (req.method !== "GET") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) {
      return jsonResponse(401, { error: "invalid_token" });
    }

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/sessions")) {
      return jsonResponse(404, { error: "not_found" });
    }

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.sessions.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.sessions.length) {
      body.nextPageToken = String(nextSkip);
    }
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

function jsonResponse(status: number, body: unknown): CarrierHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
