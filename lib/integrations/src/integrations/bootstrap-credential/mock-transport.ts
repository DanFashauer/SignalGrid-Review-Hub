import type { BootstrapCredentialReportRaw } from "./types";
import type { BootstrapCredentialTransport } from "./bootstrap-credential-connector";

export interface MockBootstrapCredentialOptions {
  /** subjectRef → the raw report to return. An unknown subject yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, BootstrapCredentialReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockBootstrapCredentialTransport(opts: MockBootstrapCredentialOptions = {}): BootstrapCredentialTransport {
  const reports = opts.reports ?? {};
  return async ({ subjectRef }) => reports[subjectRef] ?? {};
}
