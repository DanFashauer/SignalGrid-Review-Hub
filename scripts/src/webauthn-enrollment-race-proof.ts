// Concurrent-enrollment proof — the credential store must not lose an enrollment.
//
//   REDIS_URL=redis://127.0.0.1:6380 pnpm run proof:enrollment-race
//
// WHY THIS EXISTS. `addCredential` was a read-modify-write: getUser → push → saveUser.
// Two enrollment ceremonies for the same identity — trivial to hit across Redis-backed
// API instances, or when an operator enrols a replacement authenticator while another
// finishes the first — each read the same record, each appended their own credential,
// and each wrote the whole record back. The later SET erased the earlier credential,
// while BOTH requests answered `enrolled: true`. The loser walks away believing they
// hold a working step-up authenticator; they find out otherwise the first time they are
// asked to step up, which is precisely the moment the control is supposed to work.
//
// A concurrency fix asserted in a comment is a hypothesis. This runs the race against a
// REAL Redis and counts what survived, so the claim is measured rather than reasoned.
// It skips loudly (never silently passes) when no Redis is reachable: a race proof that
// reports success without racing anything is worse than no proof, because it launders an
// assumption into a green check.
//
// THE SECOND RACE (security roster row 82, 2026-09-12). `removeCredential` was the one
// writer on this record with NO lock and no CAS: getUser → splice → saveUser. A revocation
// racing an enrolment could write its stale snapshot last — erasing the credential that was
// just enrolled, or restoring the one that was just revoked — and in the in-memory mode the
// last-credential branch awaited the Redis client factory BETWEEN the splice and the
// `inMemoryUsers.delete`, so an enrolment landing in that window was deleted with the user.
// Both are asserted below: the in-memory interleave is swept deterministically (no Redis
// needed, so it runs before the refusal), and the Redis race is run for real.
//
// THE THIRD RACE (Codex P2 finding, 2026-09-12). The lock itself is a 5s LEASE
// (`SET NX PX`), and its release is a compare-and-delete against a per-caller token — but
// that CAS only ever protected the LOCK KEY, never the record write that happens while the
// critical section runs. If the lease expires, or the key is deleted, WHILE `body()` is
// still executing (Redis latency, an event-loop stall — nothing requires the caller itself
// to be slow), a second writer can take the lock while the first holder's write is still in
// flight, and an unfenced `SET`/`DEL` lands anyway: the exact lost update the lock exists to
// prevent, with both callers still answering success. `lockLostMidWriteRace` below deletes
// the real lock key mid-section (see its own comment for how, without any production
// injection point) and asserts the write is REFUSED, not applied — on both the enrolment
// and the revocation path.
//
// THE REVOCATION GAPS, Redis half (PR #1240 review, plan row 82). `proof:webauthn-revocation`
// reproduces both in the in-memory store; `revocationRedis` below runs the same ceremonies
// against the real Redis path: a revoked credential's id AND key are tombstoned in the
// SAME fenced script that removes it (so an enrolment ceremony minted before the
// revocation cannot bring it back, under its old id or a new one), in a key namespace no
// identity name can collide with; a lock lost mid-revocation writes neither the removal
// nor the tombstone; and a step-up re-reads its credential under the per-user lock
// before it is released. Because
// every revocation now leaves a durable tombstone, each section clears the tombstones of
// its fixed test identities before it enrols — otherwise a second run against the same
// Redis would be refused its own fixture ids by the first run's cleanup.

import { webauthn, webauthnStore, webauthnTypes } from "@workspace/webauthn";
import IORedis from "ioredis";
import { getAuditRecords } from "@workspace/audit";
import { completeEnrolment, enrol, mintEnrolment, newAuthenticator, sameKeyNewId, signAssertion, stepUp } from "./lib/webauthn-ceremony";

type WebAuthnCredential = webauthnTypes.WebAuthnCredential;

const CONCURRENCY = 12;
const USER_ID = "t_proof:race-identity";

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean, detail = "") => {
  total += 1;
  if (ok) passed += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} — ${name}${detail && !ok ? `: ${detail}` : ""}`);
};

const credential = (i: number): WebAuthnCredential => ({
  id: `cred-${i}`,
  publicKey: `pk-${i}`,
  counter: 0,
  createdAt: new Date(0).toISOString(),
});

/** Where the store keeps an identity's revocation tombstones — its own `webauthn:revoked:`
 *  namespace, which no identity's record or lock key can reach (see revocationRedis 1c). */
const tombstoneKey = (userId: string) => `webauthn:revoked:${userId}`;

/** A direct client for what the store deliberately exposes no API for: reading and
 *  clearing a test identity's tombstone set. */
async function rawRedis<T>(fn: (r: IORedis) => Promise<T>): Promise<T> {
  const r = new IORedis(process.env.REDIS_URL as string, { lazyConnect: true, maxRetriesPerRequest: 1 });
  r.on("error", () => undefined);
  try {
    await r.connect();
    return await fn(r);
  } finally {
    await r.quit().catch(() => undefined);
  }
}

/** Drop the tombstones EVERY `t_proof:` identity left in this Redis on earlier runs —
 *  including sections that seed fixed ids without calling `resetIdentity` — so a rerun
 *  against a persistent Redis is not refused its own fixture ids. Test identities only. */
async function clearProofTombstones() {
  await rawRedis(async (r) => {
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", tombstoneKey("t_proof:*"), "COUNT", 100);
      if (keys.length > 0) await r.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  });
}

/** Clean slate for a fixed test identity: remove its credentials (each removal
 *  tombstones), THEN drop the tombstones, so this run may enrol the same ids again. */
async function resetIdentity(userId: string) {
  const prior = await webauthnStore.getUser(userId).catch(() => null);
  for (const c of prior?.credentials ?? []) await webauthnStore.removeCredential(userId, c.id);
  await rawRedis((r) => r.del(tombstoneKey(userId)));
}

/**
 * THE REVOCATION GAPS against the real Redis path (see the file header). Gap 1: an
 * enrolment ceremony minted before a revocation and completed after it must not bring
 * the revoked credential back — by its id or by its key. Gap 2: a step-up whose credential is revoked after
 * `verifyAuthentication`'s early read must not be released — placed, as in the lock-lost
 * race, by patching ioredis's own `get`: the first GET of the user record after arming is
 * that early read, and the patch lets it return the pre-revocation record only after a
 * real `removeCredential` has committed. Armed AFTER the challenge is minted, because
 * minting reads the same key.
 */
async function revocationRedis() {
  const tenant = "tenant_enrollment_race_proof";

  // Gap 1.
  const user = "t_proof:revocation-redis";
  await resetIdentity(user);
  const device = newAuthenticator(false);
  const first = await enrol(user, device, tenant);
  check("redis: baseline — the authenticator enrols through a real ceremony", first.success === true && first.alreadyEnrolled === false, first.error);
  const outstanding = await mintEnrolment(user);
  check("redis: the revocation reports that it removed the credential", (await webauthnStore.removeCredential(user, device.id)) === true);
  check(
    "redis: …and tombstoned the id in the same write",
    (await rawRedis((r) => r.sismember(tombstoneKey(user), `id:${device.id}`))) === 1,
  );
  const revived = await completeEnrolment(user, outstanding, device, tenant);
  check(
    "redis: a ceremony minted BEFORE the revocation and completed AFTER it is REFUSED",
    revived.success === false,
    `success=${revived.success} alreadyEnrolled=${revived.alreadyEnrolled} error=${revived.error}`,
  );
  const afterRevival = (await webauthnStore.getCredentialsForUser(user)).map((c) => c.id);
  check("redis: …and the revoked credential id is NOT live again", !afterRevival.includes(device.id), `enrolled: [${afterRevival.join(", ")}]`);
  let storeRefusal: unknown;
  try {
    await webauthnStore.addCredential(user, { ...credential(0), id: device.id });
  } catch (err) {
    storeRefusal = err;
  }
  check(
    "redis: addCredential of a revoked id THROWS CredentialRevokedError under the lock",
    storeRefusal instanceof Error && storeRefusal.name === "CredentialRevokedError",
    String(storeRefusal),
  );

  // 1b — the revoked KEY under a fresh id (with `none` attestation nothing signs the id).
  const disguised = sameKeyNewId(device);
  const disguisedEnrol = await completeEnrolment(user, await mintEnrolment(user), disguised, tenant);
  check(
    "redis: the revoked KEY under a NEW credential id is refused",
    disguisedEnrol.success === false && !(await webauthnStore.getCredentialsForUser(user)).some((c) => c.id === disguised.id),
    `success=${disguisedEnrol.success} error=${disguisedEnrol.error}`,
  );

  // 1c — KEY NAMESPACE. identityRef is caller text and userId is `${tenant}:${identityRef}`,
  // so a tombstone stored at `webauthn:user:<userId>:revoked` was ALSO the record key of
  // the identity "<identityRef>:revoked". Enrolling that identity made the victim's
  // revocation script fail on SADD (WRONGTYPE) AFTER it had deleted the record — Lua does
  // not roll back — so the revocation threw, wrote no tombstone, and a ceremony minted
  // before it could bring the credential back. Found by adversarial review.
  const victim = "t_proof:revocation-redis-collide";
  const collider = `${victim}:revoked`;
  await resetIdentity(victim);
  await resetIdentity(collider);
  const victimDevice = newAuthenticator(false);
  await enrol(victim, victimDevice, tenant);
  await webauthnStore.addCredential(collider, credential(900));
  const victimOutstanding = await mintEnrolment(victim);
  let collideRevoke: unknown;
  try {
    collideRevoke = await webauthnStore.removeCredential(victim, victimDevice.id);
  } catch (err) {
    collideRevoke = err;
  }
  check("redis: an identity named '<victim>:revoked' cannot break the victim's revocation", collideRevoke === true, String(collideRevoke));
  const victimRevived = await completeEnrolment(victim, victimOutstanding, victimDevice, tenant);
  check("redis: …and the victim's revoked credential still cannot come back", victimRevived.success === false, `success=${victimRevived.success} error=${victimRevived.error}`);
  await resetIdentity(collider);
  await resetIdentity(victim);

  // Gap 2.
  const user2 = "t_proof:revocation-redis-release";
  await resetIdentity(user2);
  const passkey = newAuthenticator(false);
  check("redis: baseline — a zero-counter authenticator enrols", (await enrol(user2, passkey, tenant)).success === true);
  check("redis: baseline — …and releases a step-up", (await stepUp(user2, passkey, tenant)).success === true);
  const stored = (await webauthnStore.getCredentialsForUser(user2)).find((c) => c.id === passkey.id);
  check("redis: confirmCredentialEnrolled — true for the enrolled credential and its key", (await webauthnStore.confirmCredentialEnrolled(user2, passkey.id, stored?.publicKey ?? "")) === true);
  check("redis: confirmCredentialEnrolled — false for the right id under a different key", (await webauthnStore.confirmCredentialEnrolled(user2, passkey.id, "{}")) === false);

  const { challengeId, response } = await signAssertion(user2, passkey);
  const targetKey = `webauthn:user:${user2}`;
  const realGet = IORedis.prototype.get;
  let fired = false;
  let revoked: boolean | undefined;
  (IORedis.prototype as unknown as { get: typeof realGet }).get = function (
    this: IORedis,
    ...args: Parameters<typeof realGet>
  ) {
    const call = (realGet as (...a: unknown[]) => Promise<string | null>).apply(this, args);
    if (!fired && args[0] === targetKey) {
      fired = true;
      return call.then(async (value) => {
        revoked = await webauthnStore.removeCredential(user2, passkey.id); // committed for real
        return value; // …while the early read still returns the pre-revocation record
      });
    }
    return call;
  } as typeof realGet;
  let released: Awaited<ReturnType<typeof webauthn.verifyAuthentication>>;
  try {
    released = await webauthn.verifyAuthentication(user2, challengeId, response, tenant);
  } finally {
    IORedis.prototype.get = realGet;
  }
  check("redis: the revocation was placed after the early read, and committed", fired && revoked === true, `fired=${fired} revoked=${revoked}`);
  check(
    "redis: a zero-counter step-up whose credential was revoked mid-verification is NOT released",
    released.success === false,
    `success=${released.success} error=${released.error}`,
  );
  check(
    "redis: …refused BECAUSE of the revocation (step_up.failure, reason credential_revoked), not some other check",
    (await getAuditRecords(5000, 0)).some(
      (r) =>
        r.eventType === "security.webauthn.step_up.failure" &&
        r.meta?.credentialId === passkey.id &&
        r.meta?.reason === "credential_revoked" &&
        r.tenantId === tenant,
    ),
  );
  check(
    "redis: confirmCredentialEnrolled — false once the credential is revoked",
    (await webauthnStore.confirmCredentialEnrolled(user2, passkey.id, stored?.publicKey ?? "")) === false,
  );

  await resetIdentity(user);
  await resetIdentity(user2);
}

/** The in-memory store must not lose an enrolment that lands while a revocation is in
 *  flight. Deterministic: the enrolment is started after a fixed number of microtask
 *  turns (and once each behind nextTick / setImmediate / setTimeout), so every position
 *  a real request could take relative to the revocation's own awaits is exercised. On the
 *  unfixed store the last-credential branch had an await between the splice and the
 *  user delete; depths 50 and 400 (Node 22) landed inside it and the user — with the new
 *  credential — was deleted. The fix leaves no await between the read and the write, so
 *  no depth can land inside a window that does not exist. */
async function inMemoryRevocationSweep() {
  const savedUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL; // the store chooses its backend by configuration, per call
  try {
    const delays: Array<[string, () => Promise<void>]> = [];
    for (let n = 0; n <= 512; n += 1) {
      delays.push([`microtask×${n}`, async () => { for (let k = 0; k < n; k += 1) await Promise.resolve(); }]);
    }
    delays.push(["nextTick", () => new Promise((r) => process.nextTick(r))]);
    delays.push(["setImmediate", () => new Promise((r) => setImmediate(r))]);
    delays.push(["setTimeout(0)", () => new Promise((r) => setTimeout(r, 0))]);
    const lost: string[] = [];
    let i = 0;
    for (const [name, wait] of delays) {
      const user = `t_proof:revoke-sweep-${i++}`;
      await webauthnStore.addCredential(user, credential(0)); // the only credential — its removal deletes the user
      const revoke = webauthnStore.removeCredential(user, "cred-0");
      const enrol = (async () => { await wait(); return webauthnStore.addCredential(user, credential(1)); })();
      const [revoked, enrolled] = await Promise.all([revoke, enrol]);
      const after = await webauthnStore.getUser(user);
      const ids = (after?.credentials ?? []).map((c) => c.id);
      if (!(revoked && enrolled.stored && ids.includes("cred-1") && !ids.includes("cred-0"))) {
        lost.push(`${name} → revoked=${revoked} enrolled=${enrolled.stored} after=[${ids.join(", ")}]`);
      }
      for (const c of after?.credentials ?? []) await webauthnStore.removeCredential(user, c.id);
    }
    check(
      `in-memory: a revocation of the last credential never deletes an enrolment that lands mid-flight (${delays.length} interleavings swept)`,
      lost.length === 0,
      lost.slice(0, 4).join("; ") + (lost.length > 4 ? `; … ${lost.length} lost` : ""),
    );
    // Sanity of the sweep itself: an unknown credential and an unknown user both read as
    // "nothing removed" — never as a removal that did not happen.
    check("in-memory: removing an unknown credential reports false (nothing removed)", (await webauthnStore.removeCredential("t_proof:nobody", "cred-x")) === false);
  } finally {
    if (savedUrl !== undefined) process.env.REDIS_URL = savedUrl;
  }
}

/** Minimal shape this test needs from an ioredis client instance — enough to invoke the
 *  real `get`/`del` without fighting the library's generated command-overload types. */
interface MinimalRedisClient {
  del(key: string): Promise<number>;
}

/**
 * THE THIRD RACE, run for real (Codex P2 finding, 2026-09-12). See the file header for
 * the defect. This asserts the FIX: a lock that vanishes mid-section makes the write
 * throw rather than land.
 *
 * HOW THE LOSS IS SIMULATED. No production injection point was added, and none exists —
 * the critical section's very first Redis call, in both `addCredential` and
 * `removeCredential`, is a real `GET` of the user record, made on the SAME already-
 * connected client that is holding the lock. So this monkeypatches ioredis's OWN `get`
 * (a generic third-party dependency method, the same narrow-external-stub shape as
 * `webhooks-proof.ts`'s `globalThis.fetch` / `Date.prototype.toISOString`): on the one
 * call whose key matches this test's user record, it lets the real read finish and then,
 * using that SAME client instance, issues a real `DEL` of the real lock key — genuinely
 * deleting the lock the holder believes it still owns, mid-section, not merely asserting
 * that it would happen. The patch fires once, then restores the original method in a
 * `finally`. This exercises whatever write mechanism the store actually uses (a plain
 * `SET`/`DEL` on the unfixed store, the fenced Lua write on the fixed one) rather than
 * assuming which one is live — so the SAME test fails on the unfixed store (the write
 * lands anyway) and passes on the fixed one (the write is refused).
 */
async function lockLostMidWriteRace() {
  const userId = "t_proof:lock-lost";
  const targetKey = `webauthn:user:${userId}`;
  const lockKey = `${targetKey}:lock`;
  const realGet = IORedis.prototype.get;

  /** Patch `get` to fire the lock deletion on the NEXT call matching `targetKey`, once. */
  function armLockDeletion(): () => void {
    let fired = false;
    (IORedis.prototype as unknown as { get: typeof realGet }).get = function (
      this: MinimalRedisClient,
      ...args: Parameters<typeof realGet>
    ) {
      const call = (realGet as (...a: unknown[]) => Promise<string | null>).apply(this, args);
      if (!fired && args[0] === targetKey) {
        fired = true;
        return call.then(async (value) => {
          await this.del(lockKey); // the REAL lock key, deleted for real, mid-section
          return value;
        });
      }
      return call;
    } as typeof realGet;
    return () => {
      IORedis.prototype.get = realGet;
    };
  }

  await resetIdentity(userId);

  // 3a — addCredential: the lock disappears between the read and the write.
  let disarm = armLockDeletion();
  let addThrew: unknown;
  try {
    await webauthnStore.addCredential(userId, credential(500));
  } catch (err) {
    addThrew = err;
  } finally {
    disarm();
  }
  check(
    'addCredential: a lock deleted mid-section is REFUSED, not silently applied (throws "lock lost")',
    addThrew instanceof Error && /lock lost/i.test(addThrew.message),
    String(addThrew),
  );
  const afterAdd = await webauthnStore.getUser(userId);
  check(
    "…and the credential was never actually stored",
    !(afterAdd?.credentials ?? []).some((c) => c.id === "cred-500"),
    `credentials: [${(afterAdd?.credentials ?? []).map((c) => c.id).join(", ")}]`,
  );

  // Seed EXACTLY one real credential — lock intact — for 3b to revoke. Cleaned first and
  // independently of 3a's outcome: on the unfixed store 3a's write lands despite the
  // refusal it should have hit, and an uncleaned cred-500 left sitting alongside cred-501
  // would route 3b through the OTHER write branch (the fenced revoke writing a non-empty
  // record) instead of the one it targets (the fenced revoke deleting it) — a correct 3a
  // must not change which branch 3b exercises.
  await resetIdentity(userId);
  await webauthnStore.addCredential(userId, credential(501));

  // 3b — removeCredential, last-credential branch (the fenced DELETE path): same fault
  // injected, same refusal expected.
  disarm = armLockDeletion();
  let removeThrew: unknown;
  try {
    await webauthnStore.removeCredential(userId, "cred-501");
  } catch (err) {
    removeThrew = err;
  } finally {
    disarm();
  }
  check(
    'removeCredential: a lock deleted mid-section is REFUSED, not silently applied (throws "lock lost")',
    removeThrew instanceof Error && /lock lost/i.test(removeThrew.message),
    String(removeThrew),
  );
  const afterRemove = await webauthnStore.getUser(userId);
  check(
    "…and the credential was never actually removed",
    (afterRemove?.credentials ?? []).some((c) => c.id === "cred-501"),
    `credentials: [${(afterRemove?.credentials ?? []).map((c) => c.id).join(", ")}]`,
  );
  check(
    "…and no tombstone was written either (removal and tombstone are one fenced script)",
    (await rawRedis((r) => r.scard(tombstoneKey(userId)))) === 0,
  );

  // Cleanup, regardless of which branch actually persisted.
  const cleanup = await webauthnStore.getUser(userId).catch(() => null);
  for (const c of cleanup?.credentials ?? []) await webauthnStore.removeCredential(userId, c.id);
}

async function main() {
  console.log("Revocation/enrolment interleave (in-memory store)\n");
  await inMemoryRevocationSweep();
  console.log("");

  if (!process.env.REDIS_URL) {
    console.error(
      "proof:enrollment-race REFUSED — no REDIS_URL set.\n" +
        "This proof exists to race a real shared store; without one there is no race to\n" +
        "run and nothing it could honestly report. Start one and re-run:\n" +
        "  docker run -d --name signalgrid-race-redis -p 6380:6379 redis:7\n" +
        "  REDIS_URL=redis://127.0.0.1:6380 pnpm run proof:enrollment-race\n",
    );
    process.exit(1);
  }

  console.log("Concurrent-enrollment proof — every enrolled credential must survive\n");
  await clearProofTombstones();

  // Clean slate: remove anything a previous run left behind, tombstones included.
  await resetIdentity(USER_ID);

  // THE RACE. All appends are issued before any of them is awaited, so they interleave
  // at the store rather than running in sequence.
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) => webauthnStore.addCredential(USER_ID, credential(i))),
  );
  const rejected = results.filter((r) => r.status === "rejected");

  check(
    `all ${CONCURRENCY} concurrent enrollments reported success`,
    rejected.length === 0,
    rejected.length > 0 ? String((rejected[0] as PromiseRejectedResult).reason) : "",
  );

  const after = await webauthnStore.getUser(USER_ID);
  const ids = new Set((after?.credentials ?? []).map((c) => c.id));

  // The defect this proof exists for: a lost update leaves FEWER credentials than were
  // enrolled, with every request having answered success.
  check(
    `all ${CONCURRENCY} credentials survived the race (no lost update)`,
    ids.size === CONCURRENCY,
    `stored ${ids.size} of ${CONCURRENCY}`,
  );

  // Name the missing ones rather than only the count — a bare number does not tell a
  // reader whether the loss was the first writer or the last.
  const missing = Array.from({ length: CONCURRENCY }, (_, i) => `cred-${i}`).filter((id) => !ids.has(id));
  check("no specific credential is missing", missing.length === 0, `missing: ${missing.join(", ")}`);

  // Re-entrancy: enrolling an already-stored credential must not duplicate it.
  await webauthnStore.addCredential(USER_ID, credential(0));
  const afterDup = await webauthnStore.getUser(USER_ID);
  check(
    "re-enrolling an already-stored credential does not duplicate it",
    (afterDup?.credentials ?? []).filter((c) => c.id === "cred-0").length === 1,
  );

  // THE REVOCATION RACE. One credential is revoked while CONCURRENCY new ones enrol against
  // the same record. Under the lock the revocation reads the record only while it holds it,
  // so it can neither erase an enrolment that committed before it nor be undone by one that
  // commits after it. Unlocked, its stale snapshot could land last and do either.
  const revoked = credential(99);
  await webauthnStore.addCredential(USER_ID, revoked);
  const raced = await Promise.allSettled([
    webauthnStore.removeCredential(USER_ID, revoked.id),
    ...Array.from({ length: CONCURRENCY }, (_, i) => webauthnStore.addCredential(USER_ID, credential(100 + i))),
  ]);
  const racedRejected = raced.filter((r) => r.status === "rejected");
  check(
    `revocation racing ${CONCURRENCY} enrolments: every call reported success`,
    racedRejected.length === 0,
    racedRejected.length > 0 ? String((racedRejected[0] as PromiseRejectedResult).reason) : "",
  );
  const removed = raced[0].status === "fulfilled" && raced[0].value === true;
  check("the revocation reported that it removed the credential", removed);
  const afterRace = await webauthnStore.getUser(USER_ID);
  const afterIds = new Set((afterRace?.credentials ?? []).map((c) => c.id));
  check("the revoked credential is GONE after the race (a stale write did not restore it)", !afterIds.has(revoked.id));
  const raceMissing = Array.from({ length: CONCURRENCY }, (_, i) => `cred-${100 + i}`).filter((id) => !afterIds.has(id));
  check(
    `all ${CONCURRENCY} enrolments that raced the revocation survived it (the revocation's snapshot did not erase them)`,
    raceMissing.length === 0,
    `missing: ${raceMissing.join(", ")}`,
  );
  const stillThere = Array.from({ length: CONCURRENCY }, (_, i) => `cred-${i}`).filter((id) => !afterIds.has(id));
  check("the earlier enrolments were untouched by the revocation", stillThere.length === 0, `missing: ${stillThere.join(", ")}`);

  for (const c of afterRace?.credentials ?? []) await webauthnStore.removeCredential(USER_ID, c.id);

  console.log("");
  console.log("Lock-lease fence — a lock deleted mid-section must refuse the write, not apply it\n");
  await lockLostMidWriteRace();

  console.log("");
  console.log("Revocation — a revoked credential stays revoked, and is re-read before release\n");
  await revocationRedis();

  // Deliberately NOT a `figures=` line. That marker registers a proof with the figure
  // guard, which re-runs it during the standard sweep — and this proof refuses to run
  // without a real Redis, so registering it would turn a green sweep red on every
  // machine without one. Same convention as the Postgres-gated `*-pg` proofs: infra
  // proofs report their counts inline and stay out of the figure registry.
  console.log(`\nconcurrency=${CONCURRENCY} survived=${ids.size}`);
  console.log(`\n${passed}/${total} assertions passed`);
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
