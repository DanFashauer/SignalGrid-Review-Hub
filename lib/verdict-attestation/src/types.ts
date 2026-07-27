// Verdict attestation — making a corrupted verdict DETECTABLE, and unusable.
//
// Every connector in this fabric is built on one rule: a grant requires positive
// confirmation of every input. Eight adversarial reviews went into making `allow`
// unreachable from anything unknown, missing, malformed or self-contradictory *at the
// field layer*.
//
// None of that helps if the verdict itself is forged after the fact.
//
// `docs/PRODUCT_CORE_THREAT_MODEL.md` records why this matters now. Attacks on
// healthcare service providers rose sharply through H1 2026 precisely because one
// compromised hub reaches many hospitals, and a runtime decision fabric reading signals
// across a fleet is that archetype. An attacker who cannot write to a hospital's MDM —
// and cannot, because every connector here is read-only and enforced so in code — but
// who CAN flip a verdict to `allow` has turned the product into a machine for
// manufacturing false confirmations at fleet scale. That is the same failure the
// connectors refuse, one level up: at the fabric rather than the field.
//
// This package is the shape and the fail-closed behaviour, matching what the rest of
// this public core is for. The production core swaps the sealing primitive for
// asymmetric signing with real key custody; the CONTRACT below does not change, and it
// is the contract that carries the safety.
//
// The one decision that matters:
//
//   AN UNVERIFIABLE VERDICT IS NOT A DENIED VERDICT AND IT IS NOT AN ALLOWED ONE.
//   IT IS DEGRADED.
//
// Returning "invalid signature" as an error that a caller may log and ignore is how
// this control fails in practice. `openVerdict` therefore never hands back a usable
// grant it could not verify: it hands back a verdict whose action has been raised to
// `step_up`, so a caller that ignores the status still cannot act on a forgery.

/** Sealing algorithms this package will verify. An allowlist on purpose.
 *
 *  The envelope carries an `alg`, and it is used ONLY to check membership here — never
 *  to SELECT a verifier. Choosing the verification routine from an attacker-controlled
 *  field is algorithm-confusion, the classic way signed-token schemes are broken
 *  (`alg: "none"`, or downgrading an asymmetric scheme to a symmetric one keyed with the
 *  public key). The verifier is fixed by the keyring entry, not by the envelope. */
export const SUPPORTED_ALGS = ["hs256"] as const;
export type AttestationAlg = (typeof SUPPORTED_ALGS)[number];

/** The exact set of keys an attestation block may carry. Anything else means the
 *  envelope was not fully understood — and an envelope we did not understand cannot
 *  have been verified. */
export const ATTESTATION_KEYS = ["alg", "keyId", "tenantId", "issuedAt", "nonce", "digest"] as const;

/** The attestation block that travels with a verdict. */
export interface Attestation {
  alg: AttestationAlg;
  /** Which key sealed this. Selects the verifier; never taken from `alg`. */
  keyId: string;
  /** Bound INTO the sealed payload, so a verdict sealed for one tenant cannot be
   *  replayed against another even with a valid signature. */
  tenantId: string;
  /** Unix milliseconds. Bound into the payload, and checked against a max age so a
   *  genuine old `allow` cannot be replayed forever. */
  issuedAt: number;
  /** Per-verdict uniqueness, bound into the payload. A caller that keeps a seen-nonce
   *  set can reject exact replays within the freshness window; this package supplies
   *  the nonce and the hook, and holds no state itself. */
  nonce: string;
  /** The seal over the canonicalized payload. */
  digest: string;
}

/** A verdict plus the attestation that lets a consumer decide whether to believe it. */
export interface AttestedVerdict<T> {
  verdict: T;
  attestation: Attestation;
}

/** Why an envelope failed to verify. Every value is a REFUSAL, not a warning. */
export type AttestationFailure =
  | "envelope_malformed"
  | "unsupported_alg"
  | "unknown_key"
  | "tenant_mismatch"
  | "expired"
  | "issued_in_future"
  | "nonce_replayed"
  | "digest_mismatch";

export type AttestationStatus =
  | { verified: true }
  | { verified: false; failure: AttestationFailure };

/** A verification key. `alg` here — NOT the envelope's — selects the verifier. */
export interface AttestationKey {
  keyId: string;
  alg: AttestationAlg;
  secret: string;
}

export interface VerifyOptions {
  /** The tenant the CONSUMER believes it is asking about. A verdict sealed for another
   *  tenant fails, whatever its signature says. Required: a caller that cannot name the
   *  tenant it expects has no business accepting a verdict. */
  expectedTenantId: string;
  /** Wall-clock now, in unix ms. Injected so verification is pure and testable. */
  now: number;
  /** How old a verdict may be and still be believed, in ms. Default 5 minutes. */
  maxAgeMs?: number;
  /** How far into the future an `issuedAt` may sit before it is treated as forged
   *  rather than clock-skewed, in ms. Default 60 seconds. */
  maxSkewMs?: number;
  /** Optional replay check. Returns true if this nonce has been seen inside the
   *  freshness window. The package stays stateless; the caller owns the cache. */
  seenNonce?: (nonce: string) => boolean;
}

/** The unified action ladder, duplicated here rather than imported.
 *
 *  This package must not depend on `posture-composition`: it has to be usable at the
 *  boundary where a verdict ARRIVES, before anything has been composed, and a
 *  dependency the other way would make the fabric's own types load-bearing for the
 *  check that guards them. The ladder is small and stable; the drift risk is worth
 *  less than the cycle. */
export const UNIFIED_ACTIONS = ["none", "monitor", "patch", "locate", "step_up", "alert", "restrict", "escalate"] as const;
export type UnifiedAction = (typeof UNIFIED_ACTIONS)[number];

/** The action an unverifiable verdict is degraded TO.
 *
 *  Not `escalate`, and the restraint is deliberate. A failed verification means we do
 *  not know what the truth is — it does not mean the device is compromised. Escalating
 *  every unverifiable read would make a key-rotation mistake indistinguishable from an
 *  attack, and the first noisy week would end with the control switched off. `step_up`
 *  is the fabric's standard "we could not confirm this" rung, which is exactly what
 *  happened. */
export const DEGRADED_ACTION: UnifiedAction = "step_up";

/** The reason code a degraded verdict carries, so an operator sees WHY. */
export const DEGRADED_REASON = "VERDICT_UNVERIFIED";
