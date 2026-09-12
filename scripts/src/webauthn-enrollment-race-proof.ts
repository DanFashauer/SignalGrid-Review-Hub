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

import { webauthnStore, webauthnTypes } from "@workspace/webauthn";

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

  // Clean slate: remove anything a previous run left behind.
  const prior = await webauthnStore.getUser(USER_ID).catch(() => null);
  for (const c of prior?.credentials ?? []) await webauthnStore.removeCredential(USER_ID, c.id);

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
