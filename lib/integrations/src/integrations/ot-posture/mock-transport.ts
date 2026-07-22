import { OtConnectorError, type OtDeviceReportRaw } from "./types";
import type { OtReportTransport } from "./ot-connector";

export interface MockOtOptions {
  /** deviceId → the raw edge-gateway report that device would return. */
  reports: Record<string, OtDeviceReportRaw>;
  /** When set, a request presenting any other token is an auth failure. */
  expectedToken?: string;
}

/**
 * Deterministic, offline transport. Returns the fixture report for a known device;
 * a bad token → auth_failed (401); an unknown device → upstream_error (404). The
 * connector never invents an OT posture.
 */
export function createMockOtTransport(opts: MockOtOptions): OtReportTransport {
  return async ({ deviceId, token }): Promise<OtDeviceReportRaw> => {
    if (opts.expectedToken !== undefined && token !== opts.expectedToken) {
      throw new OtConnectorError("auth_failed", "bad token", 401);
    }
    const report = opts.reports[deviceId];
    if (report === undefined) {
      throw new OtConnectorError("upstream_error", `no report for ${deviceId}`, 404);
    }
    return report;
  };
}
