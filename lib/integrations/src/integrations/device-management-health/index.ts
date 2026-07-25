import {
  DeviceManagementHealthConnector,
  type DeviceManagementHealthConnectorConfig,
  type DeviceManagementHealthTransport,
} from "./device-management-health-connector";
import { DeviceManagementHealthConnectorError, type DeviceManagementHealthReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./device-management-health-connector";
export {
  createMockDeviceManagementHealthTransport,
  type MockDeviceManagementHealthOptions,
} from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only management-plane bridge (Intune / Microsoft
 * Graph-class, or any MDM exposing device check-in, enrollment, policy assignment and
 * configuration state) that evaluates the device's management health — SignalGrid
 * consumes that evaluated result and enrolls nothing, assigns no policy, pushes no
 * profile, and wipes nothing.
 */
export type DeviceManagementHealthConnectorResolution =
  | { mode: "live"; connector: DeviceManagementHealthConnector }
  | { mode: "fixture"; reason: string };

export function resolveDeviceManagementHealthConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: DeviceManagementHealthTransport,
): DeviceManagementHealthConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN is not set" };
  }
  const config: DeviceManagementHealthConnectorConfig = {
    accessToken,
    baseUrl:
      env.DEVICE_MANAGEMENT_HEALTH_BASE_URL?.trim() ||
      "https://device-management-bridge.local/device-management-health",
    source: "device-management-health-bridge",
  };
  return {
    mode: "live",
    connector: new DeviceManagementHealthConnector(
      config,
      transportOverride ?? makeDefaultDeviceManagementHealthTransport(config.baseUrl),
    ),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultDeviceManagementHealthTransport(baseUrl: string): DeviceManagementHealthTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new DeviceManagementHealthConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new DeviceManagementHealthConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new DeviceManagementHealthConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as DeviceManagementHealthReportRaw;
  };
}
