// Types for the dual-control (two-person integrity) authorization surface.
//
// This is a SEPARATE decision surface, like `pim-activation` — not a composable posture
// signal. It answers a single, sharp question at the moment a highest-blast-radius
// elevated action is attempted: **are two distinct, authorized humans concurrently and
// verifiably authorizing THIS specific action right now?** Nothing less releases it.
//
// It exists because none of the other dimensions asks that question. `pim-activation`
// answers "may this ONE requester activate a privileged role" and routes what it cannot
// auto-approve to an approver group — an ASYNCHRONOUS, single-approver review. `webauthn`
// proves ONE gesture from ONE authenticator. `token-binding` proves a token can't be
// replayed. None of them enforce the narcotics-cabinet rule the highest-consequence
// actions actually need: two people, physically co-present, each independently verified,
// each binding their gesture to the same action, with neither able to stand in for the
// other. That rule is this surface, and only this surface.
//
// WHERE IT FITS. Dual-control does not replace posture or PIM — it composes with them.
// The right-fit model is: the grid selects dual-control ONLY for the actions whose blast
// radius warrants it (break-glass on a specialty/emergency account, a bulk data export, a
// privileged config change to the trust fabric itself), and leaves everything else to the
// lighter gates. Forcing two-person integrity on every action is exactly the fatigue this
// product exists to remove; withholding it from the one action that destroys a tenant is
// exactly the failure it exists to prevent. Picking the right fit is the whole point.
//
// SignalGrid grants nothing itself. It answers `Granted | SecondAuthorizerRequired |
// Denied` and records the evidence; the host system performs the elevated action (or not)
// on that answer. Determinism holds: no clock, no randomness. Whether the two gestures
// landed inside the bounded co-presence window is computed by the runtime OUTSIDE this
// core and handed in as `coPresence`, exactly as `pim-activation` takes `signalsFresh`.

/** The class of elevated action being authorized. `unknown` is the fail-safe: an action
 *  whose class could not be established is never auto-releasable under dual control. */
export type ElevatedActionClass = "break_glass" | "privileged_config" | "bulk_data" | "unknown";

/** Which authenticator family answered. `security_key` = a roaming FIDO2 key (YubiKey 5C
 *  NFC, Titan) — the dedicated hardware token the modular case carries. `platform` = the
 *  device's own Face ID / Touch ID. `unknown` = could not be established. The two-person
 *  rule cares that the two credentials are DISTINCT INSTANCES; the family is recorded for
 *  the audit trail, not required to differ. */
export type AuthenticatorClass = "platform" | "security_key" | "unknown";

/** Were the two gestures captured inside the bounded co-presence window? Computed by the
 *  runtime (which owns the clock) and handed in — the decision core reads it, never a
 *  wall time. `expired` is an AFFIRMATIVE bad fact (they were not concurrent); `unknown`
 *  is an absence (we could not establish it). Only one of those denies. */
export type CoPresenceState = "confirmed" | "expired" | "unknown";

/** Present but unparseable = an assertion we could not read. Tracked separately from the
 *  field values because the allowlist collapses "said nothing" and "said something we
 *  could not read" into the same sentinel, and only one of those is silence. */
export type RequestIntegrity = "clean" | "malformed";

/** One authorizer's raw attestation as it arrives from the host. Loosely typed on
 *  purpose: an EXTERNAL caller fills this in, so every field must be visibly capable of
 *  arriving malformed and be made safe by the normalizer, not the compiler. */
export interface AuthorizerAttestationRaw {
  /** Stable identity reference for this authorizer (opaque; never a name/PII here). */
  identityRef?: unknown;
  /** The SPECIFIC authenticator instance that signed — distinct instances are what stop
   *  one stolen token from signing both halves. Opaque credential id. */
  credentialRef?: unknown;
  authenticatorClass?: unknown; // platform | security_key | unknown
  /** Did the user-verification gesture (biometric + PIN, like the narcotics dual-key)
   *  positively complete for THIS authorizer? boolean. */
  userVerified?: unknown;
  /** Was this gesture bound to the exact action being authorized (its actionId)? A
   *  gesture bound to a different action is a replay, not a confirmation. boolean. */
  boundToAction?: unknown;
  /** Is this identity authorized to serve as an authorizer for this action's class?
   *  (Membership in the break-glass authorizer set — not merely "a valid user".) boolean. */
  roleAuthorized?: unknown;
  [k: string]: unknown;
}

export const AUTHORIZER_ATTESTATION_KEYS = [
  "identityRef",
  "credentialRef",
  "authenticatorClass",
  "userVerified",
  "boundToAction",
  "roleAuthorized",
] as const;

/** The whole dual-control request: the action, and the two authorizers. */
export interface DualControlRequestRaw {
  /** The specific elevated action this authorization releases. Opaque id. */
  actionId?: unknown;
  actionClass?: unknown; // break_glass | privileged_config | bulk_data | unknown
  /** The initiator and the second authorizer (the "witness"). */
  initiator?: unknown; // AuthorizerAttestationRaw
  approver?: unknown; // AuthorizerAttestationRaw
  /** Co-presence window verdict, computed by the runtime that owns the clock. */
  coPresence?: unknown; // confirmed | expired | unknown
  [k: string]: unknown;
}

export const DUAL_CONTROL_REQUEST_KEYS = [
  "actionId",
  "actionClass",
  "initiator",
  "approver",
  "coPresence",
] as const;

/** A normalized authorizer — every field is a positive value, `null` (not reported), or
 *  the fail-safe `unknown`. There is no way to spell "trusted" by omission. */
export interface NormalizedAuthorizer {
  identityRef: string | null;
  credentialRef: string | null;
  authenticatorClass: AuthenticatorClass;
  userVerified: boolean | null;
  boundToAction: boolean | null;
  roleAuthorized: boolean | null;
}

export interface NormalizedDualControl {
  sourceSystem: "dual-control";
  requestId: string;
  actionId: string | null;
  actionClass: ElevatedActionClass;
  initiator: NormalizedAuthorizer;
  approver: NormalizedAuthorizer;
  /** Are the two identities positively DISTINCT? true = both present and different;
   *  false = present and the SAME (self-authorization); null = cannot establish. Derived
   *  by the normalizer from the two identityRefs so the evaluator reads one clean fact. */
  distinctAuthorizers: boolean | null;
  /** Are the two authenticator INSTANCES positively distinct? Same rules as above. false
   *  = one credential signed both halves (physically impossible for two people). */
  distinctCredentials: boolean | null;
  coPresence: CoPresenceState;
  requestIntegrity: RequestIntegrity;
  source: string;
}

/** The three outcomes this surface returns. `SecondAuthorizerRequired` is the default and
 *  the safe non-grant: it neither releases the action nor punishes a legitimate first
 *  authorizer — it says "not enough, yet". `Denied` is reserved for affirmative bad facts. */
export type DualControlOutcome = "Granted" | "SecondAuthorizerRequired" | "Denied";

export type DualControlReasonCode =
  | "GRANTED_TWO_PERSON_CONFIRMED"
  | "SECOND_AUTHORIZER_REQUIRED"
  | "SELF_AUTHORIZATION"
  | "SHARED_CREDENTIAL"
  | "VERIFICATION_FAILED"
  | "ACTION_BINDING_MISMATCH"
  | "AUTHORIZER_NOT_PERMITTED"
  | "CO_PRESENCE_EXPIRED"
  | "REQUEST_MALFORMED";

export interface DualControlVerdict {
  outcome: DualControlOutcome;
  reasonCode: DualControlReasonCode;
  /** Why, in the operator's words — one line, safe to surface in an audit trail. */
  explanation: string;
  /** Affirmative bad facts that forced a Denied (empty unless outcome is Denied). */
  blockingFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses a grant and
   *  lands the request in SecondAuthorizerRequired. */
  unknownSignals: string[];
  /** True ONLY for Granted: every two-person-integrity input was positively confirmed. */
  twoPersonConfirmed: boolean;
  requestId: string;
}
