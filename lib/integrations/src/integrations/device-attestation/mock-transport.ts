import { AttestationConnectorError, type AttestationReportRaw } from "./types";
import type { AttestationReportTransport } from "./device-attestation-connector";

export interface MockAttestationOptions {
  /** deviceId → the raw attestation-bridge report that device would return. */
  reports: Record<string, AttestationReportRaw>;
  /** When set, a request presenting any other token is an auth failure. */
  expectedToken?: string;
}

/**
 * Deterministic, offline transport. Returns the fixture report for a known device;
 * a bad token → auth_failed (401); an unknown device → upstream_error (404). The
 * connector never invents an attestation result.
 */
export function createMockAttestationTransport(opts: MockAttestationOptions): AttestationReportTransport {
  return async ({ deviceId, token }): Promise<AttestationReportRaw> => {
    if (opts.expectedToken !== undefined && token !== opts.expectedToken) {
      throw new AttestationConnectorError("auth_failed", "bad token", 401);
    }
    const report = opts.reports[deviceId];
    if (report === undefined) {
      throw new AttestationConnectorError("upstream_error", `no report for ${deviceId}`, 404);
    }
    return report;
  };
}
