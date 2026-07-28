import type { CustodyBeaconReportRaw } from "./types";
import type { CustodyBeaconTransport } from "./custody-beacon-connector";

export interface MockCustodyBeaconOptions {
  /** deviceRef → the raw beacon reading to return. An unknown device yields an empty
   *  (all-unknown) reading, which the evaluator fails closed on. */
  readings?: Record<string, CustodyBeaconReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockCustodyBeaconTransport(opts: MockCustodyBeaconOptions = {}): CustodyBeaconTransport {
  const readings = opts.readings ?? {};
  return async ({ deviceRef }) => readings[deviceRef] ?? {};
}
