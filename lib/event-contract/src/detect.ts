import type { SignalGridEvent } from "./types";

/**
 * Cross-domain detections over a single correlation timeline.
 *
 * These are the detections the founder's notes call out as only possible because
 * the physical-custody, device-posture, and connectivity planes share ONE event
 * fabric — the kind a standalone MDM, SIEM, or PACS could never see on its own
 * (e.g. "inactive in MDM but still showing cellular or badge activity"). Pure and
 * deterministic: set-based reasoning over the events, no clock, no randomness, so
 * the same timeline always yields the same detections — evidence-grade.
 */

export type DetectionSeverity = "info" | "medium" | "high" | "critical";

export type DetectionCode =
  | "CHECKOUT_WITHOUT_COMPLIANCE"
  | "REMOVED_WITHOUT_BADGE_ACCESS"
  | "LEFT_PREMISES_WITHOUT_RETURN"
  | "DOCK_TAMPER_WITH_NETWORK_LOSS"
  | "INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE";

export interface Detection {
  code: DetectionCode;
  severity: DetectionSeverity;
  reason: string;
  correlationId: string;
  evidenceEventIds: string[];
}

export function detectCrossDomain(events: readonly SignalGridEvent[]): Detection[] {
  const detections: Detection[] = [];
  if (events.length === 0) return detections;
  const correlationId = events[0].correlationId;

  const idsWhere = (pred: (e: SignalGridEvent) => boolean): string[] =>
    events.filter(pred).map((e) => e.eventId);

  const has = (pred: (e: SignalGridEvent) => boolean): boolean => events.some(pred);

  // 1. Checkout was granted, but the device never became compliant on the fabric.
  const grants = idsWhere((e) => e.eventType === "checkout_granted");
  const becameCompliant = has((e) => e.mdmDeviceState === "compliant");
  if (grants.length > 0 && !becameCompliant) {
    detections.push({
      code: "CHECKOUT_WITHOUT_COMPLIANCE",
      severity: "high",
      reason: "A device was checked out but no compliant posture was ever observed for it.",
      correlationId,
      evidenceEventIds: grants,
    });
  }

  // 2. Device left its bay, but the holder never badged into an authorized zone.
  const removals = idsWhere((e) => e.eventType === "device_removed");
  const badgedIn = has((e) => e.eventType === "badge_access");
  if (removals.length > 0 && !badgedIn) {
    detections.push({
      code: "REMOVED_WITHOUT_BADGE_ACCESS",
      severity: "high",
      reason: "A device was removed from its bay with no corresponding badge access into an authorized zone.",
      correlationId,
      evidenceEventIds: removals,
    });
  }

  // 3. The device went dark or its custody lapsed, and it was never returned.
  const wentOffline = idsWhere(
    (e) => e.eventType === "reachability_changed" && e.carrierConnectivityState === "offline",
  );
  const lapsed = idsWhere((e) => e.eventType === "non_return" || e.eventType === "custody_expired");
  const returned = has((e) => e.eventType === "device_returned");
  const exitEvidence = [...wentOffline, ...lapsed];
  if (exitEvidence.length > 0 && !returned) {
    detections.push({
      code: "LEFT_PREMISES_WITHOUT_RETURN",
      severity: "high",
      reason: "The device went offline or its custody lapsed and no return event was ever recorded.",
      correlationId,
      evidenceEventIds: exitEvidence,
    });
  }

  // 4. Tamper plus loss of connectivity — the classic "someone's working on it
  //    where we can't see it" signal. Critical.
  const tamper = idsWhere((e) => e.tamperState === "suspected" || e.tamperState === "confirmed");
  if (tamper.length > 0 && wentOffline.length > 0) {
    detections.push({
      code: "DOCK_TAMPER_WITH_NETWORK_LOSS",
      severity: "critical",
      reason: "Tamper was detected while the device also lost connectivity.",
      correlationId,
      evidenceEventIds: [...tamper, ...wentOffline],
    });
  }

  // 5. The device is dark in MDM (unmanaged/unknown) yet demonstrably alive
  //    elsewhere — on cellular or badging in. Only visible on a shared fabric.
  const darkInMdm = idsWhere((e) => e.mdmDeviceState === "unmanaged" || e.mdmDeviceState === "unknown");
  const aliveElsewhere = idsWhere(
    (e) =>
      e.eventType === "badge_access" ||
      (e.eventType === "reachability_changed" && (e.carrierConnectivityState === "online" || e.carrierConnectivityState === "idle")),
  );
  if (darkInMdm.length > 0 && aliveElsewhere.length > 0) {
    detections.push({
      code: "INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE",
      severity: "high",
      reason: "The device is unmanaged/unknown in MDM but is still active on cellular or badging in.",
      correlationId,
      evidenceEventIds: [...darkInMdm, ...aliveElsewhere],
    });
  }

  return detections;
}
