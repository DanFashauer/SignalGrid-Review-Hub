import { LinkUsabilityConnectorError, type LinkUsabilityReportRaw } from "./types";
import type { LinkUsabilityRequest, LinkUsabilityTransport } from "./link-usability-connector";

export interface MockLinkUsabilityOptions {
  /** deviceId → raw link report. */
  reports: Record<string, LinkUsabilityReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a real
 *  bridge's failure surface: a bad token → auth_failed(401); an unknown device →
 *  upstream_error(404) (never an invented healthy link). */
export function createMockLinkUsabilityTransport(
  options: MockLinkUsabilityOptions,
): LinkUsabilityTransport {
  return async ({ deviceId, token }: LinkUsabilityRequest): Promise<LinkUsabilityReportRaw> => {
    if (token !== options.expectedToken) {
      throw new LinkUsabilityConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new LinkUsabilityConnectorError("upstream_error", `no link record for device ${deviceId}`, 404);
    }
    return report;
  };
}
