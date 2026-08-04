import {
  OtPostureConnector,
  type OtConnectorConfig,
  type OtReportTransport,
} from "./ot-connector";
import { OtConnectorError, type OtDeviceReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./ot-connector";
export { createMockOtTransport, type MockOtOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND OT_POSTURE_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a bridge to an OT edge gateway (read-only) — the
 * grid_collected path for the plant floor.
 */
export type OtPostureConnectorResolution =
  | { mode: "live"; connector: OtPostureConnector }
  | { mode: "fixture"; reason: string };

export function resolveOtPostureConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: OtReportTransport,
): OtPostureConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.OT_POSTURE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "OT_POSTURE_ACCESS_TOKEN is not set" };
  }
  const config: OtConnectorConfig = {
    accessToken,
    baseUrl: env.OT_POSTURE_BASE_URL?.trim() || "https://gateway.local/ot-posture",
    source: "edge-gateway",
  };
  return { mode: "live", connector: new OtPostureConnector(config, transportOverride ?? makeDefaultOtTransport(config.baseUrl)) };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultOtTransport(baseUrl: string): OtReportTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // 403 belongs with 401, not with 500. A token that is valid but unscoped is OUR
      // misconfiguration; a 500 is the gateway's problem. Reporting the first as
      // `upstream_error` sends the ticket to the wrong owner, and this family was the
      // only one of twenty that did so — found once the default transport was actually
      // executed by a test rather than only read.
      throw new OtConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    // A 200 is not a promise that the body is a record. Without this, a maintenance
    // HTML page threw a raw SyntaxError past the typed error surface, and an array or a
    // bare `null` was cast straight to a report — `typeof null === "object"`, so the
    // null check is not redundant with the typeof.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new OtConnectorError("bad_response", "gateway returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new OtConnectorError("bad_response", "gateway returned a non-object body", res.status);
    }
    return body as OtDeviceReportRaw;
  };
}
