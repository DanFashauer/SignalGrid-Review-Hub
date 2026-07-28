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
//   8. Attestation statements: a valid `packed` self-attestation is ACCEPTED; a
//      forged signature, an alg/key mismatch, an unsupported format, a malformed
//      `none`, and a malformed `fido-u2f` all FAIL CLOSED.
//   9. Challenge lifecycle: a single-use challenge is consumed on first verify and
//      REPLAY is rejected; an EXPIRED challenge is rejected; a PURPOSE mismatch
//      (registration challenge used for auth) and a USER-binding mismatch are both
//      rejected — the freshness/binding guards, not just the signature.
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

  // ── 1b. Attestation-statement verification (packed / none / unknown) ───────
  // Register with a chosen attestationObject builder; each gets a fresh
  // challenge + user so results are independent.
  async function registerWith(
    who: string,
    build: (authData: Buffer, clientDataJSON: Buffer) => Buffer,
  ) {
    const chId = randomBytes(16).toString("base64url");
    const ch = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chId, {
      challenge: ch,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      purpose: "registration",
      userId: who,
    });
    const authData = buildAuthData(rpId, 0x45, 0, attestedCredentialData(credId, cose)); // UP+UV+AT
    const cd = clientData("webauthn.create", ch, origin);
    const attObj = build(authData, cd).toString("base64url");
    return webauthn.verifyRegistration(who, chId, {
      id: credIdStr,
      rawId: credIdStr,
      type: "public-key",
      response: { clientDataJSON: cd.toString("base64url"), attestationObject: attObj },
    });
  }

  // Valid `packed` self-attestation: the credential key signs authData||hash.
  const packedOk = await registerWith("user-packed-ok", (authData, cd) => {
    const sig = createSign("SHA256").update(Buffer.concat([authData, sha256(cd)])).sign(privateKey);
    return cborMap([
      ["fmt", cborText("packed")],
      ["attStmt", cborMap([["alg", cborInt(-7)], ["sig", cborBytes(sig)]])],
      ["authData", cborBytes(authData)],
    ]);
  });
  check("valid packed self-attestation accepted", packedOk.success === true);

  // Forged `packed` signature: a byte flipped in the signature must be rejected.
  const packedBad = await registerWith("user-packed-bad", (authData, cd) => {
    const sig = createSign("SHA256").update(Buffer.concat([authData, sha256(cd)])).sign(privateKey);
    sig[sig.length - 1] ^= 0xff;
    return cborMap([
      ["fmt", cborText("packed")],
      ["attStmt", cborMap([["alg", cborInt(-7)], ["sig", cborBytes(sig)]])],
      ["authData", cborBytes(authData)],
    ]);
  });
  check("forged packed self-attestation rejected", packedBad.success === false);

  // `packed` with an alg that doesn't match the credential key must be rejected.
  const packedAlg = await registerWith("user-packed-alg", (authData, cd) => {
    const sig = createSign("SHA256").update(Buffer.concat([authData, sha256(cd)])).sign(privateKey);
    return cborMap([
      ["fmt", cborText("packed")],
      ["attStmt", cborMap([["alg", cborInt(-257)], ["sig", cborBytes(sig)]])], // claims RS256 over an EC2 key
      ["authData", cborBytes(authData)],
    ]);
  });
  check("packed alg/key mismatch rejected", packedAlg.success === false);

  // An unsupported attestation format (e.g. tpm) fails closed.
  const unknownFmt = await registerWith("user-unknown-fmt", (authData) =>
    cborMap([
      ["fmt", cborText("tpm")],
      ["attStmt", cborMap([["alg", cborInt(-7)], ["sig", cborBytes(randomBytes(64))]])],
      ["authData", cborBytes(authData)],
    ]),
  );
  check("unsupported attestation format fails closed", unknownFmt.success === false);

  // `none` with a NON-empty statement is malformed and must be rejected.
  const noneBad = await registerWith("user-none-bad", (authData) =>
    cborMap([
      ["fmt", cborText("none")],
      ["attStmt", cborMap([["x", cborInt(1)]])],
      ["authData", cborBytes(authData)],
    ]),
  );
  check("none format with non-empty statement rejected", noneBad.success === false);

  // `fido-u2f` missing its required x5c/sig is malformed and fails closed. (The
  // positive x5c path shares X509Certificate.publicKey + ECDSA verify with the
  // packed-x5c path; a full vector needs a real attestation cert, out of scope
  // for a stdlib-only fixture.)
  const u2fBad = await registerWith("user-u2f-bad", (authData) =>
    cborMap([
      ["fmt", cborText("fido-u2f")],
      ["attStmt", cborMap([["sig", cborBytes(randomBytes(64))]])], // no x5c
      ["authData", cborBytes(authData)],
    ]),
  );
  check("fido-u2f without x5c fails closed", u2fBad.success === false);

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

  // ── Challenge-lifecycle negatives: replay, expiry, purpose/user binding ────
  // Build a genuinely-signed assertion for a given saved challenge id, so we can
  // exercise the lifecycle guards independently of the signature check.
  function signedAssertion(challenge: string, signCount: number) {
    const cd = clientData("webauthn.get", challenge, origin);
    const authData = buildAuthData(rpId, 0x05, signCount); // UP+UV
    const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(cd)])).sign(privateKey);
    return {
      id: credIdStr,
      rawId: credIdStr,
      type: "public-key" as const,
      response: {
        clientDataJSON: cd.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }

  // 8. A single-use challenge is consumed on first verify and cannot be replayed.
  {
    const chId = randomBytes(16).toString("base64url");
    const ch = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chId, {
      challenge: ch, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "authentication", userId,
    });
    const resp = signedAssertion(ch, 20);
    const first = await webauthn.verifyAuthentication(userId, chId, resp);
    const second = await webauthn.verifyAuthentication(userId, chId, resp);
    check("challenge accepted on first use", first.success === true);
    check("replayed challenge (same id) rejected on second use", second.success === false);
  }

  // 9. An expired challenge is rejected even with a valid signature (freshness is
  //    enforced independently of any store TTL).
  {
    const chId = randomBytes(16).toString("base64url");
    const ch = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chId, {
      challenge: ch, expiresAt: new Date(Date.now() - 1000).toISOString(), purpose: "authentication", userId,
    });
    const res = await webauthn.verifyAuthentication(userId, chId, signedAssertion(ch, 21));
    check("expired challenge rejected", res.success === false);
  }

  // 9b. Signature-counter clone reset: once a credential has ADVANCED (counter > 0), an
  //     assertion reporting counter 0 is a cloned authenticator whose counter reset. The
  //     spec exemption for always-zero authenticators must not launder this through — the
  //     general regression check only fires when BOTH counters are non-zero, so zero is
  //     the gap this covers.
  {
    // Advance the stored counter well past any earlier test's value.
    const chIdA = randomBytes(16).toString("base64url");
    const chA = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chIdA, {
      challenge: chA, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "authentication", userId,
    });
    const advanced = await webauthn.verifyAuthentication(userId, chIdA, signedAssertion(chA, 1000));
    check("a valid high-counter assertion advances the stored counter (setup)", advanced.success === true);

    const chIdB = randomBytes(16).toString("base64url");
    const chB = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chIdB, {
      challenge: chB, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "authentication", userId,
    });
    const cloneZero = await webauthn.verifyAuthentication(userId, chIdB, signedAssertion(chB, 0));
    check("a zero counter AFTER the credential advanced is rejected as a clone reset", cloneZero.success === false);
  }

  // 10. A registration-purpose challenge cannot complete authentication.
  {
    const chId = randomBytes(16).toString("base64url");
    const ch = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chId, {
      challenge: ch, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "registration", userId,
    });
    const res = await webauthn.verifyAuthentication(userId, chId, signedAssertion(ch, 22));
    check("authentication with a registration-purpose challenge rejected", res.success === false);
  }

  // 11. A challenge bound to a different user cannot be used by this user.
  {
    const chId = randomBytes(16).toString("base64url");
    const ch = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(chId, {
      challenge: ch, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "authentication", userId: "some-other-user",
    });
    const res = await webauthn.verifyAuthentication(userId, chId, signedAssertion(ch, 23));
    check("challenge bound to a different user rejected", res.success === false);
  }

  // ── 12. Signature-counter clone detection ────────────────────────────────
  // Register a fresh credential, authenticate once to advance the stored
  // signature counter to N, then submit a genuinely-signed assertion whose
  // signCount is <= N. A real authenticator's counter strictly increases, so a
  // valid signature reporting a non-increasing counter signals a CLONED
  // authenticator (two devices sharing the key) and must be rejected — the
  // clone guard, not the signature check.
  {
    const cloneUser = "user-clone-detect";
    const { publicKey: clonePub, privateKey: clonePriv } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const cloneJwk = clonePub.export({ format: "jwk" }) as { x: string; y: string };
    const cloneCose = coseFromJwk(cloneJwk);
    const cloneCredId = randomBytes(16);
    const cloneCredIdStr = cloneCredId.toString("base64url");

    // Register the credential (stored counter starts at 0).
    const cloneRegChId = randomBytes(16).toString("base64url");
    const cloneRegCh = randomBytes(32).toString("base64url");
    await webauthnStore.saveChallenge(cloneRegChId, {
      challenge: cloneRegCh, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "registration", userId: cloneUser,
    });
    const cloneRegAuth = buildAuthData(rpId, 0x45, 0, attestedCredentialData(cloneCredId, cloneCose)); // UP+UV+AT
    const cloneRegCd = clientData("webauthn.create", cloneRegCh, origin);
    const cloneAttObj = cborMap([
      ["fmt", cborText("none")],
      ["attStmt", cborMap([])],
      ["authData", cborBytes(cloneRegAuth)],
    ]).toString("base64url");
    const cloneReg = await webauthn.verifyRegistration(cloneUser, cloneRegChId, {
      id: cloneCredIdStr, rawId: cloneCredIdStr, type: "public-key",
      response: { clientDataJSON: cloneRegCd.toString("base64url"), attestationObject: cloneAttObj },
    });
    check("clone-detect: registration succeeds", cloneReg.success === true);

    // Genuine assertion signer for this credential at a chosen signCount.
    async function cloneAssert(signCount: number) {
      const chId = randomBytes(16).toString("base64url");
      const ch = randomBytes(32).toString("base64url");
      await webauthnStore.saveChallenge(chId, {
        challenge: ch, expiresAt: new Date(Date.now() + 60_000).toISOString(), purpose: "authentication", userId: cloneUser,
      });
      const cd = clientData("webauthn.get", ch, origin);
      const authData = buildAuthData(rpId, 0x05, signCount); // UP+UV
      const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(cd)])).sign(clonePriv);
      return webauthn.verifyAuthentication(cloneUser, chId, {
        id: cloneCredIdStr, rawId: cloneCredIdStr, type: "public-key",
        response: {
          clientDataJSON: cd.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      });
    }

    const N = 10;
    // Advance the stored counter to N with a genuine, strictly-increasing assertion.
    const cloneAdvance = await cloneAssert(N);
    check("clone-detect: genuine assertion advances counter to N", cloneAdvance.success === true);

    // A fresh, genuinely-signed assertion whose signCount EQUALS N (not strictly
    // greater) is what a cloned authenticator produces — reject it as a clone.
    const cloneEqual = await cloneAssert(N);
    check("clone-detect: signCount == N (non-increasing) rejected as clone", cloneEqual.success === false);

    // A genuinely-signed assertion whose signCount is BELOW N (counter regression)
    // must likewise be rejected.
    const cloneLower = await cloneAssert(N - 4);
    check("clone-detect: signCount < N (regression) rejected as clone", cloneLower.success === false);
  }

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

  // ── 13. Atomic counter compare-and-advance (concurrent-completion race) ────
  // The counter persist is a compare-and-advance, not a read-modify-write: two valid
  // challenges for the same credential must not both advance from the SAME stored value
  // and then write out of order so the lower overwrites the higher (after which a clone
  // could re-present the already-used higher count). advanceCredentialCounter enforces
  // that exactly one advance from a given expected value wins; the other fails closed.
  const casUser = "user-cas";
  const casCred = "cas-cred";
  await webauthnStore.addCredential(casUser, {
    id: casCred, publicKey: JSON.stringify({ jwk: {}, alg: -7 }), counter: 5,
    createdAt: new Date().toISOString(),
  });
  // First racer reads stored=5 and advances to 10 — wins.
  const casWin = await webauthnStore.advanceCredentialCounter(casUser, casCred, 5, 10, new Date().toISOString());
  check("cas: an advance from the correct expected counter succeeds", casWin === true);
  check("cas: the stored counter is now the higher value", (await webauthnStore.getCredentialsForUser(casUser))[0].counter === 10);
  // Second racer also read stored=5 (stale) and tries to advance to 8 — must fail closed,
  // and must NOT lower the stored counter from 10 back to 8.
  const casLose = await webauthnStore.advanceCredentialCounter(casUser, casCred, 5, 8, new Date().toISOString());
  check("cas: a second advance from a STALE expected counter fails closed", casLose === false);
  check("cas: the losing racer did NOT overwrite the higher stored counter", (await webauthnStore.getCredentialsForUser(casUser))[0].counter === 10);
  // A non-increase is never a legitimate advance, even from the correct expected value.
  check("cas: a non-increasing advance (equal) is refused", (await webauthnStore.advanceCredentialCounter(casUser, casCred, 10, 10, new Date().toISOString())) === false);
  check("cas: a regressing advance is refused", (await webauthnStore.advanceCredentialCounter(casUser, casCred, 10, 9, new Date().toISOString())) === false);
  // An unknown credential/user fails closed rather than throwing.
  check("cas: an unknown credential fails closed", (await webauthnStore.advanceCredentialCounter(casUser, "no-such-cred", 10, 11, new Date().toISOString())) === false);
  check("cas: a legitimate later advance from the NEW expected value succeeds", (await webauthnStore.advanceCredentialCounter(casUser, casCred, 10, 11, new Date().toISOString())) === true);

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
