import type { GraphRequest, GraphHttpResponse, GraphTransport } from "./posture-connector";
import type { GraphManagedDeviceRaw, GraphRiskyUserRaw, GraphUserRaw } from "./types";

/**
 * A deterministic, in-memory stand-in for Microsoft Graph, used to exercise the
 * connector end to end WITHOUT a network or a live tenant. It serves the exact
 * request/response shapes Graph uses — including `@odata.nextLink` pagination and
 * a 401 for a bad token — so the connector's real code paths (paging, error
 * mapping, normalization) are all covered offline.
 */

export interface MockGraphOptions {
  users: GraphUserRaw[];
  devices: GraphManagedDeviceRaw[];
  /**
   * The Identity Protection risky-user list. OMITTED means the tenant has not
   * granted IdentityRiskyUser.Read.All and the mock answers 403 — the same wire
   * fact a real tenant presents — so a proof that wants risk must supply it.
   */
  riskyUsers?: GraphRiskyUserRaw[];
  /** Token the mock accepts; any other bearer yields 401. */
  expectedToken: string;
  /** Page size for collection responses (drives nextLink paging). Default 100. */
  pageSize?: number;
  /** Base URL the connector was configured with. */
  baseUrl?: string;
}

export function createMockGraphTransport(opts: MockGraphOptions): GraphTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");

  const page = <T>(items: T[], collectionPath: string, skip: number): GraphHttpResponse => {
    const slice = items.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < items.length) {
      body["@odata.nextLink"] = `${baseUrl}${collectionPath}?$skiptoken=${nextSkip}`;
    }
    return jsonResponse(200, body);
  };

  return async (req: GraphRequest): Promise<GraphHttpResponse> => {
    // Read-only mock: anything but GET is a protocol error on our side too.
    if (req.method !== "GET") {
      return jsonResponse(405, { error: { code: "method_not_allowed" } });
    }
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) {
      return jsonResponse(401, { error: { code: "InvalidAuthenticationToken" } });
    }

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    const skip = Number(parsed.searchParams.get("$skiptoken") ?? "0") || 0;

    if (path.startsWith("/users")) {
      return page(opts.users, "/users", skip);
    }
    if (path.startsWith("/deviceManagement/managedDevices")) {
      return page(opts.devices, "/deviceManagement/managedDevices", skip);
    }
    if (path.startsWith("/identityProtection/riskyUsers")) {
      if (!opts.riskyUsers) return jsonResponse(403, { error: { code: "Authorization_RequestDenied" } });
      return page(opts.riskyUsers, "/identityProtection/riskyUsers", skip);
    }
    return jsonResponse(404, { error: { code: "not_found" } });
  };
}

function baseUrlPath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function jsonResponse(status: number, body: unknown): GraphHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}
