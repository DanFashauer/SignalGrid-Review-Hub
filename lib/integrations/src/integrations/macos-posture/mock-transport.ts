import { MacosPostureConnectorError, type MacosPostureReportRaw } from "./types";
import type { MacosReportTransport } from "./macos-connector";

export interface MockMacosOptions {
  /** deviceId → the raw posture report that device's bridge would return. */
  reports: Record<string, MacosPostureReportRaw>;
  /** When set, a request presenting any other token is an auth failure. */
  expectedToken?: string;
}

/**
 * A deterministic, offline transport. Returns the fixture report for a known
 * device; a bad token surfaces a typed auth_failed error (401); an unknown device
 * surfaces upstream_error (404) — the connector never invents a posture.
 */
export function createMockMacosTransport(opts: MockMacosOptions): MacosReportTransport {
  return async ({ deviceId, token }): Promise<MacosPostureReportRaw> => {
    if (opts.expectedToken !== undefined && token !== opts.expectedToken) {
      throw new MacosPostureConnectorError("auth_failed", "bad token", 401);
    }
    const report = opts.reports[deviceId];
    if (report === undefined) {
      throw new MacosPostureConnectorError("upstream_error", `no report for ${deviceId}`, 404);
    }
    return report;
  };
}
