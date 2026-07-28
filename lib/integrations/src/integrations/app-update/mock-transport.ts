import type { AppUpdateReportRaw } from "./types";
import type { AppUpdateTransport } from "./app-update-connector";

export interface MockAppUpdateOptions {
  /** `${deviceRef}/${appRef}` → the raw report to return. An unknown pair yields an
   *  empty (all-unknown) report, which the evaluator fails closed on. */
  reports?: Record<string, AppUpdateReportRaw>;
}

/** Deterministic fixture transport for tests/proofs — no network, no clock. */
export function createMockAppUpdateTransport(opts: MockAppUpdateOptions = {}): AppUpdateTransport {
  const reports = opts.reports ?? {};
  return async ({ deviceRef, appRef }) => reports[`${deviceRef}/${appRef}`] ?? {};
}
