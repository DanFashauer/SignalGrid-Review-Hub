import type { EstateSubject } from "@workspace/signalgrid-core";
import type { GraphPostureSignal } from "./types";

/**
 * Turn what the read-only Graph connector observed into the subjects an estate
 * core is built from. Every mapping here tightens or preserves; none loosens:
 *
 *   - a device with no resolvable owner is SKIPPED and counted — an ownerless
 *     device is not a subject the core can decide about, and inventing one
 *     would give every such device a shared synthetic identity;
 *   - `in_grace_period`, `missing` and `unknown` compliance never read as
 *     compliant; only `compliant` does, and only `unknown`/`missing` stay unknown;
 *   - only `managed` reads as managed; `retire_pending` and `unknown` do not;
 *   - encryption and OS support are NOT read by the posture connector, so they
 *     are left absent — the core evaluates absent as "unknown" and allow refuses.
 */
export interface GraphEstateMapping {
  subjects: EstateSubject[];
  /** Devices the source reported with no resolvable owner: counted, never guessed. */
  skippedOwnerless: number;
}

export function toEstateSubjects(signals: readonly GraphPostureSignal[]): GraphEstateMapping {
  const subjects: EstateSubject[] = [];
  let skippedOwnerless = 0;
  for (const signal of signals) {
    if (signal.subjectId === null) {
      skippedOwnerless += 1;
      continue;
    }
    const compliance =
      signal.deviceComplianceState === "compliant"
        ? "compliant"
        : signal.deviceComplianceState === "non_compliant" || signal.deviceComplianceState === "in_grace_period"
          ? "non_compliant"
          : "unknown";
    subjects.push({
      identity: {
        externalRef: signal.subjectId,
        displayName: signal.subjectId,
        state: signal.identityStatus,
        assignedRole: "unassigned",
      },
      device: {
        externalRef: signal.deviceId,
        name: signal.deviceId,
        osPlatform: "unknown",
        osVersion: "unknown",
        ownerType: "unknown",
        managementAgent: signal.deviceManagementState === "managed" ? "intune" : "unknown",
      },
      posture: {
        identityEnabled: signal.identityStatus === "enabled",
        managed: signal.deviceManagementState === "managed",
        compliance,
        lastSyncAt: signal.deviceLastSeenAt,
        sourceReference: `${signal.sourceSystem}:managedDevices#${signal.deviceId}`,
      },
    });
  }
  return { subjects, skippedOwnerless };
}
