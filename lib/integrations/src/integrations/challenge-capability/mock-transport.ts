import type { ChallengeCapabilityReportRaw } from "./types";
import type { ChallengeCapabilityTransport } from "./challenge-capability-connector";

export interface MockChallengeCapabilityOptions {
  /** deviceRef → the raw report to return. An unknown pair yields an empty
   *  (methods-absent) report, which the evaluator never grades READY. */
  reports?: Record<string, ChallengeCapabilityReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockChallengeCapabilityTransport(opts: MockChallengeCapabilityOptions = {}): ChallengeCapabilityTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceRef }) => reports[deviceRef] ?? {};
}
