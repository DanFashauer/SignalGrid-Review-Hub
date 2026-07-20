// The SignalGrid canonical event contract.
//
// This is the integration keystone from the founder's architecture notes:
// "you do not need a single monolithic vendor; you need a good event contract and
// deterministic playbooks." Every plane — physical custody (badge/dock/PACS),
// device posture (MDM/Graph), and connectivity (carrier) — emits events in THIS
// one normalized shape, so a shared event fabric can carry cross-domain detections
// that no single tool could see. Pure and deterministic: no time, no randomness.

/** The lifecycle + signal events of the shared-device custody state machine. */
export type EventType =
  | "checkout_requested"
  | "checkout_granted"
  | "checkout_denied"
  | "device_removed"
  | "device_returned"
  | "dock_unlocked"
  | "dock_relocked"
  | "dock_timeout"
  | "tamper_detected"
  | "posture_changed"
  | "reachability_changed"
  | "badge_access"
  | "non_return"
  | "custody_expired";

export const EVENT_TYPES: readonly EventType[] = [
  "checkout_requested",
  "checkout_granted",
  "checkout_denied",
  "device_removed",
  "device_returned",
  "dock_unlocked",
  "dock_relocked",
  "dock_timeout",
  "tamper_detected",
  "posture_changed",
  "reachability_changed",
  "badge_access",
  "non_return",
  "custody_expired",
];

export type MdmDeviceState = "compliant" | "noncompliant" | "unmanaged" | "unknown";
export type CarrierConnectivityState = "online" | "idle" | "offline" | "unknown";
export type TamperState = "none" | "suspected" | "confirmed";
export type ChargeState = "charging" | "discharging" | "full" | "unknown";

export const MDM_STATES: readonly MdmDeviceState[] = ["compliant", "noncompliant", "unmanaged", "unknown"];
export const CARRIER_STATES: readonly CarrierConnectivityState[] = ["online", "idle", "offline", "unknown"];
export const TAMPER_STATES: readonly TamperState[] = ["none", "suspected", "confirmed"];
export const CHARGE_STATES: readonly ChargeState[] = ["charging", "discharging", "full", "unknown"];

/**
 * The canonical event. Every field the architecture doc enumerates is here.
 * A handful are required (they anchor the event to a tenant, a moment, and a
 * correlation); the rest are optional because a given plane only knows its slice.
 */
export interface SignalGridEvent {
  // ── required anchors ──────────────────────────────────────────────────────
  eventType: EventType;
  eventId: string;
  /** ISO-8601 timestamp of when the event occurred (supplied by the emitter). */
  occurredAt: string;
  /** Ties together every event of one custody session / device timeline. */
  correlationId: string;
  tenantId: string;

  // ── subjects ──────────────────────────────────────────────────────────────
  userId?: string;
  badgeId?: string;
  mobileCredentialId?: string;
  deviceId?: string;
  iccid?: string;

  // ── physical custody plane ────────────────────────────────────────────────
  dockId?: string;
  bayId?: string;
  pacsSite?: string;
  doorOrElevator?: string;

  // ── observed states ───────────────────────────────────────────────────────
  mdmDeviceState?: MdmDeviceState;
  carrierConnectivityState?: CarrierConnectivityState;
  tamperState?: TamperState;
  /** Battery percentage 0–100. */
  batteryPercent?: number;
  chargeState?: ChargeState;
  lastSeenNetwork?: string;

  // ── governance ────────────────────────────────────────────────────────────
  policyVersion?: string;
  incidentKey?: string;
}
