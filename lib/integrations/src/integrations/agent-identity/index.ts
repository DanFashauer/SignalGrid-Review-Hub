import {
  AgentIdentityConnector,
  type AgentIdentityConnectorConfig,
  type AgentIdentityTransport,
} from "./agent-identity-connector";
import { AgentIdentityConnectorError, type AgentIdentityReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./agent-identity-connector";
export { createMockAgentIdentityTransport, type MockAgentIdentityOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND AGENT_IDENTITY_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only agent-governance bridge — an agent/NHI registry,
 * a workload-identity platform, or an IGA system that evaluates non-human identities
 * — which reports who is acting and how that identity is governed. SignalGrid
 * consumes that evaluated result: it registers no agent, mints no token, and revokes
 * no access.
 */
export type AgentIdentityConnectorResolution =
  | { mode: "live"; connector: AgentIdentityConnector }
  | { mode: "fixture"; reason: string };

export function resolveAgentIdentityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AgentIdentityTransport,
): AgentIdentityConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.AGENT_IDENTITY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "AGENT_IDENTITY_ACCESS_TOKEN is not set" };
  }
  const config: AgentIdentityConnectorConfig = {
    accessToken,
    baseUrl: env.AGENT_IDENTITY_BASE_URL?.trim() || "https://agent-identity-bridge.local/agent-identity",
    source: "agent-identity-bridge",
  };
  return {
    mode: "live",
    connector: new AgentIdentityConnector(config, transportOverride ?? makeDefaultAgentIdentityTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultAgentIdentityTransport(baseUrl: string): AgentIdentityTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AgentIdentityConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AgentIdentityConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AgentIdentityConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as AgentIdentityReportRaw;
  };
}
