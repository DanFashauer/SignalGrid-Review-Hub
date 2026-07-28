import type { PlatformSsoReportRaw } from "./types";
import type { PlatformSsoTransport } from "./platform-sso-connector";

export interface MockPlatformSsoOptions {
  /** deviceRef → the raw report to return. An unknown device yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, PlatformSsoReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockPlatformSsoTransport(opts: MockPlatformSsoOptions = {}): PlatformSsoTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceRef }) => reports[deviceRef] ?? {};
}
