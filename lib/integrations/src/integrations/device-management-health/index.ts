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
export * from "./graph-transport";
export {
  createFixtureDeviceManagementHealthConnector,
  FIXTURE_DEVICE_MANAGEMENT_HEALTH_REPORTS,
  FIXTURE_DEVICE_MANAGEMENT_HEALTH_TOKEN,
} from "./fixtures";

import { GRAPH_V1_ROOT, makeGraphDeviceManagementHealthTransport } from "./graph-transport";
import { createFixtureDeviceManagementHealthConnector } from "./fixtures";

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
  | { mode: "fixture"; reason: string; connector: DeviceManagementHealthConnector };

export function resolveDeviceManagementHealthConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: DeviceManagementHealthTransport,
): DeviceManagementHealthConnectorResolution {
  // Fixture mode now carries a WORKING connector over the committed fixture
  // reports, so a fixture-mode caller runs the same fetch → normalize → evaluate
  // pipeline a live one does — deterministic, offline, synthetic data only.
  // `mode` remains the source of truth for what the data IS.
  const fixture = (reason: string): DeviceManagementHealthConnectorResolution => ({
    mode: "fixture",
    reason,
    connector: createFixtureDeviceManagementHealthConnector(),
  });
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  const accessToken = env.DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return fixture("DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN is not set");
  }
  // TRANSPORT SELECTION IS EXPLICIT, and the default is unchanged on purpose.
  //
  // `graph` talks to a real tenant (graph.microsoft.com/v1.0/deviceManagement/
  // managedDevices/{id}, read-only). `bridge` is the pre-existing bespoke endpoint.
  // Switching the DEFAULT to graph would silently repoint every existing beta/prod
  // deployment at a different upstream on upgrade — a behaviour change disguised as
  // a fix. Opting in is one environment variable; guessing on someone's behalf is
  // not recoverable.
  const transportKind = (env.DEVICE_MANAGEMENT_HEALTH_TRANSPORT?.trim().toLowerCase() || "bridge") as
    | "bridge"
    | "graph";
  if (transportKind !== "bridge" && transportKind !== "graph") {
    return fixture(`unrecognized DEVICE_MANAGEMENT_HEALTH_TRANSPORT "${transportKind}"`);
  }

  const config: DeviceManagementHealthConnectorConfig = {
    accessToken,
    baseUrl:
      env.DEVICE_MANAGEMENT_HEALTH_BASE_URL?.trim() ||
      (transportKind === "graph" ? GRAPH_V1_ROOT : "https://device-management-bridge.local/device-management-health"),
    source: transportKind === "graph" ? "microsoft-graph-device-management" : "device-management-health-bridge",
  };

  // The graph transport needs an explicit clock (determinism law). Supplying it here,
  // at the process edge, keeps `Date.now` out of every signal and decision path while
  // still letting a real deployment measure real freshness. Proofs construct the
  // transport directly with a fixed instant and never reach this branch.
  const transport =
    transportOverride ??
    (transportKind === "graph"
      ? makeGraphDeviceManagementHealthTransport({ baseUrl: config.baseUrl, now: () => new Date() })
      : makeDefaultDeviceManagementHealthTransport(config.baseUrl));

  return { mode: "live", connector: new DeviceManagementHealthConnector(config, transport) };
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
