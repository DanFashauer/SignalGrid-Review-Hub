import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { decodeBase64Url, decodeJsonSegment } from "./base64url";

/**
 * Fail-closed RS256 JWT verification for the enterprise (OIDC) sign-in path.
 *
 * This is intentionally dependency-free — it uses only Node's built-in `crypto`
 * so it adds no supply-chain surface. It verifies an RS256 (RSASSA-PKCS1-v1_5 +
 * SHA-256) signature against a caller-supplied JWKS and enforces issuer,
 * audience, and time-window claims. Every check defaults to REJECT: a token is
 * accepted only when it passes every gate, mirroring the product's fail-closed
 * posture. The current time is INJECTED (`nowMs`) rather than read from the
 * clock, so the verifier is deterministic and its proof is reproducible.
 *
 * Only `alg: "RS256"` is accepted. `none` and any HMAC algorithm (`HS*`) are
 * rejected outright — this is the standard defense against the algorithm-
 * confusion attack where an attacker submits an `HS256` token signed with the
 * public key as the shared secret.
 */

export interface JwkKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

export interface Jwks {
  keys: JwkKey[];
}

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  [claim: string]: unknown;
}

export interface VerifyOptions {
  /** The signing keys to trust (the IdP's published JWKS). */
  jwks: Jwks;
  /** Exact expected `iss`. */
  issuer: string;
  /** Expected audience; token `aud` must contain this value. */
  audience: string;
  /** Current time in ms since epoch — injected for determinism. */
  nowMs: number;
  /** Allowed clock skew for exp/nbf/iat, in seconds. Default 60. */
  clockToleranceSec?: number;
}

export type VerifyResult =
  | { ok: true; claims: JwtClaims; header: JwtHeader }
  | { ok: false; reason: string };

const SUPPORTED_ALG = "RS256";

export function verifyJwtRs256(token: string, opts: VerifyOptions): VerifyResult {
  if (typeof token !== "string") {
    return fail("token is not a string");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return fail("token is not a well-formed JWS (expected 3 non-empty segments)");
  }
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = decodeJsonSegment<JwtHeader>(headerSeg);
    claims = decodeJsonSegment<JwtClaims>(payloadSeg);
  } catch {
    return fail("header or payload is not valid base64url JSON");
  }

  // Algorithm gate FIRST — reject `none`/HMAC before touching key material.
  if (header.alg !== SUPPORTED_ALG) {
    return fail(`unsupported alg "${String(header.alg)}" (only ${SUPPORTED_ALG} is accepted)`);
  }

  const key = selectKey(opts.jwks, header.kid);
  if (!key) {
    return fail(header.kid ? `no JWKS key matches kid "${header.kid}"` : "no usable RSA key in JWKS");
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: key as unknown as Record<string, unknown>, format: "jwk" });
  } catch {
    return fail("JWKS key could not be imported as an RSA public key");
  }

  let signatureValid = false;
  try {
    const signingInput = `${headerSeg}.${payloadSeg}`;
    const signature = decodeBase64Url(signatureSeg);
    signatureValid = cryptoVerify(
      "RSA-SHA256",
      Buffer.from(signingInput, "ascii"),
      publicKey,
      signature,
    );
  } catch {
    return fail("signature could not be verified");
  }
  if (!signatureValid) {
    return fail("signature does not match");
  }

  // Signature is valid — now enforce the registered claims. Still fail-closed.
  const tolMs = Math.max(0, (opts.clockToleranceSec ?? 60)) * 1000;
  const now = opts.nowMs;

  if (typeof claims.exp !== "number") {
    return fail("missing exp claim");
  }
  if (now > claims.exp * 1000 + tolMs) {
    return fail("token has expired");
  }
  if (typeof claims.nbf === "number" && now + tolMs < claims.nbf * 1000) {
    return fail("token is not yet valid (nbf)");
  }
  if (typeof claims.iat === "number" && now + tolMs < claims.iat * 1000) {
    return fail("token issued in the future (iat)");
  }
  if (claims.iss !== opts.issuer) {
    return fail(`issuer mismatch (expected "${opts.issuer}")`);
  }
  if (!audienceMatches(claims.aud, opts.audience)) {
    return fail(`audience mismatch (expected "${opts.audience}")`);
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return fail("missing sub claim");
  }

  return { ok: true, claims, header };
}

function selectKey(jwks: Jwks, kid: string | undefined): JwkKey | null {
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const usable = keys.filter(
    (k) => k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string",
  );
  if (usable.length === 0) {
    return null;
  }
  if (kid) {
    return usable.find((k) => k.kid === kid) ?? null;
  }
  // No kid in the header: only safe when the JWKS has exactly one usable key.
  return usable.length === 1 ? usable[0] : null;
}

function audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (typeof aud === "string") {
    return aud === expected;
  }
  if (Array.isArray(aud)) {
    return aud.includes(expected);
  }
  return false;
}

function fail(reason: string): VerifyResult {
  return { ok: false, reason };
}
