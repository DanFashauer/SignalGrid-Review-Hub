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

async function main() {
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

  for (const c of after?.credentials ?? []) await webauthnStore.removeCredential(USER_ID, c.id);

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
