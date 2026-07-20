import {
  CARRIER_STATES,
  CHARGE_STATES,
  EVENT_TYPES,
  MDM_STATES,
  TAMPER_STATES,
  type CarrierConnectivityState,
  type ChargeState,
  type EventType,
  type MdmDeviceState,
  type SignalGridEvent,
  type TamperState,
} from "./types";

/**
 * Fail-closed validation of an untrusted inbound event against the canonical
 * contract. In a zero-margin-for-error environment a malformed event must never
 * be admitted onto the fabric — so this rejects anything that does not conform
 * (unknown fields are dropped, bad domains/lengths/types are errors) and never
 * throws on hostile input. Pure and deterministic.
 */

export type ValidateResult =
  | { ok: true; event: SignalGridEvent }
  | { ok: false; errors: string[] };

const MAX_STR = 256;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Linear, length-bounded id/string pattern (no nested quantifiers → no ReDoS).
const SAFE_ID = /^[\w.:@/-]{1,256}$/;

export function validateEvent(input: unknown): ValidateResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["event must be a JSON object"] };
  }
  const raw = input as Record<string, unknown>;

  const eventType = enumField<EventType>(raw, "eventType", EVENT_TYPES, errors, true);
  const eventId = idField(raw, "eventId", errors, true);
  const correlationId = idField(raw, "correlationId", errors, true);
  const tenantId = idField(raw, "tenantId", errors, true);
  const occurredAt = isoField(raw, "occurredAt", errors, true);

  // Optional subjects / physical / governance strings.
  const userId = idField(raw, "userId", errors, false);
  const badgeId = idField(raw, "badgeId", errors, false);
  const mobileCredentialId = idField(raw, "mobileCredentialId", errors, false);
  const deviceId = idField(raw, "deviceId", errors, false);
  const iccid = idField(raw, "iccid", errors, false);
  const dockId = idField(raw, "dockId", errors, false);
  const bayId = idField(raw, "bayId", errors, false);
  const pacsSite = idField(raw, "pacsSite", errors, false);
  const doorOrElevator = idField(raw, "doorOrElevator", errors, false);
  const lastSeenNetwork = strField(raw, "lastSeenNetwork", errors, false);
  const policyVersion = idField(raw, "policyVersion", errors, false);
  const incidentKey = idField(raw, "incidentKey", errors, false);

  // Optional enum states.
  const mdmDeviceState = enumField<MdmDeviceState>(raw, "mdmDeviceState", MDM_STATES, errors, false);
  const carrierConnectivityState = enumField<CarrierConnectivityState>(raw, "carrierConnectivityState", CARRIER_STATES, errors, false);
  const tamperState = enumField<TamperState>(raw, "tamperState", TAMPER_STATES, errors, false);
  const chargeState = enumField<ChargeState>(raw, "chargeState", CHARGE_STATES, errors, false);

  // Battery percent 0–100.
  let batteryPercent: number | undefined;
  if (raw.batteryPercent !== undefined) {
    const n = raw.batteryPercent;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
      errors.push("batteryPercent must be a number in [0,100]");
    } else {
      batteryPercent = n;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build the result from validated fields only — no dynamic obj[userKey] write,
  // so a client-controlled property name cannot pollute the result object.
  const event: SignalGridEvent = {
    eventType: eventType as EventType,
    eventId: eventId as string,
    occurredAt: occurredAt as string,
    correlationId: correlationId as string,
    tenantId: tenantId as string,
  };
  assign(event, "userId", userId);
  assign(event, "badgeId", badgeId);
  assign(event, "mobileCredentialId", mobileCredentialId);
  assign(event, "deviceId", deviceId);
  assign(event, "iccid", iccid);
  assign(event, "dockId", dockId);
  assign(event, "bayId", bayId);
  assign(event, "pacsSite", pacsSite);
  assign(event, "doorOrElevator", doorOrElevator);
  assign(event, "mdmDeviceState", mdmDeviceState);
  assign(event, "carrierConnectivityState", carrierConnectivityState);
  assign(event, "tamperState", tamperState);
  assign(event, "chargeState", chargeState);
  assign(event, "lastSeenNetwork", lastSeenNetwork);
  assign(event, "policyVersion", policyVersion);
  assign(event, "incidentKey", incidentKey);
  if (batteryPercent !== undefined) event.batteryPercent = batteryPercent;
  return { ok: true, event };
}

function assign<K extends keyof SignalGridEvent>(event: SignalGridEvent, key: K, value: SignalGridEvent[K] | undefined): void {
  if (value !== undefined) event[key] = value;
}

function enumField<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  domain: readonly T[],
  errors: string[],
  required: boolean,
): T | undefined {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors.push(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || !domain.includes(v as T)) {
    errors.push(`${key} must be one of: ${domain.join(", ")}`);
    return undefined;
  }
  return v as T;
}

function idField(raw: Record<string, unknown>, key: string, errors: string[], required: boolean): string | undefined {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors.push(`${key} is required`);
    return undefined;
  }
  if (FORBIDDEN_KEYS.has(key) || typeof v !== "string" || !SAFE_ID.test(v)) {
    errors.push(`${key} must be a safe id string (1-${MAX_STR} chars, [A-Za-z0-9 . : @ / _ -])`);
    return undefined;
  }
  return v;
}

function strField(raw: Record<string, unknown>, key: string, errors: string[], required: boolean): string | undefined {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors.push(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.length > MAX_STR) {
    errors.push(`${key} must be a string up to ${MAX_STR} chars`);
    return undefined;
  }
  return v;
}

function isoField(raw: Record<string, unknown>, key: string, errors: string[], required: boolean): string | undefined {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors.push(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    errors.push(`${key} must be an ISO-8601 timestamp`);
    return undefined;
  }
  return v;
}
