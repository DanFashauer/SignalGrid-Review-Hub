import type { MemoryStore } from "./store";
import { classifyFreshness, deterministicId } from "./util";
import type { Clock } from "./util";
import {
  CoreError,
  type Connector,
  type ConnectorSyncRun,
  type NormalizedSignal,
  type ShiftContextState,
} from "./types";

export const SHIFT_FRESH_WINDOW_HOURS = 6;
export const SHIFT_STALE_WINDOW_HOURS = 24;

/**
 * A fixture labor-context summary. This is the shape a WFM connector (UKG,
 * Dayforce, ADP and their peers) would produce after the shift-context dimension
 * (`@workspace/integrations/shift-context`) graded one worker's schedule, punch
 * and site coherence — the SUMMARY of that verdict, in the core's vocabulary.
 * Here it is entirely synthetic (public-safe): no WFM is called and no schedule,
 * punch, or payroll record is read or written. Only the two AFFIRMATIVE states
 * are representable on a record — a worker the WFM has no verdict for simply has
 * no record, so evidence reads `unverified` rather than a fabricated value.
 */
export interface ShiftContextRecord {
  deviceRef: string;
  /** "confirmed" (scheduled now + on the clock + site coherent) or "misfit" (an
   *  affirmative labor mismatch). The `unverified` default is expressed by the
   *  ABSENCE of a record, never by a record that asserts it. */
  state: Exclude<ShiftContextState, "unverified">;
  observedAt: string;
  sourceReference: string;
}

/**
 * Run a fixture-backed WFM shift-context sync: normalize labor-context summaries
 * into cached signals so the decision engine can weigh the labor plane alongside
 * identity, posture and custody. Read-only; no punch, schedule, or pay is touched.
 */
export function runShiftSync(
  store: MemoryStore,
  clock: Clock,
  connector: Connector,
  records: ShiftContextRecord[],
): ConnectorSyncRun {
  if (connector.mode !== "fixture") {
    throw new CoreError(
      "connector_unavailable",
      "Only fixture-mode connectors run in the public-safe core.",
      503,
    );
  }

  const startedAt = clock.now().toISOString();
  let signalsNormalized = 0;
  // A record whose subject the store does not know is SKIPPED, and a skip is
  // counted: a run that applied nothing reports "partial", not "success", and the
  // connector is "degraded", not "healthy" (eighth-round verdict-core finding,
  // 2026-09-05 — every record skipped used to read as a clean sync).
  let recordsSkipped = 0;

  for (const record of records) {
    const device = store.findDeviceByRef(connector.tenantId, record.deviceRef);
    if (!device) {
      recordsSkipped += 1;
      continue;
    }
    const freshness = classifyFreshness(
      record.observedAt,
      startedAt,
      SHIFT_FRESH_WINDOW_HOURS,
      SHIFT_STALE_WINDOW_HOURS,
    );
    const signal: NormalizedSignal = {
      // connector.id is in the key; see the note in connector.ts buildSignal.
      id: deterministicId(
        "sig",
        connector.tenantId,
        connector.id,
        "device",
        device.id,
        "shift_context",
      ),
      tenantId: connector.tenantId,
      connectorId: connector.id,
      subjectType: "device",
      subjectId: device.id,
      category: "shift_context",
      value: record.state,
      observedAt: record.observedAt,
      freshness,
      sourceReference: record.sourceReference,
    };
    store.putSignal(signal);
    signalsNormalized += 1;
  }

  const completedAt = clock.now().toISOString();
  const run: ConnectorSyncRun = {
    id: deterministicId("sync", connector.id, startedAt),
    tenantId: connector.tenantId,
    connectorId: connector.id,
    startedAt,
    completedAt,
    status: recordsSkipped === 0 ? "success" : "partial",
    recordsProcessed: records.length - recordsSkipped,
    signalsNormalized,
    note: `WFM shift-context fixture sync: synthetic labor summaries only, read-only, no punch, schedule, or pay touched.${recordsSkipped === 0 ? "" : ` ${recordsSkipped} of ${records.length} record(s) named a device this tenant does not hold and were skipped.`}`,
  };
  store.putSyncRun(run);
  store.putConnector({ ...connector, status: recordsSkipped === 0 ? "healthy" : "degraded", lastSyncAt: completedAt });
  return run;
}
