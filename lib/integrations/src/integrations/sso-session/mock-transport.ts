import { SsoSessionConnectorError, type SsoSessionReportRaw } from "./types";
import type { SsoSessionRequest, SsoSessionTransport } from "./sso-session-connector";

export interface MockSsoSessionOptions {
  /** deviceId → raw session report. */
  reports: Record<string, SsoSessionReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a
 *  real bridge's failure surface: a bad token → auth_failed(401); an unknown device
 *  → upstream_error(404) (never an invented healthy session). */
export function createMockSsoSessionTransport(options: MockSsoSessionOptions): SsoSessionTransport {
  return async ({ deviceId, token }: SsoSessionRequest): Promise<SsoSessionReportRaw> => {
    if (token !== options.expectedToken) {
      throw new SsoSessionConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new SsoSessionConnectorError("upstream_error", `no session for device ${deviceId}`, 404);
    }
    return report;
  };
}
