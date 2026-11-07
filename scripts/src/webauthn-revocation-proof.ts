// Revocation proof — a revoked step-up credential must stay revoked.
//
//   pnpm run proof:webauthn-revocation
//
// Two gaps found by reading the code while reviewing PR #1240 (plan row 82). Both are
// reproduced here through the REAL ceremony functions (`generateRegistrationOptions` →
// `verifyRegistration`, `generateAuthenticationOptions` → `verifyAuthentication`) with
// real P-256 keys, in the in-memory store, deterministically. The Redis-mode halves run
// in `proof:enrollment-race`, which needs a real Redis.
//
// GAP 1 — REVIVAL BY ENROLMENT. `removeCredential` deleted the credential and left no
// trace of it. An enrolment ceremony is minted with `excludeCredentials: []`, so a
// ceremony minted BEFORE the revocation and completed AFTER it re-presents the revoked
// authenticator, `addCredential`'s duplicate check finds nothing, answers
// `stored: true`, and the revoked credential id is live again. The per-user lock cannot
// help: the revoke and the enrolment run one after the other, not at the same time.
//
// GAP 2 — RELEASE AFTER REVOCATION. `verifyAuthentication` read the credential EARLY
// (before the signature check) and only touched the store again through
// `advanceCredentialCounter`, which runs only when the signature counter increases.
// An always-zero-counter authenticator — every platform passkey — never re-read the
// record, so a revocation that committed after the early read still released the
// step-up. A counting authenticator was caught (the counter CAS re-reads and finds the
// credential gone); that asymmetry is asserted below as the control.
//
// HOW THE GAP-2 REVOCATION IS PLACED. No production injection point exists or was
// added. In the in-memory store `removeCredential` has no await between its read and
// its write, so CALLING it performs the revocation synchronously. `verifyAuthentication`
// parses the stored public-key string with `JSON.parse` immediately after its early
// read, so this proof wraps the global `JSON.parse` (the narrow-external-stub shape
// `webauthn-enrollment-race-proof.ts` uses for ioredis `get`) and, the one time it is
// handed exactly that string, revokes the credential — after the early read, before
// release. The wrapper is restored in a `finally`, and every scenario that relies on it
// asserts it FIRED, so a refactor that stops parsing the key there turns this proof red
// rather than vacuously green.

import { webauthnStore } from "@workspace/webauthn";
import { getAuditRecords } from "@workspace/audit";
import {
  completeEnrolment,
  enrol as enrolAs,
  mintEnrolment,
  newAuthenticator,
  paddedKeyNewId,
  sameKeyNewId,
  stepUp as stepUpAs,
  type Authenticator,
} from "./lib/webauthn-ceremony";

// The store chooses its backend per call, by configuration. This proof is the
// in-memory half; `proof:enrollment-race` is the Redis half.
delete process.env.REDIS_URL;

const TENANT = "tenant_webauthn_revocation_proof";
const enrol = (userId: string, auth: Authenticator) => enrolAs(userId, auth, TENANT);
const stepUp = (userId: string, auth: Authenticator) => stepUpAs(userId, auth, TENANT);

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean, detail = "") => {
  total += 1;
  if (ok) passed += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} — ${name}${detail && !ok ? `: ${detail}` : ""}`);
};

const enrolledIds = async (userId: string) =>
  (await webauthnStore.getCredentialsForUser(userId)).map((c) => c.id);

/** Run `body` with `action` fired synchronously the first time `JSON.parse` receives
 *  exactly `needle`. See the file header for why this is the placement point. */
async function withRevocationAtParse<T>(needle: string, action: () => void, body: () => Promise<T>) {
  const realParse = JSON.parse;
  let fired = false;
  JSON.parse = function (text: string, reviver?: Parameters<typeof JSON.parse>[1]) {
    if (!fired && text === needle) {
      fired = true;
      action();
    }
    return realParse.call(JSON, text, reviver);
  } as typeof JSON.parse;
  try {
    return { result: await body(), fired };
  } finally {
    JSON.parse = realParse;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
async function gapOneRevivalByEnrolment() {
  console.log("Gap 1 — an enrolment ceremony must not bring a revoked credential back\n");

  const user = "t_proof:revocation-gap1";
  const device = newAuthenticator(false);
  const first = await enrol(user, device);
  check("baseline: the authenticator enrols through a real ceremony", first.success === true && first.alreadyEnrolled === false, first.error);

  // THE GAP, in the order the finding names: ceremony minted, credential revoked,
  // ceremony completed. The two store calls never overlap, so no lock is involved.
  const outstanding = await mintEnrolment(user);
  const revoked = await webauthnStore.removeCredential(user, device.id);
  check("the revocation reports that it removed the credential", revoked === true);
  const revived = await completeEnrolment(user, outstanding, device, TENANT);
  check(
    "a ceremony minted BEFORE the revocation and completed AFTER it is REFUSED",
    revived.success === false,
    `success=${revived.success} alreadyEnrolled=${revived.alreadyEnrolled} error=${revived.error}`,
  );
  check(
    "…and the revoked credential id is NOT live again",
    !(await enrolledIds(user)).includes(device.id),
    `enrolled: [${(await enrolledIds(user)).join(", ")}]`,
  );
  check("…and a step-up with the revoked authenticator is refused", (await stepUp(user, device)).success === false);

  // The refusal is audited as its own event: a revoked credential trying to come back
  // is exactly what a security reviewer needs to see in the ledger.
  const refusedRow = (await getAuditRecords(5000, 0)).find(
    (r) =>
      r.eventType === "security.webauthn.registration.refused" &&
      r.meta?.credentialId === device.id &&
      r.meta?.reason === "credential_revoked" &&
      r.tenantId === TENANT,
  );
  check("the refused re-enrolment is audited (security.webauthn.registration.refused, reason credential_revoked, tenanted)", refusedRow !== undefined);

  // POLICY PIN — this assertion is the one the owner's choice decides (see the PR):
  // under the TOMBSTONE option a revoked id stays refused even from a ceremony minted
  // AFTER the revocation; under the INVALIDATE-OUTSTANDING-CEREMONIES option this one
  // would enrol. Flip it deliberately if the policy changes, never to get green.
  const fresh = await completeEnrolment(user, await mintEnrolment(user), device, TENANT);
  check(
    "policy (tombstone): the revoked credential id is refused from a ceremony minted AFTER the revocation too",
    fresh.success === false && !(await enrolledIds(user)).includes(device.id),
    `success=${fresh.success} error=${fresh.error}`,
  );

  // The id is not the credential — the KEY is. With `none` attestation nothing signs the
  // credential id, so whoever holds the revoked authenticator (or only its public key)
  // can re-present the revoked key under a fresh id. The tombstone covers the key too.
  const disguised = sameKeyNewId(device);
  const disguisedEnrol = await completeEnrolment(user, await mintEnrolment(user), disguised, TENANT);
  check(
    "the revoked KEY under a NEW credential id is refused (the id is client-chosen; the key is what was revoked)",
    disguisedEnrol.success === false && !(await enrolledIds(user)).includes(disguised.id),
    `success=${disguisedEnrol.success} error=${disguisedEnrol.error}`,
  );
  check("…and a step-up signed by the revoked key under that id is not released", (await stepUp(user, disguised)).success === false);

  // …and RE-ENCODED (review round 2, MEDIUM): the same key with its x coordinate sent as
  // 33 bytes (a leading 0x00), under another fresh id. The key tombstone only holds
  // because the fingerprint is of the key's canonical SPKI DER — an exact-string match
  // would miss this, and nothing else pinned the canonicalisation. The control first
  // shows the padded encoding IS accepted on its own, so the refusal is revocation, not
  // a parse failure.
  const fresh2 = newAuthenticator(false);
  const paddedControl = paddedKeyNewId(fresh2);
  check(
    "control: a padded-coordinate encoding of a NON-revoked key enrols and releases a step-up",
    (await enrol("t_proof:revocation-gap1-padded-control", paddedControl)).success === true &&
      (await stepUp("t_proof:revocation-gap1-padded-control", paddedControl)).success === true,
  );
  const padded = paddedKeyNewId(device);
  const paddedEnrol = await completeEnrolment(user, await mintEnrolment(user), padded, TENANT);
  check(
    "the revoked key RE-ENCODED (x padded to 33 bytes) under a new id is refused AS REVOKED",
    paddedEnrol.success === false && /revoked/i.test(paddedEnrol.error ?? "") && !(await enrolledIds(user)).includes(padded.id),
    `success=${paddedEnrol.success} error=${paddedEnrol.error}`,
  );
  check("…and a step-up signed by it is not released", (await stepUp(user, padded)).success === false);

  // What the tombstone does NOT block: re-enrolling the same person's device. A
  // conforming authenticator generates a new key pair and credential id on every
  // registration, so re-enrolment arrives as a new id and is accepted.
  const reissued = newAuthenticator(false);
  const reenrolled = await enrol(user, reissued);
  check("re-enrolment with a NEW credential id (what a real authenticator returns) is accepted", reenrolled.success === true && reenrolled.alreadyEnrolled === false, reenrolled.error);
  check("…and that new credential releases a step-up", (await stepUp(user, reissued)).success === true);

  // Store level: the refusal is a THROW, so a caller that only reads `stored` can
  // never mistake it for "already enrolled, success".
  let storeRefusal: unknown;
  try {
    await webauthnStore.addCredential(user, { id: device.id, publicKey: "{}", counter: 0, createdAt: new Date(0).toISOString() });
  } catch (err) {
    storeRefusal = err;
  }
  check(
    "store: addCredential of a revoked id THROWS CredentialRevokedError (never { stored: false } read as success)",
    storeRefusal instanceof Error && storeRefusal.name === "CredentialRevokedError",
    String(storeRefusal),
  );

  // THE SAME KEY UNDER TWO IDS (review round 1, MEDIUM). `addCredential` dedupes by id,
  // so one key can sit on an identity under two ids — with `none` attestation, by
  // presenting it twice. Revoking one id used to tombstone the key but leave its twin
  // enrolled, and a step-up signed by the revoked key under the twin was released.
  // Revoking a credential revokes its KEY: every id on the identity carrying it goes.
  const twinUser = "t_proof:revocation-gap1-twin";
  const keyHolder = newAuthenticator(false);
  const twin = sameKeyNewId(keyHolder);
  check("twin: the key enrols under its first id", (await enrol(twinUser, keyHolder)).success === true);
  check("twin: …and again under a second id (dedupe is by id)", (await enrol(twinUser, twin)).success === true);
  check("twin: revoking the FIRST id reports the removal", (await webauthnStore.removeCredential(twinUser, keyHolder.id)) === true);
  check(
    "twin: the SECOND id carrying the same key is gone too",
    !(await enrolledIds(twinUser)).includes(twin.id),
    `enrolled: [${(await enrolledIds(twinUser)).join(", ")}]`,
  );
  check("twin: …and a step-up signed by the revoked key under the second id is not released", (await stepUp(twinUser, twin)).success === false);

  // Scope of the tombstone: only a credential that was actually removed is recorded.
  // A revoke that removed nothing (`false`) must not pre-block an id, or the answer
  // `revoked: false` would be a lie in the other direction.
  const user2 = "t_proof:revocation-gap1-scope";
  const later = newAuthenticator(false);
  check("revoking an id that was never enrolled reports false", (await webauthnStore.removeCredential(user2, later.id)) === false);
  const laterEnrol = await enrol(user2, later);
  check("…and records nothing: that id still enrols afterwards", laterEnrol.success === true && laterEnrol.alreadyEnrolled === false, laterEnrol.error);
  // Per identity: revocation is scoped to the identity it was issued for.
  const other = "t_proof:revocation-gap1-other-identity";
  const otherEnrol = await enrol(other, device);
  check("the tombstone is per identity: another identity is unaffected by this identity's revocation", otherEnrol.success === true, otherEnrol.error);
}

// ═══════════════════════════════════════════════════════════════════════════════════
async function gapTwoReleaseAfterRevocation() {
  console.log("\nGap 2 — a step-up must not be released over a credential revoked mid-verification\n");

  // Baseline: a zero-counter authenticator steps up normally.
  const user = "t_proof:revocation-gap2-zero";
  const passkey = newAuthenticator(false);
  check("baseline: a zero-counter (passkey-shaped) authenticator enrols", (await enrol(user, passkey)).success === true);
  check("baseline: …and releases a step-up", (await stepUp(user, passkey)).success === true);

  // THE GAP: the revocation commits after the early credential read, before release.
  const stored = (await webauthnStore.getCredentialsForUser(user)).find((c) => c.id === passkey.id);
  let revokedMidFlight: Promise<boolean> | undefined;
  const zero = await withRevocationAtParse(
    stored?.publicKey ?? "<no stored key>",
    () => { revokedMidFlight = webauthnStore.removeCredential(user, passkey.id); },
    () => stepUp(user, passkey),
  );
  check("the revocation was placed after the early read (the parse hook fired)", zero.fired === true);
  check("…and it committed", (await revokedMidFlight) === true);
  check(
    "zero-counter: a step-up whose credential was revoked mid-verification is NOT released",
    zero.result.success === false,
    `success=${zero.result.success} error=${zero.result.error}`,
  );
  const revokedRow = (await getAuditRecords(5000, 0)).find(
    (r) =>
      r.eventType === "security.webauthn.step_up.failure" &&
      r.meta?.credentialId === passkey.id &&
      r.meta?.reason === "credential_revoked" &&
      r.tenantId === TENANT,
  );
  check("…and the refusal is audited (step_up.failure, reason credential_revoked, tenanted)", revokedRow !== undefined);

  // A revocation on a credential that is NOT the one asserting must not refuse it —
  // the re-read checks THIS credential, not "did anything change".
  const user3 = "t_proof:revocation-gap2-sibling";
  const kept = newAuthenticator(false);
  const sibling = newAuthenticator(false);
  await enrol(user3, kept);
  await enrol(user3, sibling);
  const keptStored = (await webauthnStore.getCredentialsForUser(user3)).find((c) => c.id === kept.id);
  const unaffected = await withRevocationAtParse(
    keptStored?.publicKey ?? "<no stored key>",
    () => { void webauthnStore.removeCredential(user3, sibling.id); },
    () => stepUp(user3, kept),
  );
  check(
    "a revocation of a DIFFERENT credential mid-verification does not refuse this one",
    unaffected.fired === true && unaffected.result.success === true,
    `fired=${unaffected.fired} success=${unaffected.result.success} error=${unaffected.result.error}`,
  );

  // CONTROL — the asymmetry the finding names. A counting authenticator was already
  // caught before this fix, because the counter CAS re-reads the record and finds the
  // credential gone. It must still be caught.
  const user2 = "t_proof:revocation-gap2-counting";
  const key = newAuthenticator(true);
  check("control: a counting authenticator enrols", (await enrol(user2, key)).success === true);
  check("control: …and releases a step-up", (await stepUp(user2, key)).success === true);
  const keyStored = (await webauthnStore.getCredentialsForUser(user2)).find((c) => c.id === key.id);
  const counting = await withRevocationAtParse(
    keyStored?.publicKey ?? "<no stored key>",
    () => { void webauthnStore.removeCredential(user2, key.id); },
    () => stepUp(user2, key),
  );
  check(
    "control: a counting authenticator revoked mid-verification is refused (held before this fix too)",
    counting.fired === true && counting.result.success === false,
    `fired=${counting.fired} success=${counting.result.success} error=${counting.result.error}`,
  );
}

async function main() {
  await gapOneRevivalByEnrolment();
  await gapTwoReleaseAfterRevocation();
  console.log(`\n${passed}/${total} assertions passed`);
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
