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
  // OWN-property lookup only: an inherited entry (custom prototype, or a polluted
  // Object.prototype) for the requested appRef would otherwise rebind an applied,
  // clean, fresh registration to an unknown app and grant. An unknown ref must yield
  // the empty (all-unknown) record the evaluator fails closed on. (Codex P1.)
  return async ({ appRef }) =>
    Object.prototype.hasOwnProperty.call(records, appRef) ? records[appRef] : {};
}
