// WebAuthn cryptographic verification.
//
// Real assertion/attestation verification for the step-up path. This replaces
// the earlier stub that accepted any assertion whose credential id existed —
// which, if it were ever wired into an enforcement path, would be a complete
// authentication bypass. Everything here FAILS CLOSED: any parse error,
// unsupported key type, or bad signature returns `false`/`null`, never a pass.
//
// Scope: enough self-contained CBOR to read a WebAuthn attestationObject and a
// COSE_Key (EC2/ES256 and RSA/RS256 — the two algorithms we advertise in
// pubKeyCredParams). No external CBOR dependency, so there is no ambiguity about
// what is trusted.

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';

// ── minimal CBOR reader (definite-length; major types 0–5) ──────────────────

interface Decoded {
  value: unknown;
  next: number;
}

function readUint(buf: Buffer, ai: number, pos: number): { value: number; next: number } {
  if (ai < 24) return { value: ai, next: pos };
  if (ai === 24) return { value: buf.readUInt8(pos), next: pos + 1 };
  if (ai === 25) return { value: buf.readUInt16BE(pos), next: pos + 2 };
  if (ai === 26) return { value: buf.readUInt32BE(pos), next: pos + 4 };
  if (ai === 27) {
    // 64-bit length — safe-integer range is plenty for our buffers.
    const hi = buf.readUInt32BE(pos);
    const lo = buf.readUInt32BE(pos + 4);
    return { value: hi * 2 ** 32 + lo, next: pos + 8 };
  }
  throw new Error('CBOR: unsupported additional info');
}

function decodeItem(buf: Buffer, pos: number): Decoded {
  const first = buf.readUInt8(pos);
  const major = first >> 5;
  const ai = first & 0x1f;
  let p = pos + 1;

  switch (major) {
    case 0: {
      const { value, next } = readUint(buf, ai, p);
      return { value, next };
    }
    case 1: {
      const { value, next } = readUint(buf, ai, p);
      return { value: -1 - value, next };
    }
    case 2: {
      const { value: len, next } = readUint(buf, ai, p);
      p = next;
      return { value: buf.subarray(p, p + len), next: p + len };
    }
    case 3: {
      const { value: len, next } = readUint(buf, ai, p);
      p = next;
      return { value: buf.toString('utf8', p, p + len), next: p + len };
    }
    case 4: {
      const { value: count, next } = readUint(buf, ai, p);
      p = next;
      const arr: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const item = decodeItem(buf, p);
        arr.push(item.value);
        p = item.next;
      }
      return { value: arr, next: p };
    }
    case 5: {
      const { value: count, next } = readUint(buf, ai, p);
      p = next;
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < count; i++) {
        const k = decodeItem(buf, p);
        const v = decodeItem(buf, k.next);
        map.set(k.value, v.value);
        p = v.next;
      }
      return { value: map, next: p };
    }
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

function decodeFirst(buf: Buffer): unknown {
  return decodeItem(buf, 0).value;
}

// ── COSE_Key → JWK ──────────────────────────────────────────────────────────

export interface VerifiableKey {
  jwk: Record<string, string>;
  alg: 'ES256' | 'RS256';
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** Convert a COSE_Key map (EC2/ES256 or RSA/RS256) into an importable JWK. */
export function coseKeyToVerifiable(cose: Map<unknown, unknown>): VerifiableKey | null {
  const kty = cose.get(1);
  const alg = cose.get(3);

  // EC2 (kty=2) with ES256 (alg=-7), P-256 curve (crv=1).
  if (kty === 2 && alg === -7) {
    const crv = cose.get(-1);
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) return null;
    return {
      alg: 'ES256',
      jwk: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) },
    };
  }

  // RSA (kty=3) with RS256 (alg=-257).
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) return null;
    return {
      alg: 'RS256',
      jwk: { kty: 'RSA', n: b64url(n), e: b64url(e) },
    };
  }

  return null;
}

// ── attestationObject → credential public key ───────────────────────────────

/**
 * Parse a WebAuthn attestationObject (base64url or base64) and extract the
 * attested credential's public key as a verifiable JWK. Returns null on any
 * malformed input or unsupported key — callers MUST treat null as a hard
 * failure (fail closed).
 */
export function extractCredentialPublicKey(attestationObjectB64: string): VerifiableKey | null {
  try {
    const buf = Buffer.from(attestationObjectB64, 'base64url');
    const att = decodeFirst(buf);
    if (!(att instanceof Map)) return null;
    const authData = att.get('authData');
    if (!Buffer.isBuffer(authData)) return null;

    // authData: rpIdHash(32) | flags(1) | signCount(4) | attestedCredentialData
    // attestedCredentialData: aaguid(16) | credIdLen(2) | credId(L) | COSE key
    const flags = authData.readUInt8(32);
    const hasAttestedCred = (flags & 0x40) !== 0; // AT flag
    if (!hasAttestedCred) return null;

    let offset = 37 + 16; // skip rpIdHash+flags+signCount, then aaguid
    const credIdLen = authData.readUInt16BE(offset);
    offset += 2 + credIdLen;

    const cose = decodeFirst(authData.subarray(offset));
    if (!(cose instanceof Map)) return null;
    return coseKeyToVerifiable(cose);
  } catch {
    return null;
  }
}

export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** The `signCount` (uint32) from an authenticatorData buffer. */
export function readSignCount(authData: Buffer): number {
  return authData.readUInt32BE(33);
}

/** Is the User-Present (UP) flag set in authenticatorData? */
export function isUserPresent(authData: Buffer): boolean {
  return (authData.readUInt8(32) & 0x01) !== 0;
}

/**
 * Is the User-Verified (UV) flag set in authenticatorData? UV means the
 * authenticator verified the user (biometric / PIN), not merely that a user was
 * present. A step-up is a high-assurance gate, so the step-up path requires UV.
 */
export function isUserVerified(authData: Buffer): boolean {
  return (authData.readUInt8(32) & 0x04) !== 0;
}

/**
 * Verify a WebAuthn assertion signature. The authenticator signs
 * `authenticatorData || SHA-256(clientDataJSON)` with the credential private
 * key; we verify with the stored public key. Fails closed on any error.
 */
export function verifyAssertionSignature(params: {
  key: VerifiableKey;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  signature: Buffer;
}): boolean {
  try {
    const { key, authenticatorData, clientDataJSON, signature } = params;
    const publicKey: KeyObject = createPublicKey({ key: key.jwk, format: 'jwk' });
    const signedData = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);

    if (key.alg === 'ES256') {
      // WebAuthn ES256 signatures are DER-encoded ECDSA.
      return cryptoVerify('sha256', signedData, { key: publicKey, dsaEncoding: 'der' }, signature);
    }
    // RS256
    return cryptoVerify('sha256', signedData, publicKey, signature);
  } catch {
    return false;
  }
}

/** Verify the rpIdHash in authenticatorData binds the assertion to our RP. */
export function rpIdHashMatches(authData: Buffer, rpId: string): boolean {
  try {
    return authData.subarray(0, 32).equals(sha256(Buffer.from(rpId, 'utf8')));
  } catch {
    return false;
  }
}
