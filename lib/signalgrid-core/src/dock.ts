import type { MemoryStore } from "./store";
import { classifyFreshness, deterministicId } from "./util";
import type { Clock } from "./util";
import {
  CoreError,
  type BadgeBindingState,
  type BatteryHealthState,
  type ChargeState,
  type Connector,
  type ConnectorSyncRun,
  type CustodyState,
  type DockState,
  type NormalizedSignal,
  type SignalCategory,
  type TamperState,
} from "./types";

export const CUSTODY_FRESH_WINDOW_HOURS = 6;
export const CUSTODY_STALE_WINDOW_HOURS = 24;

/**
 * A fixture dock/custody event. This is the shape a DockBridge connector would
 * normalize from a dock, cradle, smart locker, or return station — via an
 * app embedded in the dock, a vendor event API, or an edge gateway. Here it is
 * entirely synthetic (public-safe): no hardware is touched and no vendor call
 * is made. Fields mirror the repo's vendor-neutral physical-custody schema.
 */
export interface DockCustodyRecord {
  deviceRef: string;
  hardwareVendor: string;
  hardwareModel: string;
  caseSerial: string;
  dockId: string;
  bayId: string;
  chargeState: ChargeState;
  /**
   * Battery HEALTH, optional: absent means the dock reported no health read,
   * which normalizes to "unknown". Deliberately separate from `chargeState` —
   * a dock that can only measure fill level has nothing to say here, and must
   * not have "healthy" inferred on its behalf.
   */
  batteryHealth?: BatteryHealthState;
  dockState: DockState;
  custodyState: CustodyState;
  tamperState: TamperState;
  /**
   * Badge-binding read from the reader case (the case with `caseSerial` is the
   * RFID/prox reader). Optional: absent means the record carried no badge read,
   * which normalizes to "unknown".
   */
  badgeBinding?: BadgeBindingState;
  observedAt: string;
  sourceReference: string;
}

/**
 * Run a fixture-backed DockBridge sync: normalize custody/charging/dock/tamper
 * events into cached signals so the decision engine can combine physical
 * custody with identity and posture. Read-only; no dock actions are performed.
 */
export function runDockSync(
  store: MemoryStore,
  clock: Clock,
  connector: Connector,
  records: DockCustodyRecord[],
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

  for (const record of records) {
    const device = store.findDeviceByRef(connector.tenantId, record.deviceRef);
    if (!device) {
      continue;
    }
    const freshness = classifyFreshness(
      record.observedAt,
      startedAt,
      CUSTODY_FRESH_WINDOW_HOURS,
      CUSTODY_STALE_WINDOW_HOURS,
    );
    const pairs: Array<{ category: SignalCategory; value: NormalizedSignal["value"] }> = [
      { category: "custody_state", value: record.custodyState },
      { category: "charge_state", value: record.chargeState },
      { category: "tamper_state", value: record.tamperState },
      { category: "dock_state", value: record.dockState },
    ];
    // Only docks that actually measure battery health report it. Absent stays
    // absent: no signal is emitted, so evidence reads "unknown" rather than a
    // fabricated "healthy".
    if (record.batteryHealth !== undefined) {
      pairs.push({ category: "battery_health", value: record.batteryHealth });
    }
    // The reader case reports a badge-binding read when present.
    if (record.badgeBinding !== undefined) {
      pairs.push({ category: "badge_binding", value: record.badgeBinding });
    }
    for (const pair of pairs) {
      store.putSignal({
        // connector.id is in the key so a second dock feed cannot overwrite this
        // row; see the note in connector.ts buildSignal.
        id: deterministicId(
          "sig",
          connector.tenantId,
          connector.id,
          "device",
          device.id,
          pair.category,
        ),
        tenantId: connector.tenantId,
        connectorId: connector.id,
        subjectType: "device",
        subjectId: device.id,
        category: pair.category,
        value: pair.value,
        observedAt: record.observedAt,
        freshness,
        sourceReference: record.sourceReference,
      });
      signalsNormalized += 1;
    }
  }

  const completedAt = clock.now().toISOString();
  const run: ConnectorSyncRun = {
    id: deterministicId("sync", connector.id, startedAt),
    tenantId: connector.tenantId,
    connectorId: connector.id,
    startedAt,
    completedAt,
    status: "success",
    recordsProcessed: records.length,
    signalsNormalized,
    note: `DockBridge fixture sync (${connector.ingestionMode ?? "app_in_dock"}): synthetic custody events only, read-only, no dock action.`,
  };
  store.putSyncRun(run);
  store.putConnector({ ...connector, status: "healthy", lastSyncAt: completedAt });
  return run;
}
