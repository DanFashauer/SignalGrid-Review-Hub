import type { MemoryStore } from "./store";
import type { Clock } from "./util";
import { classifyFreshness, deterministicId, FRESH_WINDOW_HOURS, STALE_WINDOW_HOURS } from "./util";
import {
  CoreError,
  type BaselineState,
  type LocalAuthorityGrantState,
  type ManagementHealthState,
  type Connector,
  type ConnectorSyncRun,
  type NormalizedSignal,
  type SignalCategory,
  type SubjectType,
} from "./types";

/** Freshness windows (hours) applied when normalizing posture signals. */
export { FRESH_WINDOW_HOURS, STALE_WINDOW_HOURS } from "./util";

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
  /**
   * Optional: a source that did not read encryption (Graph's managedDevices list
   * without `isEncrypted`) leaves it ABSENT, and an absent signal evaluates as
   * "unknown" — `criticalSignalsPresent` then fails closed, so allow can never
   * fire on a fact nobody read. Never default it to true or false.
   */
  encrypted?: boolean;
  /** Optional, same rule as `encrypted`. */
  osSupported?: boolean;
  /** Last Intune sync time; drives posture freshness. */
  lastSyncAt: string | null;
  /**
   * Optional security-baseline (CIS/hardening) alignment reported by the
   * posture source against the device's assigned benchmark profile. Absent =
   * the source reported no baseline, which normalizes to "unknown" (never
   * assumed aligned).
   */
  baseline?: BaselineState;
  /**
   * Optional management-plane health rollup from the device-management-health
   * family (enrollment + check-in freshness + drift). Absent = the source
   * reported nothing, which normalizes to "unknown" — never assumed healthy.
   */
  managementHealth?: ManagementHealthState;
  /**
   * Optional local-authority grant rollup. Absent = "unverified" (day-one-quiet);
   * only an affirmative "withheld" restricts.
   */
  localAuthority?: LocalAuthorityGrantState;
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
  return runPostureSync(store, clock, connector, records);
}

/**
 * Apply already-fetched posture records to the store, in either mode. The
 * records are the caller's: a fixture connector's committed dataset, or what an
 * estate deployment read from its real source BEFORE constructing the core. The
 * core performs no I/O here either way — same normalization, same freshness
 * windows, same skip-and-count rule for an unknown subject.
 */
export function runPostureSync(
  store: MemoryStore,
  clock: Clock,
  connector: Connector,
  records: FixturePostureRecord[],
): ConnectorSyncRun {

  const startedAt = clock.now().toISOString();
  const nowIso = startedAt;
  let signalsNormalized = 0;
  // A record whose subject the store does not know is SKIPPED, and a skip is
  // counted: a run that applied nothing reports "partial", not "success", and the
  // connector is "degraded", not "healthy" (eighth-round verdict-core finding,
  // 2026-09-05 — every record skipped used to read as a clean sync).
  let recordsSkipped = 0;
  // RETRACTION (DR-059). A sync after this connector's FIRST is a refresh. On a
  // refresh, a fact the source stopped reporting — or a device it stopped listing
  // — is retracted: the category is re-put with value null at this instant, which
  // every evidence reader folds to "unknown". Before this, the upsert kept the last
  // affirmative forever (a refresh with `encrypted` omitted still allowed; a device
  // dropped from the feed kept its verdict; `[]` was a healthy success). Boot has
  // no prior run and retracts nothing, so the pinned first-sync snapshots stand.
  const isRefresh = store.listSyncRuns(connector.tenantId, connector.id).length > 0;
  const emittedByDevice = new Map<string, Set<SignalCategory>>();
  let retracted = 0;

  for (const record of records) {
    const device = store.findDeviceByRef(connector.tenantId, record.deviceRef);
    const identity = store.findIdentityByRef(
      connector.tenantId,
      record.identityRef,
    );
    if (!device || !identity) {
      // A record referencing an unknown subject is skipped, not trusted.
      recordsSkipped += 1;
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
    ];
    // A fact the source did not read is NOT emitted: evidence reads the absent
    // category as "unknown" and the allow path refuses on it. Emission ORDER is
    // part of the snapshot digest the migration proof pins, so the two optional
    // facts keep their original slots between management and freshness.
    if (record.encrypted !== undefined) {
      deviceSignals.push({ category: "device_encryption", value: record.encrypted });
    }
    if (record.osSupported !== undefined) {
      deviceSignals.push({ category: "os_support", value: record.osSupported });
    }
    deviceSignals.push({ category: "posture_freshness", value: postureFreshness });

    // Security-baseline (CIS/hardening) alignment, when the source reports it.
    if (record.baseline !== undefined) {
      deviceSignals.push({
        category: "security_baseline",
        value: record.baseline,
      });
    }

    // The two other launch families, when the source reports them. Absence emits
    // nothing — the evidence readers turn silence into "unknown"/"unverified",
    // never into a healthy plane or a live grant.
    if (record.managementHealth !== undefined) {
      deviceSignals.push({
        category: "device_management_health",
        value: record.managementHealth,
      });
    }
    if (record.localAuthority !== undefined) {
      deviceSignals.push({
        category: "local_authority",
        value: record.localAuthority,
      });
    }

    emittedByDevice.set(device.id, new Set(deviceSignals.map((s) => s.category)));
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

  if (isRefresh) {
    for (const device of store.listDevices(connector.tenantId)) {
      const emitted = emittedByDevice.get(device.id) ?? new Set<SignalCategory>();
      const prior = store
        .listSignalsForSubject(connector.tenantId, "device", device.id)
        .filter((s) => s.connectorId === connector.id && s.value !== null && !emitted.has(s.category));
      for (const s of prior) {
        store.putSignal(buildSignal(connector, "device", device.id, s.category, null, nowIso, "unknown", s.sourceReference));
        retracted += 1;
      }
    }
  }
  // A refresh that carries no records confirms nothing: it is a partial run on a
  // degraded connector, never a healthy success that re-affirms the old answers.
  const confirmedNothing = isRefresh && records.length === 0;
  const clean = recordsSkipped === 0 && !confirmedNothing;

  const completedAt = clock.now().toISOString();
  const run: ConnectorSyncRun = {
    id: deterministicId("sync", connector.id, startedAt),
    tenantId: connector.tenantId,
    connectorId: connector.id,
    startedAt,
    completedAt,
    status: clean ? "success" : "partial",
    recordsProcessed: records.length - recordsSkipped,
    signalsNormalized,
    note:
      (recordsSkipped === 0
        ? "Fixture sync: synthetic posture only, read-only, no Graph call."
        : `Fixture sync: synthetic posture only, read-only, no Graph call. ${recordsSkipped} of ${records.length} record(s) named a device or identity this tenant does not hold and were skipped.`) +
      (confirmedNothing ? " The refresh carried no records: nothing was confirmed." : "") +
      (retracted > 0 ? ` ${retracted} previously reported fact(s) the source no longer reports were retracted to unknown.` : ""),
  };
  store.putSyncRun(run);

  store.putConnector({
    ...connector,
    status: clean ? "healthy" : "degraded",
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
      // The connector id is PART OF THE KEY, and that is the whole point.
      // Without it, two connectors reporting the same category for the same
      // device mint the SAME id, and `store.putSignal` overwrites in place with
      // no freshness comparison — so a second source carrying an OLDER reading
      // silently erased a newer one and the outcome flipped deny -> allow.
      // Per-connector rows now coexist, which lets `groupLatest` in evidence.ts
      // do the greatest-observedAt arbitration it was always written to do.
      connector.id,
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
