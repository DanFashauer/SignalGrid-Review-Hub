import type { AppProtectionReportRaw } from "./types";
import type { AppProtectionTransport } from "./app-protection-connector";

export interface MockAppProtectionOptions {
  /** appRef → the raw registration to return. An unknown reference yields an empty
   *  (all-unknown) record, which the evaluator fails closed on. */
  records?: Record<string, AppProtectionReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockAppProtectionTransport(opts: MockAppProtectionOptions = {}): AppProtectionTransport {
  const records = opts.records ?? {};
  return async ({ appRef }) => records[appRef] ?? {};
}
