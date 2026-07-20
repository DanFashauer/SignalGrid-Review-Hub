import type { PeripheralRequest, PeripheralHttpResponse, PeripheralTransport } from "./peripheral-connector";
import type { PeripheralPostureRaw } from "./types";

/**
 * Deterministic in-memory stand-in for a device-control platform — serves real
 * request/response shapes (pageToken pagination, 401 on a bad token, 405 on a
 * non-GET) so the connector's paths are covered offline, with no network and no
 * real device data.
 */
export interface MockPeripheralOptions {
  devices: PeripheralPostureRaw[];
  expectedToken: string;
  pageSize?: number;
  baseUrl?: string;
}

export function createMockPeripheralTransport(opts: MockPeripheralOptions): PeripheralTransport {
  const pageSize = Math.max(1, opts.pageSize ?? 100);
  const baseUrl = (opts.baseUrl ?? "https://api.devicecontrol.example/v1").replace(/\/$/, "");

  return async (req: PeripheralRequest): Promise<PeripheralHttpResponse> => {
    if (req.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" });
    if (req.headers.authorization !== `Bearer ${opts.expectedToken}`) return jsonResponse(401, { error: "invalid_token" });

    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(baseUrlPath(baseUrl), "");
    if (!path.startsWith("/device-peripherals")) return jsonResponse(404, { error: "not_found" });

    const skip = Number(parsed.searchParams.get("pageToken") ?? "0") || 0;
    const slice = opts.devices.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const body: Record<string, unknown> = { value: slice };
    if (nextSkip < opts.devices.length) body.nextPageToken = String(nextSkip);
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
function jsonResponse(status: number, body: unknown): PeripheralHttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
