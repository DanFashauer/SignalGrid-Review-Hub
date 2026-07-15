// Proof: WebAuthn assertion/attestation signature verification.
//
// Exercises @workspace/webauthn end-to-end with REAL generated keys to prove the
// verification is cryptographic (not a stub):
//   1. A genuinely-signed registration + assertion is ACCEPTED.
//   2. A tampered signature is REJECTED.
//   3. An assertion signed by a DIFFERENT key is REJECTED.
//   4. A wrong-rpId assertion is REJECTED.
//   5. A legacy stub credential (non-verifiable public key) FAILS CLOSED.
//   6. An assertion WITHOUT the User-Verified flag is REJECTED (step-up needs UV).
//   7. A look-alike origin (prefix, not exact) is REJECTED.
//
// Run: pnpm --filter @workspace/scripts run proof:webauthn-verify

import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from "crypto";
import { webauthn, webauthnStore } from "@workspace/webauthn";

// ── tiny CBOR encoder (only what these fixtures need) ───────────────────────
function cborUint(n: number): Buffer {
  if (n < 24) return Buffer.from([n]);
  if (n < 256) return Buffer.from([0x18, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(n, 1); return b;
}
function cborNegInt(value: number): Buffer {
  // value is negative; encode major type 1 with n = -1 - value
  const n = -1 - value;
  const u = cborUint(n);
  u[0] = (u[0] & 0x1f) | 0x20;
  return u;
}
function cborInt(value: number): Buffer {
  return value < 0 ? cborNegInt(value) : cborUint(value);
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
// map of [key, valueBuffer] pairs where key is int or string
function cborMap(pairs: Array<[number | string, Buffer]>): Buffer {
  const head = cborUint(pairs.length); head[0] = (head[0] & 0x1f) | 0xa0;
  const body = pairs.map(([k, v]) =>
    Buffer.concat([typeof k === "number" ? cborInt(k) : cborText(k), v]),
  );
  return Buffer.concat([head, ...body]);
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

// ── build a COSE EC2/ES256 public key from a JWK ────────────────────────────
function coseFromJwk(jwk: { x: string; y: string }): Buffer {
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return cborMap([
    [1, cborInt(2)],    // kty: EC2
    [3, cborInt(-7)],   // alg: ES256
    [-1, cborInt(1)],   // crv: P-256
    [-2, cborBytes(x)], // x
    [-3, cborBytes(y)], // y
  ]);
}

function buildAuthData(rpId: string, flags: number, signCount: number, attestedCred?: Buffer): Buffer {
  const rpIdHash = sha256(Buffer.from(rpId, "utf8"));
  const head = Buffer.alloc(37);
  rpIdHash.copy(head, 0);
  head.writeUInt8(flags, 32);
  head.writeUInt32BE(signCount, 33);
  return attestedCred ? Buffer.concat([head, attestedCred]) : head;
}

function attestedCredentialData(credId: Buffer, cose: Buffer): Buffer {
  const aaguid = Buffer.alloc(16); // zeros
  const credIdLen = Buffer.alloc(2); credIdLen.writeUInt16BE(credId.length, 0);
  return Buffer.concat([aaguid, credIdLen, credId, cose]);
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin }), "utf8");
}

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) { passed += 1; } else { failures.push(name); }
}

async function main() {
  const rpId = "localhost";
  const origin = "http://localhost:3000";
  const userId = "user-proof-1";

  // Generate a real P-256 credential keypair.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const cose = coseFromJwk(jwk);
  const credId = randomBytes(16);
  const credIdStr = credId.toString("base64url");

  // ── 1. Registration with a genuine attestation object ─────────────────────
  const regChallengeId = randomBytes(16).toString("base64url");
  const regChallenge = randomBytes(32).toString("base64url");
  await webauthnStore.saveChallenge(regChallengeId, {
    challenge: regChallenge,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    purpose: "registration",
    userId,
  });

  const regAuthData = buildAuthData(rpId, 0x45, 0, attestedCredentialData(credId, cose)); // UP+UV+AT
  const attestationObject = cborMap([
    ["fmt", cborText("none")],
    ["attStmt", cborMap([])],
    ["authData", cborBytes(regAuthData)],
  ]).toString("base64url");

  const reg = await webauthn.verifyRegistration(userId, regChallengeId, {
    id: credIdStr,
    rawId: credIdStr,
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", regChallenge, origin).toString("base64url"),
      attestationObject,
    },
  });
  check("registration with real attestation succeeds", reg.success === true);

  // Helper: run an assertion with a chosen signer + rpId + counter.
  async function runAssertion(opts: {
    signer: typeof privateKey;
    rpIdForAuth?: string;
    signCount?: number;
    tamperSig?: boolean;
    flags?: number;
    originForAuth?: string;
  }) {
    const challengeId = randomBytes(16).toString("base64url");
    const challenge = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(challengeId, {
      challenge,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      purpose: "authentication",
      userId,
    });
    const cd = clientData("webauthn.get", challenge, opts.originForAuth ?? origin);
    const authData = buildAuthData(opts.rpIdForAuth ?? rpId, opts.flags ?? 0x05, opts.signCount ?? 1); // default UP+UV
    const signed = Buffer.concat([authData, sha256(cd)]);
    let signature = createSign("SHA256").update(signed).sign(opts.signer); // DER ECDSA
    if (opts.tamperSig) signature = Buffer.concat([signature.subarray(0, signature.length - 1), Buffer.from([signature[signature.length - 1] ^ 0xff])]);
    return webauthn.verifyAuthentication(userId, challengeId, {
      id: credIdStr,
      rawId: credIdStr,
      type: "public-key",
      response: {
        clientDataJSON: cd.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    });
  }

  // ── 2. Genuine assertion accepted ─────────────────────────────────────────
  const good = await runAssertion({ signer: privateKey, signCount: 5 });
  check("genuine assertion signature accepted", good.success === true);

  // ── 3. Tampered signature rejected ────────────────────────────────────────
  const tampered = await runAssertion({ signer: privateKey, signCount: 6, tamperSig: true });
  check("tampered signature rejected", tampered.success === false);

  // ── 4. Assertion signed by a different key rejected ───────────────────────
  const { privateKey: otherKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const forged = await runAssertion({ signer: otherKey, signCount: 7 });
  check("assertion from wrong key rejected", forged.success === false);

  // ── 5. Wrong rpId rejected ────────────────────────────────────────────────
  const wrongRp = await runAssertion({ signer: privateKey, rpIdForAuth: "evil.example", signCount: 8 });
  check("wrong rpId hash rejected", wrongRp.success === false);

  // ── 6. Missing User-Verified flag rejected (step-up requires UV) ───────────
  const noUv = await runAssertion({ signer: privateKey, signCount: 9, flags: 0x01 }); // UP only, no UV
  check("assertion without user-verification rejected", noUv.success === false);

  // ── 7. Look-alike origin rejected (exact match, not prefix) ────────────────
  const badOrigin = await runAssertion({ signer: privateKey, signCount: 9, originForAuth: origin + ".evil.com" });
  check("look-alike origin (prefix) rejected", badOrigin.success === false);

  // ── 6. Legacy stub credential fails closed ────────────────────────────────
  const legacyUser = "user-legacy";
  await webauthnStore.addCredential(legacyUser, {
    id: "legacy-cred",
    publicKey: randomBytes(64).toString("base64url"), // old stub: raw blob, not a VerifiableKey
    counter: 0,
    createdAt: new Date().toISOString(),
  });
  const legacyChallengeId = randomBytes(16).toString("base64url");
  const legacyChallenge = randomBytes(32).toString("base64url");
  await webauthnStore.saveChallenge(legacyChallengeId, {
    challenge: legacyChallenge,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    purpose: "authentication",
    userId: legacyUser,
  });
  const legacyCd = clientData("webauthn.get", legacyChallenge, origin);
  const legacyAuth = buildAuthData(rpId, 0x01, 1);
  const legacy = await webauthn.verifyAuthentication(legacyUser, legacyChallengeId, {
    id: "legacy-cred",
    rawId: "legacy-cred",
    type: "public-key",
    response: {
      clientDataJSON: legacyCd.toString("base64url"),
      authenticatorData: legacyAuth.toString("base64url"),
      signature: randomBytes(70).toString("base64url"),
    },
  });
  check("legacy stub credential fails closed", legacy.success === false);

  const total = passed + failures.length;
  console.log(`WebAuthn verification proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Cryptographic assertion verification confirmed (positive + negative paths).");
}

main().catch((err) => { console.error(err); process.exit(1); });
