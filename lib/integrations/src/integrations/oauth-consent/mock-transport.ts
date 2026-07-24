import { OAuthConsentConnectorError, type OAuthConsentReportRaw } from "./types";
import type { OAuthConsentRequest, OAuthConsentTransport } from "./oauth-consent-connector";

export interface MockOAuthConsentOptions {
  /** principalId → raw consent report. */
  reports: Record<string, OAuthConsentReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a
 *  real bridge's failure surface: a bad token → auth_failed(401); an unknown
 *  principal → upstream_error(404) (never an invented governed grant). */
export function createMockOAuthConsentTransport(options: MockOAuthConsentOptions): OAuthConsentTransport {
  return async ({ principalId, token }: OAuthConsentRequest): Promise<OAuthConsentReportRaw> => {
    if (token !== options.expectedToken) {
      throw new OAuthConsentConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[principalId];
    if (!report) {
      throw new OAuthConsentConnectorError("upstream_error", `no consent record for principal ${principalId}`, 404);
    }
    return report;
  };
}
