import type { SseEgressReportRaw } from "./types";
import type { SseEgressTransport } from "./sse-egress-connector";

export interface MockSseEgressOptions {
  /** deviceId → the raw report to return. An unknown device yields an empty
   *  (all-unknown) report, which the evaluator never grades PROTECTED. */
  reports?: Record<string, SseEgressReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockSseEgressTransport(opts: MockSseEgressOptions = {}): SseEgressTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceId }) => reports[deviceId] ?? {};
}
