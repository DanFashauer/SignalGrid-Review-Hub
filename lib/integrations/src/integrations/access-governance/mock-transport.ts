import { AccessGovernanceConnectorError, type AccessGovernanceReportRaw } from "./types";
import type { AccessGovernanceReportTransport } from "./access-governance-connector";

export interface MockAccessGovernanceOptions {
  /** principalId → the raw IGA/PAM-bridge report that principal would return. */
  reports: Record<string, AccessGovernanceReportRaw>;
  /** When set, a request presenting any other token is an auth failure. */
  expectedToken?: string;
}

/**
 * Deterministic, offline transport. Returns the fixture report for a known
 * principal; a bad token → auth_failed (401); an unknown principal → upstream_error
 * (404). The connector never invents a governance posture.
 */
export function createMockAccessGovernanceTransport(
  opts: MockAccessGovernanceOptions,
): AccessGovernanceReportTransport {
  return async ({ principalId, token }): Promise<AccessGovernanceReportRaw> => {
    if (opts.expectedToken !== undefined && token !== opts.expectedToken) {
      throw new AccessGovernanceConnectorError("auth_failed", "bad token", 401);
    }
    const report = opts.reports[principalId];
    if (report === undefined) {
      throw new AccessGovernanceConnectorError("upstream_error", `no report for ${principalId}`, 404);
    }
    return report;
  };
}
