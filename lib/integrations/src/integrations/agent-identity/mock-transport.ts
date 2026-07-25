import { AgentIdentityConnectorError, type AgentIdentityReportRaw } from "./types";
import type { AgentIdentityRequest, AgentIdentityTransport } from "./agent-identity-connector";

export interface MockAgentIdentityOptions {
  /** deviceId → raw agent-governance report. */
  reports: Record<string, AgentIdentityReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a
 *  real bridge's failure surface: a bad token → auth_failed(401); an unknown device
 *  → upstream_error(404) (never an invented governed actor). */
export function createMockAgentIdentityTransport(options: MockAgentIdentityOptions): AgentIdentityTransport {
  return async ({ deviceId, token }: AgentIdentityRequest): Promise<AgentIdentityReportRaw> => {
    if (token !== options.expectedToken) {
      throw new AgentIdentityConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new AgentIdentityConnectorError("upstream_error", `no actor governance for device ${deviceId}`, 404);
    }
    return report;
  };
}
