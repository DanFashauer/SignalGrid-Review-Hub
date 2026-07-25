import { PacsAccessConnectorError, type PacsAccessReportRaw } from "./types";
import type { PacsAccessRequest, PacsAccessTransport } from "./pacs-access-connector";

export interface MockPacsAccessOptions {
  /** deviceId → raw PACS report. */
  reports: Record<string, PacsAccessReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a
 *  real bridge's failure surface: a bad token → auth_failed(401); an unknown device
 *  → upstream_error(404) (never an invented granted entry). */
export function createMockPacsAccessTransport(options: MockPacsAccessOptions): PacsAccessTransport {
  return async ({ deviceId, token }: PacsAccessRequest): Promise<PacsAccessReportRaw> => {
    if (token !== options.expectedToken) {
      throw new PacsAccessConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new PacsAccessConnectorError("upstream_error", `no PACS record for device ${deviceId}`, 404);
    }
    return report;
  };
}
