import type { BenchmarkSelectionReportRaw } from "./types";
import type { BenchmarkSelectionTransport } from "./benchmark-selection-connector";

export interface MockBenchmarkSelectionOptions {
  /** deviceRef → the raw report to return. An unknown device yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, BenchmarkSelectionReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockBenchmarkSelectionTransport(
  opts: MockBenchmarkSelectionOptions = {},
): BenchmarkSelectionTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceRef }) => reports[deviceRef] ?? {};
}
