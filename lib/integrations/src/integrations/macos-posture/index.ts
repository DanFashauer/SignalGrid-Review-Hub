import {
  MacosPostureConnector,
  type MacosPostureConnectorConfig,
  type MacosReportTransport,
} from "./macos-connector";
import { MacosPostureConnectorError, type MacosPostureReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./macos-connector";
export * from "./apple-schema";
export { createMockMacosTransport, type MockMacosOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND MACOS_POSTURE_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a bridge that relays the on-device `signalgrid-mcp`
 * server's read-only posture report — the grid_collected path for a Mac.
 */
export type MacosPostureConnectorResolution =
  | { mode: "live"; connector: MacosPostureConnector }
  | { mode: "fixture"; reason: string };

export function resolveMacosPostureConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: MacosReportTransport,
): MacosPostureConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.MACOS_POSTURE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "MACOS_POSTURE_ACCESS_TOKEN is not set" };
  }
  const config: MacosPostureConnectorConfig = {
    accessToken,
    baseUrl: env.MACOS_POSTURE_BASE_URL?.trim() || "https://bridge.local/macos-posture",
    source: "signalgrid-mcp",
  };
  // Bind the configured bridge URL into the transport so MACOS_POSTURE_BASE_URL
  // is actually honored — not silently ignored in favor of a hardcoded host.
  return { mode: "live", connector: new MacosPostureConnector(config, transportOverride ?? makeDefaultMacosTransport(config.baseUrl)) };
}

/** Build a live bridge transport bound to a specific base URL. */
export function makeDefaultMacosTransport(baseUrl: string): MacosReportTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // 403 belongs with 401. A token that is valid but unscoped is OUR
      // misconfiguration; a 500 is the bridge's problem, and they go to different
      // owners. This family and `ot-posture` were the two that got it wrong — found
      // only once a test actually executed the default transport instead of injecting
      // past it.
      throw new MacosPostureConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    // A 200 is not a promise that the body is a record. Without this a maintenance HTML
    // page threw a raw SyntaxError past the typed error surface, and an array or a bare
    // `null` was cast straight to a report — `typeof null === "object"`, so the null
    // check is not redundant with the typeof.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new MacosPostureConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new MacosPostureConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as MacosPostureReportRaw;
  };
}
