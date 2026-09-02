import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { UNCANONICAL, canonicalize } from "./canonical";
import {
  ATTESTATION_KEYS,
  DEGRADED_ACTION,
  DEGRADED_REASON,
  SUPPORTED_ALGS,
  type Attestation,
  type AttestationFailure,
  type AttestationKey,
  type AttestationStatus,
  type AttestedVerdict,
  type UnifiedAction,
  type VerifyOptions,
} from "./types";

const DEFAULT_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_SKEW_MS = 60_000;

/** The bytes a seal actually covers.
 *
 *  Every field that changes the MEANING of the verdict is inside the seal — the verdict
 *  itself, the tenant it was decided for, when it was decided, and its nonce. `keyId`
 *  and `alg` are outside: they are routing information a verifier needs BEFORE it can
 *  check anything, and binding them in would not help, because a verifier that trusted
 *  them enough to select a key would already have lost. They are constrained instead by
 *  the keyring lookup and the algorithm allowlist. */
function sealedPayload<T>(verdict: T, tenantId: string, issuedAt: number, nonce: string): string | typeof UNCANONICAL {
  return canonicalize({ verdict, tenantId, issuedAt, nonce });
}

function hs256(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Constant-time hex comparison. A plain `===` on a digest leaks, through timing, how
 *  many leading characters an attacker guessed correctly, which turns forgery from
 *  infeasible into a search. Length is compared first because `timingSafeEqual` throws
 *  on a length mismatch — that comparison is not secret, since the length is fixed by
 *  the algorithm. */
function digestsEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    // UNREACHABLE, and labelled rather than left looking load-bearing: `timingSafeEqual`
    // throws only on a length mismatch, which the line above has already refused. Kept
    // because "an exception here is not a match" is the rule we want if that ever stops
    // being the only way it throws. Mutation-guard allowlisted with this reason.
    return false;
  }
}

export interface SealOptions {
  tenantId: string;
  /** Unix ms. Injected rather than read from the clock so sealing is deterministic and
   *  testable, and so a caller cannot accidentally seal with a clock this package
   *  chose. */
  issuedAt: number;
  /** Optional explicit nonce; a v4 UUID is generated otherwise. */
  nonce?: string;
}

/** Seal a verdict. Throws ONLY on programmer error — an unusable key, or a verdict that
 *  cannot be canonicalized. Sealing is a producer-side operation where failing loudly is
 *  right; verification is the consumer-side operation that must never throw. */
export function sealVerdict<T>(verdict: T, key: AttestationKey, options: SealOptions): AttestedVerdict<T> {
  if (!SUPPORTED_ALGS.includes(key.alg)) {
    throw new Error(`verdict-attestation: unsupported alg "${key.alg}"`);
  }
  if (typeof key.secret !== "string" || key.secret.length === 0) {
    throw new Error("verdict-attestation: key secret must be a non-empty string");
  }
  const nonce = options.nonce ?? randomUUID();
  const payload = sealedPayload(verdict, options.tenantId, options.issuedAt, nonce);
  if (payload === UNCANONICAL) {
    throw new Error("verdict-attestation: verdict is not canonicalizable and cannot be sealed");
  }
  return {
    verdict,
    attestation: {
      alg: key.alg,
      keyId: key.keyId,
      tenantId: options.tenantId,
      issuedAt: options.issuedAt,
      nonce,
      digest: hs256(payload, key.secret),
    },
  };
}

/** Is this a plain, fully-understood attestation block?
 *
 *  Own-property-only, no unrecognized keys, no inherited keys — the same discipline the
 *  connectors apply to bridge reports, for the same reason: an envelope carrying a field
 *  we do not understand is an envelope we cannot claim to have verified. */
function attestationMalformed(a: unknown): boolean {
  if (typeof a !== "object" || a === null || Array.isArray(a) || a === Object.prototype) return true;
  try {
    let o: object | null = a as object;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= 32) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!(ATTESTATION_KEYS as readonly string[]).includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
  } catch {
    return true;
  }
  const rec = a as Record<string, unknown>;
  const own = (k: string): unknown =>
    Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
  try {
    return (
      typeof own("alg") !== "string" ||
      typeof own("keyId") !== "string" ||
      typeof own("tenantId") !== "string" ||
      typeof own("nonce") !== "string" ||
      typeof own("digest") !== "string" ||
      // The `typeof` half is REDUNDANT with the `isFinite` half — any non-number fails
      // `Number.isFinite` too — and is labelled so rather than left looking load-bearing.
      // Kept because the pair states the intent (a finite number, not merely something
      // finite-ish) and reads as one contract. Mutation-guard allowlisted.
      typeof own("issuedAt") !== "number" ||
      !Number.isFinite(own("issuedAt") as number)
    );
  } catch {
    return true;
  }
}

/**
 * Verify an attested verdict. NEVER throws, and never returns a bare boolean — the
 * failure reason is what an operator needs, and swallowing it is how this control
 * quietly stops working.
 *
 * Order is deliberate. The digest is checked LAST, after the envelope is understood, the
 * algorithm is on the allowlist, the key is known, the tenant matches, and the timestamp
 * is inside the window. Checking a signature over a payload we could not parse would be
 * verifying our own guess at what was sent.
 */
export function verifyVerdict<T>(
  envelope: unknown,
  keyring: readonly AttestationKey[],
  options: VerifyOptions,
): AttestationStatus {
  const fail = (failure: AttestationFailure): AttestationStatus => ({ verified: false, failure });

  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return fail("envelope_malformed");
  }
  const env = envelope as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(env, "verdict") || !Object.prototype.hasOwnProperty.call(env, "attestation")) {
    return fail("envelope_malformed");
  }
  let verdict: unknown;
  let attestation: unknown;
  try {
    verdict = env.verdict;
    attestation = env.attestation;
  } catch {
    return fail("envelope_malformed");
  }
  if (attestationMalformed(attestation)) return fail("envelope_malformed");
  const att = attestation as Attestation;

  // `alg` is checked for MEMBERSHIP only. It never selects a verifier — see types.ts.
  if (!(SUPPORTED_ALGS as readonly string[]).includes(att.alg)) return fail("unsupported_alg");

  const key = keyring.find((k) => k.keyId === att.keyId);
  // An unknown keyId is a refusal, not a fallback to "any key in the ring". A verifier
  // that tries every key turns key rotation into an oracle.
  if (!key) return fail("unknown_key");
  // The ENVELOPE's alg must match the KEY's alg. Otherwise a downgrade — presenting a
  // symmetric envelope against a key registered for a different scheme — would still
  // find a verifier.
  if (key.alg !== att.alg) return fail("unsupported_alg");

  if (att.tenantId !== options.expectedTenantId) return fail("tenant_mismatch");

  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxSkew = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  // freshness: local-by-design — same rule, but this package cannot import @workspace/integrations without a new workspace dependency and a lockfile regeneration; folded copy pending that change — and it is the THIRD hand-rolled skew tolerance, DEFAULT_MAX_SKEW_MS = 60_000, the same value as the shared constant
  if (att.issuedAt > options.now + maxSkew) return fail("issued_in_future");
  // freshness: local-by-design — not the sighting-freshness rule — an EXPIRY/TTL comparison, where an unreadable bound must read EXPIRED (DEFAULT_MAX_AGE_MS = 5 * 60_000 is a staleness BOUND, not a skew tolerance). CORRECTED 2026-09-02: this marker used to name check-nan-fail-open.mjs as its gate, and that gate has nothing to key on here — `att.issuedAt` never passes through Date.parse or .getTime(). The real guard is `isMalformed` at attest.ts:128-129, which rejects any attestation whose issuedAt is not a finite number BEFORE this comparison runs; naming a gate that cannot see the site is the defect this file's own doctrine exists to prevent.
  if (options.now - att.issuedAt > maxAge) return fail("expired");

  if (options.seenNonce?.(att.nonce) === true) return fail("nonce_replayed");

  const payload = sealedPayload(verdict, att.tenantId, att.issuedAt, att.nonce);
  // A verdict we cannot canonicalize is one whose bytes we cannot reproduce, so there is
  // nothing to compare. Not a digest mismatch — we never got as far as a digest.
  if (payload === UNCANONICAL) return fail("envelope_malformed");

  return digestsEqual(hs256(payload, key.secret), att.digest)
    ? { verified: true }
    : fail("digest_mismatch");
}

export interface OpenedVerdict<T> {
  verdict: T;
  status: AttestationStatus;
  /** True when the verdict was returned with its action raised because verification
   *  failed. Distinct from `!status.verified` only in intent — a caller reading this
   *  field is asking "was this changed?", which is the question that belongs in a log. */
  degraded: boolean;
}

/**
 * The fabric-facing entry point, and the reason this package exists.
 *
 * `verifyVerdict` answers "is this genuine?". Experience says that is not enough on its
 * own: a control whose failure mode is a status field the caller may ignore is a control
 * that stops working the first time someone ships a caller that ignores it. So the
 * unverifiable verdict does not come back usable.
 *
 * A verdict that fails verification is returned with its action raised to `step_up` and
 * its reason replaced with `VERDICT_UNVERIFIED`, so a caller that never reads `status`
 * STILL cannot act on a forged `allow`. The verdict object is copied, never mutated —
 * the caller may well be holding the original for an audit record, and quietly rewriting
 * it underneath them would corrupt exactly the evidence this is meant to protect.
 *
 * The degrade is one-directional. A verdict that already says `restrict` is not lowered
 * to `step_up` by a verification failure: we could not confirm the verdict, which is
 * never a reason to trust a device MORE than the unverified claim about it did.
 */
export function openVerdict<T extends { recommendedAction?: unknown; reasonCode?: unknown }>(
  envelope: unknown,
  keyring: readonly AttestationKey[],
  options: VerifyOptions,
  actionRank: (action: string) => number,
): OpenedVerdict<T> {
  const status = verifyVerdict<T>(envelope, keyring, options);
  const raw = (envelope as { verdict?: unknown } | null)?.verdict;

  if (status.verified) {
    return { verdict: raw as T, status, degraded: false };
  }

  // Nothing usable came back at all — hand back the degraded shell rather than
  // something a caller might dereference into a grant.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      verdict: { recommendedAction: DEGRADED_ACTION, reasonCode: DEGRADED_REASON } as unknown as T,
      status,
      degraded: true,
    };
  }

  const current = (raw as { recommendedAction?: unknown }).recommendedAction;
  const currentRank = typeof current === "string" ? actionRank(current) : -1;
  const degradedRank = actionRank(DEGRADED_ACTION);
  // Worst-concern-wins, exactly as everywhere else in the fabric.
  const action: UnifiedAction | unknown = currentRank > degradedRank ? current : DEGRADED_ACTION;

  return {
    verdict: { ...(raw as object), recommendedAction: action, reasonCode: DEGRADED_REASON } as T,
    status,
    degraded: true,
  };
}
