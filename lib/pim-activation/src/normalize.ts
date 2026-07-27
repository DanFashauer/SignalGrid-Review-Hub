import {
  PIM_ACTIVATION_REQUEST_KEYS,
  type ChangeClass,
  type DeviceRiskTier,
  type NormalizedPimActivation,
  type PimActivationRequestRaw,
  type RequestIntegrity,
  type TicketState,
} from "./types";

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Present but unparseable = an assertion we could not read. `null` counts as absent —
 *  it is the standard wire spelling of "no value". */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** Read a field ONLY if the request asserts it as an OWN property. An inherited value
 *  is the prototype's claim, not this request's, so it must never read as a
 *  confirmation. This pattern, and the chain scan below, are carried over from the
 *  connectors — see `agent-identity-connector.ts`, where six consecutive adversarial
 *  reviews established exactly why the two must be asymmetric. */
function ownValue(request: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(request, key)
    ? (request as Record<string, unknown>)[key]
    : undefined;
}

function isPlainRequest(request: unknown): request is object {
  return typeof request === "object" && request !== null && !Array.isArray(request);
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Any key we do not understand — at ANY depth in the prototype chain, and beyond the
 *  request's own level ANY key at all, recognized or not. A correctly-spelled inherited
 *  key is a stronger assertion than a misspelled one, not a weaker one, and because
 *  values are read own-only it would otherwise be asserted by the caller and read by
 *  nobody. Bounded, because a Proxy may return a fresh prototype on every call. */
function hasUnrecognizedKey(request: object, known: readonly string[]): boolean {
  try {
    let o: object | null = request;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

const TICKET = ["valid", "invalid", "absent", "unknown"] as const;
const CHANGE = ["routine", "emergency", "unknown"] as const;
const TIER = ["ok", "watch", "at_risk", "blocked", "unknown"] as const;

/** Normalize a PIM activation request. Defensive throughout: a missing or unreadable
 *  field yields the fail-safe unknown/null, never a fabricated "valid"/"on call". */
export function normalizeActivationRequest(
  requestId: string,
  request: PimActivationRequestRaw,
  source = "entra-pim-custom-extension",
): NormalizedPimActivation {
  const plain = isPlainRequest(request);
  const raw = {
    ticketState: plain ? ownValue(request, "ticketState") : undefined,
    changeClass: plain ? ownValue(request, "changeClass") : undefined,
    requesterOnCall: plain ? ownValue(request, "requesterOnCall") : undefined,
    deviceRiskTier: plain ? ownValue(request, "deviceRiskTier") : undefined,
    actorConfirmedHuman: plain ? ownValue(request, "actorConfirmedHuman") : undefined,
    signalsFresh: plain ? ownValue(request, "signalsFresh") : undefined,
  };

  const malformed =
    !plain ||
    hasUnrecognizedKey(request, PIM_ACTIVATION_REQUEST_KEYS) ||
    enumMalformed(raw.ticketState, TICKET) ||
    enumMalformed(raw.changeClass, CHANGE) ||
    enumMalformed(raw.deviceRiskTier, TIER) ||
    boolMalformed(raw.requesterOnCall) ||
    boolMalformed(raw.actorConfirmedHuman) ||
    boolMalformed(raw.signalsFresh);

  return {
    sourceSystem: "pim-activation",
    requestId,
    ticketState: oneOf<TicketState>(raw.ticketState, TICKET, "unknown"),
    changeClass: oneOf<ChangeClass>(raw.changeClass, CHANGE, "unknown"),
    requesterOnCall: boolOrNull(raw.requesterOnCall),
    deviceRiskTier: oneOf<DeviceRiskTier>(raw.deviceRiskTier, TIER, "unknown"),
    actorConfirmedHuman: boolOrNull(raw.actorConfirmedHuman),
    signalsFresh: boolOrNull(raw.signalsFresh),
    requestIntegrity: (malformed ? "malformed" : "clean") satisfies RequestIntegrity,
    source,
  };
}
