// Types for the read-only token-binding / proof-of-possession dimension.
//
// `sso-session` answers "is the live session the current badge-holder's, MFA-backed,
// and fresh?". This dimension answers a different, RFC-level question about the same
// session's ACCESS TOKEN: is it **sender-constrained** — cryptographically bound to a
// key held on THIS device (DPoP, RFC 9449; or mutual-TLS, RFC 8705) — or a plain
// **bearer** token that anyone who copies it can replay from anywhere?
//
// On a shared, badge-checked-out frontline device this is decisive. A bearer access
// token left in shared storage is replayable by the next user or by a token thief off
// the device; a proof-of-possession token bound to a hardware key in the Secure
// Enclave / TPM cannot be presented from another machine. The single worst signature
// this catches is a bound token whose key belongs to a DIFFERENT device — a token that
// was minted elsewhere and is being presented here (an exfiltrated/stolen bound token).
//
// This connector normalizes a token-inspection bridge's already-evaluated view of the
// session's token. It consumes the evaluated binding state; it never mints, refreshes,
// binds, or revokes a token — that stays with the IdP / resource server.

/** How the access token is cryptographically bound to the client.
 *  `dpop` = a DPoP proof JWT signed by a client-held key (RFC 9449); `mtls` =
 *  certificate-bound via mutual TLS (RFC 8705); `bearer` = unbound / replayable;
 *  `unknown` = the bridge could not determine it. */
export type TokenBinding = "dpop" | "mtls" | "bearer" | "unknown";

/** Where the proof-of-possession private key lives. `hardware` = a non-exportable
 *  key in the Secure Enclave / TPM / StrongBox; `software` = an exportable keystore
 *  key; `none` = no PoP key (a bearer token); `unknown` = not reported. */
export type KeyProtection = "hardware" | "software" | "none" | "unknown";

/** Raw token-inspection report about one device's session token (loosely typed —
 *  any field may degrade to null / an error string). */
export interface TokenBindingReportRaw {
  binding?: unknown; // dpop | mtls | bearer | unknown
  keyProtection?: unknown; // hardware | software | none | unknown
  /** Is the PoP key backed by key attestation (proven to reside in hardware)? */
  keyAttested?: boolean | null;
  /** Is the token audience/resource-restricted (aud bound to the intended API),
   *  so it cannot be replayed to a different service? */
  audienceRestricted?: boolean | null;
  /** Does the PoP key/cert correspond to THIS enrolled device (not another one)? */
  boundToDevice?: boolean | null;
  /** Was the token-inspection bridge reachable to evaluate the token? */
  bridgeReachable?: boolean | null;
  [k: string]: unknown;
}

/** The normalized, vendor-neutral token-binding posture — one shape the fabric reads. */
export interface NormalizedTokenBinding {
  sourceSystem: "token-binding";
  deviceId: string;
  binding: TokenBinding;
  keyProtection: KeyProtection;
  /** true = attested hardware key; false = not attested; null = not reported. */
  keyAttested: boolean | null;
  audienceRestricted: boolean | null;
  boundToDevice: boolean | null;
  bridgeReachable: boolean | null;
  source: string;
}

export type TokenBindingPosture =
  | "sender_constrained"
  | "bearer_token"
  | "token_device_mismatch"
  | "weak_binding"
  | "unverified"
  | "unknown";

export type TokenBindingReasonCode =
  | "SENDER_CONSTRAINED_TOKEN"
  | "UNBOUND_BEARER_TOKEN"
  | "TOKEN_DEVICE_MISMATCH"
  | "SOFTWARE_BOUND_KEY"
  | "KEY_NOT_ATTESTED"
  | "TOKEN_NOT_AUDIENCE_RESTRICTED"
  | "BINDING_STATE_UNKNOWN"
  | "BRIDGE_UNREACHABLE"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type TokenBindingAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface TokenBindingVerdict {
  posture: TokenBindingPosture;
  reasonCode: TokenBindingReasonCode;
  recommendedAction: TokenBindingAction;
  /** Containment-level findings (bearer token / device-mismatched bound token). */
  criticalFindings: string[];
  /** Token facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the token is confirmed sender-constrained: a DPoP/mTLS token
   *  with an attested hardware key, audience-restricted, and bound to THIS device
   *  (never true for a bearer, device-mismatched, software-key, or unverified token). */
  senderConstrained: boolean;
  deviceId: string;
}

export type TokenBindingConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class TokenBindingConnectorError extends Error {
  readonly code: TokenBindingConnectorErrorCode;
  readonly status: number;
  constructor(code: TokenBindingConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "TokenBindingConnectorError";
    this.code = code;
    this.status = status;
  }
}
