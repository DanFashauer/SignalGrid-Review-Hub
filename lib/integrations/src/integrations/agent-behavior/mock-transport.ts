import { AgentBehaviorConnectorError, type AgentBehaviorReportRaw } from "./types";
import type { AgentBehaviorRequest, AgentBehaviorTransport } from "./agent-behavior-connector";

export interface MockAgentBehaviorOptions {
  /** deviceId → raw behavioral report. */
  reports: Record<string, AgentBehaviorReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a real
 *  bridge's failure surface: a bad token → auth_failed(401); an unknown device →
 *  upstream_error(404) (never an invented in-pattern action). */
export function createMockAgentBehaviorTransport(options: MockAgentBehaviorOptions): AgentBehaviorTransport {
  return async ({ deviceId, token }: AgentBehaviorRequest): Promise<AgentBehaviorReportRaw> => {
    if (token !== options.expectedToken) {
      throw new AgentBehaviorConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new AgentBehaviorConnectorError("upstream_error", `no behavioral evaluation for device ${deviceId}`, 404);
    }
    return report;
  };
}
