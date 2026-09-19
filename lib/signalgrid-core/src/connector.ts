import type { MemoryStore } from "./store";
import type { Clock } from "./util";
import { classifyFreshness, deterministicId } from "./util";
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
  /**
   * The identity this posture read also speaks for. OPTIONAL because a
   * device-posture source (Fleet/osquery, for one) answers nothing about an
   * identity, and naming one anyway would be an identity fact nobody read.
   * Absent = the record carries device posture only; the identity signal is not
   * written and the evidence readers turn that silence into unknown.
   */
  identityRef?: string;
  /** Absent = the source did not answer. Silence, never a synthesized enabled/disabled. */
  identityEnabled?: boolean;
  managed: boolean;
  compliance: "compliant" | "non_compliant" | "unknown";
  /** Absent = the source did not answer; emits nothing rather than an unearned
   *  `false` (the unearned NEGATIVE, as forbidden as the unearned affirmative). */
  encrypted?: boolean;
  /** Absent = the source did not answer. Same rule. */
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
  return applyPostureRecords(store, clock, connector, records);
}

/**
 * Normalize posture records into signals + a sync run. ONE normalizer, shared by
 * the fixture entry guard above and by the live entry guard in `live-sync.ts` —
 * the alternative is a second copy of this normalization in the live path, which
 * is how two copies drift. It carries NO mode check of its own: the two callers
 * are the guards.
 */
export function applyPostureRecords(
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

  for (const record of records) {
    const device = store.findDeviceByRef(connector.tenantId, record.deviceRef);
    // The identity is looked up only when the record NAMES one. A record that
    // carries device posture alone is not "missing" an identity — it never
    // claimed one — so it is not skipped for the absence.
    const identity =
      record.identityRef === undefined
        ? undefined
        : store.findIdentityByRef(connector.tenantId, record.identityRef);
    if (!device || (record.identityRef !== undefined && !identity)) {
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
      // Encryption and OS support only when the source answered. Same rule the
      // three optional families below already follow: silence normalizes to
      // unknown, which RAISES the assurance bar; a synthesized `false` would be
      // an affirmative bad state nobody read. Their POSITION in this list is
      // load-bearing — signals land in the store in insertion order and an
      // evidence snapshot digests that order, so moving them re-digests every
      // durable snapshot ever written.
      ...(record.encrypted !== undefined
        ? [{ category: "device_encryption" as SignalCategory, value: record.encrypted }]
        : []),
      ...(record.osSupported !== undefined
        ? [{ category: "os_support" as SignalCategory, value: record.osSupported }]
        : []),
      { category: "posture_freshness", value: postureFreshness },
    ];

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

    if (identity !== undefined && record.identityEnabled !== undefined) {
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
    // The note names the MODE it actually ran in. It used to say "Fixture sync"
    // unconditionally, which the live entry guard would have turned into a
    // false statement on every live run.
    note:
      (connector.mode === "fixture"
        ? "Fixture sync: synthetic posture only, read-only, no Graph call."
        : "Live sync: read-only posture from the connector's registered source.") +
      (recordsSkipped === 0
        ? ""
        : ` ${recordsSkipped} of ${records.length} record(s) named a device or identity this tenant does not hold and were skipped.`),
  };
  store.putSyncRun(run);

  store.putConnector({
    ...connector,
    status: recordsSkipped === 0 ? "healthy" : "degraded",
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
