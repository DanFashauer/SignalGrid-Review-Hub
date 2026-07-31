import type { ShiftContextReportRaw } from "./types";
import type { ShiftContextTransport } from "./shift-context-connector";

export interface MockShiftContextOptions {
  /** workerRef → the raw report to return. An unknown worker yields an empty
   *  (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, ShiftContextReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockShiftContextTransport(opts: MockShiftContextOptions = {}): ShiftContextTransport {
  const reports = opts.reports ?? {};
  return async ({ workerRef }) => reports[workerRef] ?? {};
}
