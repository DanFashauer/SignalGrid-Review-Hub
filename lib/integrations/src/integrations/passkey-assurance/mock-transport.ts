import type { PasskeyReportRaw } from "./types";
import type { PasskeyTransport } from "./passkey-assurance-connector";

export interface MockPasskeyOptions {
  /** identityRef → the raw report to return when no credential is named. An unknown
   *  identity yields an empty (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, PasskeyReportRaw>;
  /** `identityRef/credentialRef` → the raw report for one specific credential, so a
   *  fixture can model an identity holding SEVERAL credentials of differing worth —
   *  the case the identity-level aggregation exists for. */
  credentialReports?: Record<string, PasskeyReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockPasskeyTransport(opts: MockPasskeyOptions = {}): PasskeyTransport {
  const reports = opts.reports ?? {};
  const credentialReports = opts.credentialReports ?? {};
  return async ({ identityRef, credentialRef }) => {
    if (credentialRef !== undefined) {
      return credentialReports[`${identityRef}/${credentialRef}`] ?? {};
    }
    return reports[identityRef] ?? {};
  };
}
