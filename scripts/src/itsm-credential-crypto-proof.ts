// Proof: the ITSM credential store derives its AES-256 key from ENTROPY, and refuses
// a secret it would otherwise have to stretch.
//
// THE DEFECT THIS PINS. getEncryptionKey() built the key as
// `Buffer.from(encryptionKey.slice(0, 32).padEnd(32, '0'))` — truncate to 32
// CHARACTERS, pad with ASCII '0'. That is accurate about producing 32 bytes and
// answers a different question than the one being asked, which is whether those are
// 32 bytes of entropy. `ITSM_ENCRYPTION_KEY=secret` became `secret` followed by 26
// zero bytes; a 64-hex-character secret — the natural way to express 32 bytes — was
// cut to its first 32 characters, i.e. 16 bytes of entropy, and reported success.
//
// This file is also the encryption path's FIRST test of any kind. It was the only
// createCipheriv site in the repository and nothing exercised it: itsm-template-proof
// covers the template half of the same module and never touches encrypt/decrypt.
//
// Run: pnpm --filter @workspace/scripts run proof:itsm-credential-crypto
import { createHash } from "node:crypto";
import {
  MIN_ENCRYPTION_KEY_LENGTH,
  __cryptoInternals as sut,
} from "@workspace/integrations/itsm/store";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

const STRONG = "a".repeat(16) + "b".repeat(16); // 32 chars, meets the floor
const withKey = <T,>(value: string | undefined, fn: () => T): T => {
  const prevItsm = process.env.ITSM_ENCRYPTION_KEY;
  const prevGeneric = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  if (value === undefined) delete process.env.ITSM_ENCRYPTION_KEY;
  else process.env.ITSM_ENCRYPTION_KEY = value;
  try { return fn(); }
  finally {
    if (prevItsm === undefined) delete process.env.ITSM_ENCRYPTION_KEY; else process.env.ITSM_ENCRYPTION_KEY = prevItsm;
    if (prevGeneric === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = prevGeneric;
  }
};
const throws = (value: string | undefined): boolean => {
  try { withKey(value, () => sut.deriveKey()); return false; } catch { return true; }
};

console.log("Proof: ITSM credential crypto — key derivation and round trip\n");

// --- FAIL-CLOSED: an inadequate secret is refused, never stretched ---------------
check("a missing key is refused", throws(undefined));
check("an empty key is refused", throws(""));
check("a human-typed password ('secret') is REFUSED, not padded to 32 bytes", throws("secret"));
check(
  `a key one character under the ${MIN_ENCRYPTION_KEY_LENGTH}-char floor is refused`,
  throws("x".repeat(MIN_ENCRYPTION_KEY_LENGTH - 1)),
);
check(`a key exactly at the floor is accepted`, !throws("x".repeat(MIN_ENCRYPTION_KEY_LENGTH)));

// --- ENTROPY IS NOT TRUNCATED ----------------------------------------------------
// The pre-fix implementation sliced to 32 chars, so two 64-char secrets sharing a
// prefix collided onto ONE key. This is the check that fails against it.
const sharedPrefix = "f".repeat(32);
const keyA = withKey(sharedPrefix + "0".repeat(32), () => sut.deriveKey());
const keyB = withKey(sharedPrefix + "1".repeat(32), () => sut.deriveKey());
check(
  "two 64-char secrets sharing their first 32 chars derive DIFFERENT keys (entropy past char 32 is not discarded)",
  !keyA.equals(keyB),
);

const derived = withKey(STRONG, () => sut.deriveKey());
check("the derived key is exactly 32 bytes (AES-256)", derived.length === 32);
check(
  "derivation is SHA-256 of the secret, matching the sibling webhooks store",
  derived.equals(createHash("sha256").update(STRONG, "utf8").digest()),
);
// DELIBERATELY ABSENT: a "derived key has no ASCII-zero padding tail" check. It was
// written, and it passed against the PRE-FIX implementation too — padding only appears
// for a secret shorter than 32 chars, and such a secret now throws before derivation is
// reached, so the check could never fail in either direction. The entropy property it
// was reaching for is covered by the shared-prefix check above, which does fail pre-fix.
check("derivation is deterministic for a given secret", withKey(STRONG, () => sut.deriveKey()).equals(derived));

// --- ROUND TRIP ------------------------------------------------------------------
const secretValue = 'api-token-«ünïcødé»-{"nested":"json"}';
const payload = withKey(STRONG, () => sut.encrypt(secretValue));
check("round trip returns the exact plaintext", withKey(STRONG, () => sut.decrypt(payload)) === secretValue);
check("the ciphertext does not contain the plaintext", !payload.includes(secretValue));

const [ivHex, tagHex, ctHex] = payload.split(":");
check("payload is iv:authTag:ciphertext", payload.split(":").length === 3);
check("the IV is GCM's standard 12 bytes", Buffer.from(ivHex, "hex").length === 12);
check("the GCM auth tag is 16 bytes", Buffer.from(tagHex, "hex").length === 16);

// Nonce reuse under a fixed key is the catastrophic failure mode for GCM.
const ivs = new Set(Array.from({ length: 64 }, () => withKey(STRONG, () => sut.encrypt(secretValue)).split(":")[0]));
check("64 encryptions under one key produce 64 distinct IVs (no nonce reuse)", ivs.size === 64);

// --- TAMPERING AND WRONG KEYS FAIL CLOSED ----------------------------------------
const flipLastHex = (h: string): string => h.slice(0, -1) + (h.slice(-1) === "0" ? "1" : "0");
const decryptThrows = (key: string, p: string): boolean => {
  try { withKey(key, () => sut.decrypt(p)); return false; } catch { return true; }
};
check("a tampered ciphertext is REJECTED by the auth tag, not returned as garbage",
  decryptThrows(STRONG, `${ivHex}:${tagHex}:${flipLastHex(ctHex)}`));
check("a tampered auth tag is rejected", decryptThrows(STRONG, `${ivHex}:${flipLastHex(tagHex)}:${ctHex}`));
check("a tampered IV is rejected", decryptThrows(STRONG, `${flipLastHex(ivHex)}:${tagHex}:${ctHex}`));
check("a malformed payload is rejected", decryptThrows(STRONG, "not-an-encrypted-value"));
check("decrypting under a DIFFERENT key fails rather than returning plaintext",
  decryptThrows("z".repeat(40), payload));

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed}/${passed + failures.length} checks`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
