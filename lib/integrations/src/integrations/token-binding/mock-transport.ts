import { TokenBindingConnectorError, type TokenBindingReportRaw } from "./types";
import type { TokenBindingRequest, TokenBindingTransport } from "./token-binding-connector";

export interface MockTokenBindingOptions {
  /** deviceId → raw token-binding report. */
  reports: Record<string, TokenBindingReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a
 *  real bridge's failure surface: a bad token → auth_failed(401); an unknown device
 *  → upstream_error(404) (never an invented sender-constrained token). */
export function createMockTokenBindingTransport(options: MockTokenBindingOptions): TokenBindingTransport {
  return async ({ deviceId, token }: TokenBindingRequest): Promise<TokenBindingReportRaw> => {
    if (token !== options.expectedToken) {
      throw new TokenBindingConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new TokenBindingConnectorError("upstream_error", `no token binding for device ${deviceId}`, 404);
    }
    return report;
  };
}
