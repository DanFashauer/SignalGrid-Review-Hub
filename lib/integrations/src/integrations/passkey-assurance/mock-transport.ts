import type { PasskeyReportRaw } from "./types";
import type { PasskeyTransport } from "./passkey-assurance-connector";

export interface MockPasskeyOptions {
  /** identityRef → the raw report to return. An unknown identity yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, PasskeyReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockPasskeyTransport(opts: MockPasskeyOptions = {}): PasskeyTransport {
  const reports = opts.reports ?? {};
  return async ({ identityRef }) => reports[identityRef] ?? {};
}
