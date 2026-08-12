import { LocalAuthorityConnectorError, type LocalAuthorityReportRaw } from "./types";
import type { LocalAuthorityTransport } from "./index";

export interface MockLocalAuthorityOptions {
  /** deviceRef → raw local-authority state report. */
  records: Record<string, LocalAuthorityReportRaw>;
  /** The token the mock source accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of state reports — no network.
 *  Mirrors a real source's failure surface: a bad token → auth_failed(401); an
 *  unknown device → upstream_error(404), never an invented healthy report. The
 *  caller grades a 404 as NOT COVERED via `normalizeLocalAuthority(null, …)`,
 *  which steps up — an honest hole, not a pass. */
export function createMockLocalAuthorityTransport(
  options: MockLocalAuthorityOptions,
): LocalAuthorityTransport {
  return async ({ deviceRef, token }): Promise<LocalAuthorityReportRaw> => {
    if (token !== options.expectedToken) {
      throw new LocalAuthorityConnectorError("auth_failed", "invalid local-authority token", 401);
    }
    const report = options.records[deviceRef];
    if (!report) {
      throw new LocalAuthorityConnectorError(
        "upstream_error",
        `no local-authority record for device ${deviceRef}`,
        404,
      );
    }
    return report;
  };
}
