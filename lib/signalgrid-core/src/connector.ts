import type { MemoryStore } from "./store";
import type { Clock } from "./util";
import { classifyFreshness, deterministicId } from "./util";
import {
  CoreError,
  type Connector,
  type ConnectorSyncRun,
  type NormalizedSignal,
  type SignalCategory,
  type SubjectType,
} from "./types";

/** Freshness windows (hours) applied when normalizing posture signals. */
export const FRESH_WINDOW_HOURS = 24;
export const STALE_WINDOW_HOURS = 72;

/**
 * A fixture posture record. This is the shape a read-only Microsoft
 * Entra/Intune connector would normalize from `GET /deviceManagement/
 * managedDevices` — but here it is entirely synthetic. No Graph call is made,
 * no credential is used, and nothing leaves this process.
 */
export interface FixturePostureRecord {
  deviceRef: string;
  identityRef: string;
  identityEnabled: boolean;
  managed: boolean;
  compliance: "compliant" | "non_compliant" | "unknown";
  encrypted: boolean;
  osSupported: boolean;
  /** Last Intune sync time; drives posture freshness. */
  lastSyncAt: string | null;
  sourceReference: string;
}

/**
 * Run a fixture-backed connector sync. Mirrors the plan's connector-worker
 * contract: sync on a controlled interval, normalize posture signals, mark
 * freshness, and make cached signals available to the decision engine — so the
 * decision path never depends on a live Graph call.
 */
export function runFixtureSync(
  store: MemoryStore,
  clock: Clock,
  connector: Connector,
  records: FixturePostureRecord[],
): ConnectorSyncRun {
  if (connector.mode !== "fixture") {
    throw new CoreError(
      "connector_unavailable",
      "Only fixture-mode connectors run in the public-safe core.",
      503,
    );
  }

  const startedAt = clock.now().toISOString();
  const nowIso = startedAt;
  let signalsNormalized = 0;

  for (const record of records) {
    const device = store.findDeviceByRef(connector.tenantId, record.deviceRef);
    const identity = store.findIdentityByRef(
      connector.tenantId,
      record.identityRef,
    );
    if (!device || !identity) {
      // A record referencing an unknown subject is skipped, not trusted.
      continue;
    }

    const postureFreshness = classifyFreshness(
      record.lastSyncAt,
      nowIso,
      FRESH_WINDOW_HOURS,
      STALE_WINDOW_HOURS,
    );

    const deviceSignals: Array<{
      category: SignalCategory;
      value: NormalizedSignal["value"];
    }> = [
      { category: "device_compliance", value: record.compliance },
      { category: "device_management", value: record.managed },
      { category: "device_encryption", value: record.encrypted },
      { category: "os_support", value: record.osSupported },
      { category: "posture_freshness", value: postureFreshness },
    ];

    for (const spec of deviceSignals) {
      store.putSignal(
        buildSignal(
          connector,
          "device",
          device.id,
          spec.category,
          spec.value,
          nowIso,
          postureFreshness,
          record.sourceReference,
        ),
      );
      signalsNormalized += 1;
    }

    store.putSignal(
      buildSignal(
        connector,
        "identity",
        identity.id,
        "identity_state",
        record.identityEnabled,
        nowIso,
        // Identity state is read live from the directory in the model, so it is
        // treated as fresh at evaluation time in the fixture.
        "fresh",
        record.sourceReference,
      ),
    );
    signalsNormalized += 1;
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
    note: "Fixture sync: synthetic posture only, read-only, no Graph call.",
  };
  store.putSyncRun(run);

  store.putConnector({
    ...connector,
    status: "healthy",
    lastSyncAt: completedAt,
  });

  return run;
}

function buildSignal(
  connector: Connector,
  subjectType: SubjectType,
  subjectId: string,
  category: SignalCategory,
  value: NormalizedSignal["value"],
  observedAt: string,
  freshness: NormalizedSignal["freshness"],
  sourceReference: string,
): NormalizedSignal {
  return {
    id: deterministicId(
      "sig",
      connector.tenantId,
      subjectType,
      subjectId,
      category,
    ),
    tenantId: connector.tenantId,
    connectorId: connector.id,
    subjectType,
    subjectId,
    category,
    value,
    observedAt,
    freshness,
    sourceReference,
  };
}
