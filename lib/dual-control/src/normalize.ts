import {
  AUTHORIZER_ATTESTATION_KEYS,
  DUAL_CONTROL_REQUEST_KEYS,
  type AuthenticatorClass,
  type CoPresenceState,
  type DualControlRequestRaw,
  type ElevatedActionClass,
  type NormalizedAuthorizer,
  type NormalizedDualControl,
  type RequestIntegrity,
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

/** A non-empty string, trimmed; anything else is null. An identity/credential reference
 *  that is not a plain non-empty string is not a reference we can compare. */
function refOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** Present but unparseable = an assertion we could not read. `null`/`undefined` = absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** A reference field is malformed only if present as a non-string, or an empty string. */
function refMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return v.trim().length === 0;
}

/** Read a field ONLY as an OWN property. An inherited value is the prototype's claim, not
 *  this request's, so it must never read as a confirmation. This pattern, and the chain
 *  scan below, are carried over from the connectors — see `agent-identity-connector.ts`. */
function ownValue(obj: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

function isPlainObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Any key we do not understand — at ANY depth in the prototype chain, and beyond the
 *  object's own level ANY key at all. A correctly-spelled inherited key is a stronger
 *  assertion than a misspelled one, not a weaker one, and because values are read
 *  own-only it would otherwise be asserted by the caller and read by nobody. Bounded,
 *  because a Proxy may return a fresh prototype on every call. */
function hasUnrecognizedKey(obj: object, known: readonly string[]): boolean {
  try {
    let o: object | null = obj;
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

const ACTION_CLASS = ["break_glass", "privileged_config", "bulk_data", "unknown"] as const;
const AUTHENTICATOR = ["platform", "security_key", "unknown"] as const;
const CO_PRESENCE = ["confirmed", "expired", "unknown"] as const;

/** Parse one authorizer attestation. Returns the normalized authorizer AND whether it
 *  parsed cleanly, so the top-level integrity flag can fold both authorizers in. */
function normalizeAuthorizer(raw: unknown): { value: NormalizedAuthorizer; malformed: boolean } {
  const plain = isPlainObject(raw);
  const get = (k: string): unknown => (plain ? ownValue(raw, k) : undefined);
  // The reads themselves can throw: an own property may be an ACCESSOR whose getter
  // throws. A field we cannot READ is exactly a field we cannot confirm, so a throw
  // forces every value to the fail-safe and marks the authorizer malformed — the same
  // fail-closed reading `hasUnrecognizedKey` already applies to a throwing `ownKeys`.
  let identityRef: unknown;
  let credentialRef: unknown;
  let authenticatorClass: unknown;
  let userVerified: unknown;
  let boundToAction: unknown;
  let roleAuthorized: unknown;
  let readThrew = false;
  try {
    identityRef = get("identityRef");
    credentialRef = get("credentialRef");
    authenticatorClass = get("authenticatorClass");
    userVerified = get("userVerified");
    boundToAction = get("boundToAction");
    roleAuthorized = get("roleAuthorized");
  } catch {
    readThrew = true;
    identityRef = credentialRef = authenticatorClass = undefined;
    userVerified = boundToAction = roleAuthorized = undefined;
  }

  // The first two terms are INERT at today's field checks and are kept deliberately:
  // when the input is not a plain object every read yields undefined, and a throwing
  // accessor forces the same, so the per-field checks below already mark the report
  // malformed on that alone. Verified by behavioural diff, not by reading — mutating
  // either to `false` changes ZERO outputs across 239 hostile shapes. They stay because
  // they state the rule directly rather than relying on a downstream check to imply it,
  // and become load-bearing the moment a field check tolerates undefined. Registered in
  // the mutation guard's allowlist with the same reasoning.
  const malformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(raw, AUTHORIZER_ATTESTATION_KEYS) ||
    refMalformed(identityRef) ||
    refMalformed(credentialRef) ||
    enumMalformed(authenticatorClass, AUTHENTICATOR) ||
    boolMalformed(userVerified) ||
    boolMalformed(boundToAction) ||
    boolMalformed(roleAuthorized);

  return {
    value: {
      identityRef: refOrNull(identityRef),
      credentialRef: refOrNull(credentialRef),
      authenticatorClass: oneOf<AuthenticatorClass>(authenticatorClass, AUTHENTICATOR, "unknown"),
      userVerified: boolOrNull(userVerified),
      boundToAction: boolOrNull(boundToAction),
      roleAuthorized: boolOrNull(roleAuthorized),
    },
    malformed,
  };
}

/** Positive distinctness: both refs present and different → true; both present and equal
 *  → false (a SHARED reference, an affirmative bad fact); either absent → null (cannot
 *  establish). Never guesses distinctness from an absence. */
function distinct(a: string | null, b: string | null): boolean | null {
  if (a === null || b === null) return null;
  return a !== b;
}

/** Normalize a dual-control request. Defensive throughout: a missing or unreadable field
 *  yields the fail-safe unknown/null, never a fabricated confirmation. */
export function normalizeDualControlRequest(
  requestId: string,
  request: DualControlRequestRaw,
  source = "host-dual-control-gate",
): NormalizedDualControl {
  const plain = isPlainObject(request);
  // Guard the reads: a throwing accessor on any top-level field must fail closed to a
  // malformed verdict, not escape as an uncaught exception (see normalizeAuthorizer).
  let actionIdRaw: unknown;
  let actionClassRaw: unknown;
  let coPresenceRaw: unknown;
  let initiatorRaw: unknown;
  let approverRaw: unknown;
  let readThrew = false;
  try {
    actionIdRaw = plain ? ownValue(request, "actionId") : undefined;
    actionClassRaw = plain ? ownValue(request, "actionClass") : undefined;
    coPresenceRaw = plain ? ownValue(request, "coPresence") : undefined;
    initiatorRaw = plain ? ownValue(request, "initiator") : undefined;
    approverRaw = plain ? ownValue(request, "approver") : undefined;
  } catch {
    readThrew = true;
    actionIdRaw = actionClassRaw = coPresenceRaw = initiatorRaw = approverRaw = undefined;
  }

  const initiator = normalizeAuthorizer(initiatorRaw);
  const approver = normalizeAuthorizer(approverRaw);

  // Same two inert-but-kept terms as the authorizer normalizer above, same verification
  // and same justification.
  const topMalformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(request, DUAL_CONTROL_REQUEST_KEYS) ||
    refMalformed(actionIdRaw) ||
    enumMalformed(actionClassRaw, ACTION_CLASS) ||
    enumMalformed(coPresenceRaw, CO_PRESENCE);

  const malformed = topMalformed || initiator.malformed || approver.malformed;

  return {
    sourceSystem: "dual-control",
    requestId,
    actionId: refOrNull(actionIdRaw),
    actionClass: oneOf<ElevatedActionClass>(actionClassRaw, ACTION_CLASS, "unknown"),
    initiator: initiator.value,
    approver: approver.value,
    distinctAuthorizers: distinct(initiator.value.identityRef, approver.value.identityRef),
    distinctCredentials: distinct(initiator.value.credentialRef, approver.value.credentialRef),
    coPresence: oneOf<CoPresenceState>(coPresenceRaw, CO_PRESENCE, "unknown"),
    requestIntegrity: (malformed ? "malformed" : "clean") satisfies RequestIntegrity,
    source,
  };
}
