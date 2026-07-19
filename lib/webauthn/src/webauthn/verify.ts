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

import { createHash, createPublicKey, verify as cryptoVerify, X509Certificate, type KeyObject } from 'crypto';

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

/**
 * Extract the raw authenticatorData buffer from a base64url attestationObject,
 * so the registration path can check the rpIdHash / UP / UV flags the same way
 * the authentication path does. Returns null on any malformed input (fail closed).
 */
export function extractAuthData(attestationObjectB64: string): Buffer | null {
  try {
    const att = decodeFirst(Buffer.from(attestationObjectB64, 'base64url'));
    if (!(att instanceof Map)) return null;
    const authData = att.get('authData');
    return Buffer.isBuffer(authData) ? authData : null;
  } catch {
    return null;
  }
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

// ── attestation-statement verification (registration) ────────────────────────
//
// At registration WebAuthn returns an attestationObject = { fmt, attStmt,
// authData }. The `fmt` says HOW the authenticator vouched for the new
// credential. We verify the two statement formats a platform/security key
// commonly sends — `packed` and `fido-u2f` — plus `none` (self-attested, no
// statement). Everything FAILS CLOSED: an unknown format, a missing field, or a
// bad signature returns `{ ok: false }`; only a genuinely-verified statement (or
// an explicit `none`) returns `{ ok: true }`.

export type AttestationFormat = 'none' | 'packed' | 'fido-u2f' | string;

export interface AttestationResult {
  ok: boolean;
  /** The attestation format that was present. */
  fmt: AttestationFormat;
  /** True when a cryptographic statement was actually verified (not `none`). */
  attested: boolean;
  error?: string;
}

interface ParsedAttestation {
  fmt: string;
  attStmt: Map<unknown, unknown>;
  authData: Buffer;
}

function parseAttestationObject(attestationObjectB64: string): ParsedAttestation | null {
  try {
    const att = decodeFirst(Buffer.from(attestationObjectB64, 'base64url'));
    if (!(att instanceof Map)) return null;
    const fmt = att.get('fmt');
    const attStmt = att.get('attStmt');
    const authData = att.get('authData');
    if (typeof fmt !== 'string' || !(attStmt instanceof Map) || !Buffer.isBuffer(authData)) return null;
    return { fmt, attStmt, authData };
  } catch {
    return null;
  }
}

/** The credential id + raw COSE key bytes carried in attestedCredentialData. */
function readAttestedCredential(authData: Buffer): { credId: Buffer; coseKeyBytes: Buffer } | null {
  try {
    if ((authData.readUInt8(32) & 0x40) === 0) return null; // AT flag
    let offset = 37 + 16; // rpIdHash+flags+signCount, then aaguid
    const credIdLen = authData.readUInt16BE(offset);
    offset += 2;
    const credId = authData.subarray(offset, offset + credIdLen);
    offset += credIdLen;
    // The COSE key is the remaining bytes; re-encode via decode round-trip length.
    const decoded = decodeItem(authData, offset);
    return { credId, coseKeyBytes: authData.subarray(offset, decoded.next) };
  } catch {
    return null;
  }
}

/** COSE alg id (-7 / -257) → node verify parameters. */
function algParams(coseAlg: number): { hash: string; dsaEncoding?: 'der' } | null {
  if (coseAlg === -7) return { hash: 'sha256', dsaEncoding: 'der' }; // ES256
  if (coseAlg === -257) return { hash: 'sha256' }; // RS256
  if (coseAlg === -35) return { hash: 'sha384', dsaEncoding: 'der' }; // ES384
  if (coseAlg === -36) return { hash: 'sha512', dsaEncoding: 'der' }; // ES512
  return null;
}

/** Uncompressed EC point (0x04 || x || y) for a P-256 COSE key — fido-u2f form. */
function ecUncompressedPoint(cose: Map<unknown, unknown>): Buffer | null {
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return null;
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

/**
 * Verify a registration's attestation statement against the clientDataJSON.
 * `none` is accepted (self-attested); `packed` and `fido-u2f` are cryptographically
 * verified; anything else fails closed.
 */
export function verifyAttestation(params: {
  attestationObjectB64: string;
  clientDataJSON: Buffer;
}): AttestationResult {
  const parsed = parseAttestationObject(params.attestationObjectB64);
  if (!parsed) return { ok: false, fmt: 'unknown', attested: false, error: 'unparseable attestationObject' };
  const { fmt, attStmt, authData } = parsed;
  const clientDataHash = sha256(params.clientDataJSON);

  if (fmt === 'none') {
    // No statement to verify. Accept, but flag that nothing was attested.
    if (attStmt.size !== 0) return { ok: false, fmt, attested: false, error: 'none format must have an empty statement' };
    return { ok: true, fmt, attested: false };
  }

  try {
    if (fmt === 'packed') {
      const alg = attStmt.get('alg');
      const sig = attStmt.get('sig');
      const x5c = attStmt.get('x5c');
      if (typeof alg !== 'number' || !Buffer.isBuffer(sig)) {
        return { ok: false, fmt, attested: false, error: 'packed statement missing alg/sig' };
      }
      const signedData = Buffer.concat([authData, clientDataHash]);

      let publicKey: KeyObject;
      if (Array.isArray(x5c) && x5c.length > 0) {
        // Full attestation — the leaf certificate's key signs.
        if (!Buffer.isBuffer(x5c[0])) return { ok: false, fmt, attested: false, error: 'bad x5c' };
        publicKey = new X509Certificate(x5c[0]).publicKey;
      } else {
        // Self attestation — the new credential key signs; its alg must match.
        const cred = readAttestedCredential(authData);
        if (!cred) return { ok: false, fmt, attested: false, error: 'no attested credential' };
        const cose = decodeFirst(cred.coseKeyBytes);
        if (!(cose instanceof Map)) return { ok: false, fmt, attested: false, error: 'bad COSE key' };
        if (cose.get(3) !== alg) return { ok: false, fmt, attested: false, error: 'self-attestation alg mismatch' };
        const verifiable = coseKeyToVerifiable(cose);
        if (!verifiable) return { ok: false, fmt, attested: false, error: 'unsupported self-attestation key' };
        publicKey = createPublicKey({ key: verifiable.jwk, format: 'jwk' });
      }

      const ap = algParams(alg);
      if (!ap) return { ok: false, fmt, attested: false, error: `unsupported packed alg ${alg}` };
      const ok = cryptoVerify(ap.hash, signedData, ap.dsaEncoding ? { key: publicKey, dsaEncoding: ap.dsaEncoding } : publicKey, sig);
      return { ok, fmt, attested: ok, error: ok ? undefined : 'packed signature invalid' };
    }

    if (fmt === 'fido-u2f') {
      // Legacy U2F: verificationData = 0x00 || rpIdHash || clientDataHash || credId || publicKeyU2F
      const sig = attStmt.get('sig');
      const x5c = attStmt.get('x5c');
      if (!Buffer.isBuffer(sig) || !Array.isArray(x5c) || !Buffer.isBuffer(x5c[0])) {
        return { ok: false, fmt, attested: false, error: 'fido-u2f statement missing sig/x5c' };
      }
      const cred = readAttestedCredential(authData);
      if (!cred) return { ok: false, fmt, attested: false, error: 'no attested credential' };
      const cose = decodeFirst(cred.coseKeyBytes);
      if (!(cose instanceof Map)) return { ok: false, fmt, attested: false, error: 'bad COSE key' };
      const point = ecUncompressedPoint(cose);
      if (!point) return { ok: false, fmt, attested: false, error: 'fido-u2f requires a P-256 key' };
      const rpIdHash = authData.subarray(0, 32);
      const verificationData = Buffer.concat([Buffer.from([0x00]), rpIdHash, clientDataHash, cred.credId, point]);
      const publicKey = new X509Certificate(x5c[0]).publicKey;
      const ok = cryptoVerify('sha256', verificationData, { key: publicKey, dsaEncoding: 'der' }, sig);
      return { ok, fmt, attested: ok, error: ok ? undefined : 'fido-u2f signature invalid' };
    }

    // Unknown / unsupported format (tpm, android-key, apple, …): fail closed.
    return { ok: false, fmt, attested: false, error: `unsupported attestation format '${fmt}'` };
  } catch (err) {
    return { ok: false, fmt, attested: false, error: err instanceof Error ? err.message : 'attestation verify error' };
  }
}
