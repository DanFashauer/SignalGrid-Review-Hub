// Real WebAuthn ceremonies for proofs: a software authenticator with a genuine P-256
// key pair, driven through the library's own options → verify functions. Shared by
// `webauthn-revocation-proof.ts` (in-memory store) and `webauthn-enrollment-race-proof.ts`
// (Redis store), so both halves exercise the same ceremony bytes.

import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "crypto";
import { webauthn, webauthnTypes } from "@workspace/webauthn";

// ── tiny CBOR encoder (only what these fixtures need; same shape as webauthn-verify-proof) ──
function cborUint(n: number): Buffer {
  if (n < 24) return Buffer.from([n]);
  if (n < 256) return Buffer.from([0x18, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(n, 1); return b;
}
function cborInt(value: number): Buffer {
  if (value >= 0) return cborUint(value);
  const u = cborUint(-1 - value);
  u[0] = (u[0] & 0x1f) | 0x20;
  return u;
}
function cborBytes(buf: Buffer): Buffer {
  const head = cborUint(buf.length); head[0] = (head[0] & 0x1f) | 0x40;
  return Buffer.concat([head, buf]);
}
function cborText(s: string): Buffer {
  const buf = Buffer.from(s, "utf8");
  const head = cborUint(buf.length); head[0] = (head[0] & 0x1f) | 0x60;
  return Buffer.concat([head, buf]);
}
function cborMap(pairs: Array<[number | string, Buffer]>): Buffer {
  const head = cborUint(pairs.length); head[0] = (head[0] & 0x1f) | 0xa0;
  return Buffer.concat([head, ...pairs.map(([k, v]) => Buffer.concat([typeof k === "number" ? cborInt(k) : cborText(k), v]))]);
}
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

const UP_UV = 0x05;
const UP_UV_AT = 0x45;

function authData(flags: number, signCount: number, attested?: Buffer): Buffer {
  const { rpId } = webauthnTypes.getWebAuthnConfig();
  const head = Buffer.alloc(37);
  sha256(Buffer.from(rpId, "utf8")).copy(head, 0);
  head.writeUInt8(flags, 32);
  head.writeUInt32BE(signCount, 33);
  return attested ? Buffer.concat([head, attested]) : head;
}
const clientData = (type: string, challenge: string) =>
  Buffer.from(JSON.stringify({ type, challenge, origin: webauthnTypes.getWebAuthnConfig().origin }), "utf8");

/** One authenticator-held credential: a real P-256 key pair and its id. `counting`
 *  authenticators advance their signature counter on every assertion; the others
 *  report 0 forever, as platform passkeys do (the spec exemption). */
export interface Authenticator {
  id: string;
  idBytes: Buffer;
  privateKey: KeyObject;
  cose: Buffer;
  /** The raw P-256 coordinates, so a test can re-encode the same key differently. */
  x: Buffer;
  y: Buffer;
  counting: boolean;
  signCount: number;
}

function ec2Cose(x: Buffer, y: Buffer): Buffer {
  return cborMap([
    [1, cborInt(2)], [3, cborInt(-7)], [-1, cborInt(1)],
    [-2, cborBytes(x)],
    [-3, cborBytes(y)],
  ]);
}

export function newAuthenticator(counting: boolean): Authenticator {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const idBytes = randomBytes(16);
  return { id: idBytes.toString("base64url"), idBytes, privateKey, cose: ec2Cose(x, y), x, y, counting, signCount: counting ? 1 : 0 };
}

/** The SAME key pair under a different credential id. With `none` attestation the id is
 *  whatever the client puts in authData — nothing signs it — so this is what a party
 *  holding a revoked authenticator (or just its public key) can present. */
export function sameKeyNewId(auth: Authenticator): Authenticator {
  const idBytes = randomBytes(16);
  return { ...auth, id: idBytes.toString("base64url"), idBytes };
}

/** The SAME key, RE-ENCODED: its x coordinate sent as 33 bytes with a leading 0x00, under
 *  a fresh credential id. Nothing in the attestation path length-checks the coordinate and
 *  Node verifies with it, so this is the same key byte-for-byte different — what a party
 *  holding a revoked authenticator can present to dodge an exact-string key match. */
export function paddedKeyNewId(auth: Authenticator): Authenticator {
  const x = Buffer.concat([Buffer.from([0x00]), auth.x]);
  return { ...sameKeyNewId(auth), x, cose: ec2Cose(x, auth.y) };
}

export interface MintedCeremony {
  challengeId: string;
  challenge: string;
}

/** Mint a registration ceremony — the options call, nothing completed yet. */
export async function mintEnrolment(userId: string): Promise<MintedCeremony> {
  const opts = await webauthn.generateRegistrationOptions(userId, userId, userId);
  return { challengeId: opts.challengeId, challenge: opts.challenge };
}

/** Complete a minted ceremony with this authenticator (`none` attestation, UP+UV). */
export async function completeEnrolment(userId: string, ceremony: MintedCeremony, auth: Authenticator, tenant: string) {
  const len = Buffer.alloc(2); len.writeUInt16BE(auth.idBytes.length, 0);
  const attested = Buffer.concat([Buffer.alloc(16), len, auth.idBytes, auth.cose]);
  const attestationObject = cborMap([
    ["fmt", cborText("none")],
    ["attStmt", cborMap([])],
    ["authData", cborBytes(authData(UP_UV_AT, auth.counting ? auth.signCount - 1 : 0, attested))],
  ]).toString("base64url");
  return webauthn.verifyRegistration(userId, ceremony.challengeId, {
    id: auth.id,
    rawId: auth.id,
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", ceremony.challenge).toString("base64url"),
      attestationObject,
    },
  }, tenant);
}

export async function enrol(userId: string, auth: Authenticator, tenant: string) {
  return completeEnrolment(userId, await mintEnrolment(userId), auth, tenant);
}

/** Mint an authentication challenge and sign it — everything up to, not including,
 *  verification, so a proof can arm a fault between the two. */
export async function signAssertion(userId: string, auth: Authenticator) {
  const opts = await webauthn.generateAuthenticationOptions(userId);
  const count = auth.counting ? ++auth.signCount : 0;
  const ad = authData(UP_UV, count);
  const cd = clientData("webauthn.get", opts.challenge);
  const signature = createSign("SHA256").update(Buffer.concat([ad, sha256(cd)])).sign(auth.privateKey);
  return {
    challengeId: opts.challengeId,
    response: {
      id: auth.id,
      rawId: auth.id,
      type: "public-key",
      response: {
        clientDataJSON: cd.toString("base64url"),
        authenticatorData: ad.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    },
  };
}

/** A full step-up assertion: mint the challenge, sign it, verify it. */
export async function stepUp(userId: string, auth: Authenticator, tenant: string) {
  const { challengeId, response } = await signAssertion(userId, auth);
  return webauthn.verifyAuthentication(userId, challengeId, response, tenant);
}
