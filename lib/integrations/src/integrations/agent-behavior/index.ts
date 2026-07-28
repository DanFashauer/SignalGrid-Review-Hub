import {
  AgentBehaviorConnector,
  type AgentBehaviorConnectorConfig,
  type AgentBehaviorTransport,
} from "./agent-behavior-connector";
import { AgentBehaviorConnectorError, type AgentBehaviorReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./agent-behavior-connector";
export { createMockAgentBehaviorTransport, type MockAgentBehaviorOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * AGENT_BEHAVIOR_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only behavior-analytics bridge — an agent-activity
 * monitor, a UEBA engine, or the agent gateway's own action telemetry — which has
 * already evaluated the ACTION's shape. SignalGrid consumes that evaluated result; it
 * takes no action of its own.
 */
export type AgentBehaviorConnectorResolution =
  | { mode: "live"; connector: AgentBehaviorConnector }
  | { mode: "fixture"; reason: string };

export function resolveAgentBehaviorConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AgentBehaviorTransport,
): AgentBehaviorConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.AGENT_BEHAVIOR_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "AGENT_BEHAVIOR_ACCESS_TOKEN is not set" };
  }
  const config: AgentBehaviorConnectorConfig = {
    accessToken,
    baseUrl: env.AGENT_BEHAVIOR_BASE_URL?.trim() || "https://agent-behavior-bridge.local/agent-behavior",
    source: "agent-behavior-bridge",
  };
  return {
    mode: "live",
    connector: new AgentBehaviorConnector(config, transportOverride ?? makeDefaultAgentBehaviorTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultAgentBehaviorTransport(baseUrl: string): AgentBehaviorTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AgentBehaviorConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AgentBehaviorConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AgentBehaviorConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as AgentBehaviorReportRaw;
  };
}
