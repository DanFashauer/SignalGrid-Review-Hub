import {
  AppUpdateConnector,
  type AppUpdateConnectorConfig,
  type AppUpdateTransport,
} from "./app-update-connector";
import { AppUpdateConnectorError, type AppUpdateReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./app-update-connector";
export { createMockAppUpdateTransport, type MockAppUpdateOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * APP_UPDATE_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only view joining the MDM app inventory with the
 * tenant's release manifest. SignalGrid consumes that reading; it never distributes,
 * installs, or removes an app itself — that is the platform's job (itms-services /
 * MDM InstallApplication / ABM; see docs/APP_UPDATE_CURRENCY.md).
 */
export type AppUpdateConnectorResolution =
  | { mode: "live"; connector: AppUpdateConnector }
  | { mode: "fixture"; reason: string };

export function resolveAppUpdateConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AppUpdateTransport,
): AppUpdateConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.APP_UPDATE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "APP_UPDATE_ACCESS_TOKEN is not set" };
  }
  const config: AppUpdateConnectorConfig = {
    accessToken,
    baseUrl: env.APP_UPDATE_BASE_URL?.trim() || "https://app-update-manifest.local/app-update",
    source: "app-update-manifest",
  };
  return {
    mode: "live",
    connector: new AppUpdateConnector(config, transportOverride ?? makeDefaultAppUpdateTransport(config.baseUrl)),
  };
}

/** Build a live manifest transport bound to a specific base URL (honors config). */
export function makeDefaultAppUpdateTransport(baseUrl: string): AppUpdateTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, appRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}/${encodeURIComponent(appRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AppUpdateConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `app-update source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AppUpdateConnectorError("bad_response", "app-update source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AppUpdateConnectorError("bad_response", "app-update source returned a non-object body", res.status);
    }
    return body as AppUpdateReportRaw;
  };
}
