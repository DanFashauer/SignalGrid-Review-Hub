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
      throw new OtConnectorError(res.status === 401 ? "auth_failed" : "upstream_error", `bridge returned ${res.status}`, res.status);
    }
    return (await res.json()) as OtDeviceReportRaw;
  };
}
