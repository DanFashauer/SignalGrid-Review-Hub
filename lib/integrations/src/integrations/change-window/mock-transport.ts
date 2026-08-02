import type { ChangeWindowReportRaw } from "./types";
import type { ChangeWindowTransport } from "./change-window-connector";

export interface MockChangeWindowOptions {
  /** changeRef → the raw record to return. An unknown reference yields an empty
   *  (all-unknown) record, which the evaluator fails closed on. */
  records?: Record<string, ChangeWindowReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockChangeWindowTransport(opts: MockChangeWindowOptions = {}): ChangeWindowTransport {
  const records = opts.records ?? {};
  return async ({ changeRef }) => records[changeRef] ?? {};
}
