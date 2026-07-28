import type { PolicyBindingReportRaw } from "./types";
import type { PolicyBindingTransport } from "./policy-binding-connector";

export interface MockPolicyBindingOptions {
  /** deviceRef → the raw report to return. An unknown device yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, PolicyBindingReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockPolicyBindingTransport(opts: MockPolicyBindingOptions = {}): PolicyBindingTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceRef }) => reports[deviceRef] ?? {};
}
