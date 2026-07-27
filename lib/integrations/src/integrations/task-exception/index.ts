import {
  TaskExceptionConnector,
  type TaskExceptionConnectorConfig,
  type TaskExceptionTransport,
} from "./task-exception-connector";
import { TaskExceptionConnectorError, type TaskExceptionReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./task-exception-connector";
export { createMockTaskExceptionTransport, type MockTaskExceptionOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * TASK_EXCEPTION_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only task-execution bridge (an Oracle WMS Cloud /
 * SAP EWM-class WMS, a retail task-management platform, or a clinical workflow engine
 * speaking the FHIR Task lifecycle) that has already evaluated the task and its
 * exceptions — SignalGrid consumes that evaluated result and assigns no task, confirms
 * no pick, closes no exception, and adjusts no inventory.
 */
export type TaskExceptionConnectorResolution =
  | { mode: "live"; connector: TaskExceptionConnector }
  | { mode: "fixture"; reason: string };

export function resolveTaskExceptionConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: TaskExceptionTransport,
): TaskExceptionConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.TASK_EXCEPTION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "TASK_EXCEPTION_ACCESS_TOKEN is not set" };
  }
  const config: TaskExceptionConnectorConfig = {
    accessToken,
    baseUrl: env.TASK_EXCEPTION_BASE_URL?.trim() || "https://wms-bridge.local/task-exception",
    source: "task-exception-bridge",
  };
  return {
    mode: "live",
    connector: new TaskExceptionConnector(
      config,
      transportOverride ?? makeDefaultTaskExceptionTransport(config.baseUrl),
    ),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultTaskExceptionTransport(baseUrl: string): TaskExceptionTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new TaskExceptionConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new TaskExceptionConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new TaskExceptionConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as TaskExceptionReportRaw;
  };
}
