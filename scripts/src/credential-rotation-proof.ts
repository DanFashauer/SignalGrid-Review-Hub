// Credential-rotation proof — OFFLINE and deterministic.
//
// The dimension this guards answers a question no neighbouring family can:
// is the secret this actor is presenting still inside its own rotation policy,
// and does anyone actually know? `credential-exposure` sees leaks,
// `token-binding` sees replayability, `bootstrap-credential` sees temporary
// passes. A four-hundred-day-old service secret that has never leaked is
// invisible to all three.
//
// Asserted, in order of how much each matters:
//   1. THE SHORT-LIVED EXEMPTION IS UNREACHABLE BY ANYTHING BUT THE TRUSTED
//      VALUE. It is the one clause that ends evaluation with a clean verdict, so
//      it is the one an unknown spelling must never satisfy.
//   2. THE GRANTING SET IS PINNED BY EQUALITY over the whole input space, not by
//      negatives — `!== bad` would let a value nobody enumerated through.
//   3. NO CLOCK IN THE DECISION PATH. The reference instant is supplied; the
//      same inputs grade the same way forever.
//   4. THE NORMALIZER IS ASYMMETRIC. never_rotated, no_policy and unknown are
//      three different facts and must not collapse into one another.
//   5. MONOTONICITY: degrading any axis never improves the verdict.

import {
  evaluateCredentialRotation,
  normalizeCredentialRotation,
  type CredentialCustody,
  type CredentialKind,
  type CredentialRotationAction,
  type NormalizedCredentialRotation,
  type RotationStanding,
  resolveCredentialRotationConnector,
  makeDefaultCredentialRotationTransport,
  CredentialRotationConnectorError,
} from "@workspace/integrations/credential-rotation";

import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

console.log("Credential-rotation proof — is the secret still inside its own policy?\n");

const KINDS: CredentialKind[] = ["short_lived", "static_secret", "certificate", "unknown"];
const CUSTODY: CredentialCustody[] = ["managed_vault", "distributed_copy", "unknown"];
const STANDINGS: RotationStanding[] = [
  "within_policy", "overdue", "never_rotated", "no_policy", "unknown",
];

const norm = (
  kind: CredentialKind,
  custody: CredentialCustody,
  standing: RotationStanding,
  covered = true,
): NormalizedCredentialRotation => ({
  subjectRef: "svc.test", kind, custody, standing, covered,
  ageDays: null, maxAgeDays: null, source: "proof", observedAt: "2026-01-01T00:00:00.000Z",
});

// ── 1. THE FULL INPUT SPACE, SWEPT ──────────────────────────────────────────
const RANK: Record<CredentialRotationAction, number> = {
  none: 0, monitor: 1, alert: 2, step_up: 3, restrict: 4,
};
const space: { n: NormalizedCredentialRotation; action: CredentialRotationAction; confirmed: boolean }[] = [];
for (const kind of KINDS) {
  for (const custody of CUSTODY) {
    for (const standing of STANDINGS) {
      for (const covered of [true, false]) {
        const n = norm(kind, custody, standing, covered);
        const v = evaluateCredentialRotation(n);
        space.push({ n, action: v.action, confirmed: v.rotationConfirmed });
      }
    }
  }
}
check(
  `the whole input space is enumerated (${space.length} = 4 kinds x 3 custody x 5 standings x covered/not)`,
  space.length === KINDS.length * CUSTODY.length * STANDINGS.length * 2 && space.length === 120,
);

// ── 2. THE GRANTING SET, PINNED BY EQUALITY ─────────────────────────────────
//
// `action === "none"` is the only outcome that adds nothing to a decision. Every
// member is enumerated by SHAPE, so a new enum value cannot join the set by
// accident — the failure mode a `!== bad` test would have.
const granting = space.filter((s) => s.action === "none");
const grantShapes = new Set(granting.map((s) => `${s.n.kind}|${s.n.custody}|${s.n.standing}|${s.n.covered}`));
const EXPECTED_GRANTS = new Set([
  // Short-lived and correctly classified: rotation is not the question. Custody
  // and standing are irrelevant BECAUSE the credential does not outlive a session.
  ...CUSTODY.flatMap((c) => STANDINGS.map((s) => `short_lived|${c}|${s}|true`)),
  // Static or certificate: clean ONLY when current AND still in the vault.
  "static_secret|managed_vault|within_policy|true",
  "certificate|managed_vault|within_policy|true",
]);
check(
  `exactly ${EXPECTED_GRANTS.size} input shapes contribute nothing, pinned by equality`,
  grantShapes.size === EXPECTED_GRANTS.size && [...grantShapes].every((s) => EXPECTED_GRANTS.has(s)),
);
check(
  "…and `rotationConfirmed` is true on exactly those shapes and no others",
  space.every((s) => s.confirmed === (s.action === "none")),
);

// ── 3. THE EXEMPTION IS UNREACHABLE BY AN UNKNOWN KIND ──────────────────────
check(
  "an UNKNOWN kind never inherits the short-lived exemption, on any custody/standing",
  space
    .filter((s) => s.n.kind === "unknown" && s.n.covered)
    .every((s) => s.action === "step_up"),
);
check(
  "NON-VACUITY: the exemption IS reachable by the trusted value, so the check above is not trivially true",
  space.some((s) => s.n.kind === "short_lived" && s.n.covered && s.action === "none"),
);

// ── 4. NOT COVERED IS NEVER A PASS ──────────────────────────────────────────
check(
  "an uncovered subject always steps up — no record is a hole, not a grant",
  space.filter((s) => !s.n.covered).every((s) => s.action === "step_up" && !s.confirmed),
);

// ── 5. MONOTONICITY: degrading custody never improves the verdict ───────────
let regressions = 0;
for (const kind of ["static_secret", "certificate"] as CredentialKind[]) {
  for (const standing of STANDINGS) {
    const vault = RANK[evaluateCredentialRotation(norm(kind, "managed_vault", standing)).action];
    const copied = RANK[evaluateCredentialRotation(norm(kind, "distributed_copy", standing)).action];
    if (copied < vault) regressions += 1;
  }
}
check(
  `copying a secret out of the vault never IMPROVES the verdict (${regressions} regressions)`,
  regressions === 0,
);

// ── 6. THE WORST CASE IS THE WORST CASE ─────────────────────────────────────
const worst = evaluateCredentialRotation(norm("static_secret", "distributed_copy", "never_rotated"));
check(
  "never rotated + copied out of the vault is the ceiling: restrict",
  worst.action === "restrict" &&
    worst.reasonCodes.includes("CREDENTIAL_NEVER_ROTATED") &&
    worst.reasonCodes.includes("CREDENTIAL_COPIED_OUT_OF_VAULT"),
);
check(
  "the dimension NEVER denies — an overdue key is a hygiene fact, not grounds to end a session",
  space.every((s) => (s.action as string) !== "deny"),
);

// ── 7. THE NORMALIZER IS ASYMMETRIC ─────────────────────────────────────────
//
// never_rotated, no_policy and unknown are three DIFFERENT facts. Collapsing any
// pair would let a governance failure hide inside "we're not sure".
const REF = "2026-01-01T00:00:00.000Z";
const nrot = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", createdAt: "2024-01-01T00:00:00.000Z", maxAgeDays: 90 }, REF);
check("a policy exists and nothing was ever rotated → never_rotated", nrot.standing === "never_rotated");

const npol = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2025-12-01T00:00:00.000Z" }, REF);
check("no maxAgeDays at all → no_policy, NOT within_policy", npol.standing === "no_policy");

const nunk = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", maxAgeDays: 90 }, REF);
check("a policy, but no createdAt and no lastRotatedAt → unknown, not never_rotated", nunk.standing === "unknown");

const over = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2025-01-01T00:00:00.000Z", maxAgeDays: 90 }, REF);
check("365 days against a 90-day policy → overdue, with the age reported", over.standing === "overdue" && over.ageDays === 365);

const within = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2025-12-20T00:00:00.000Z", maxAgeDays: 90 }, REF);
check("12 days against a 90-day policy → within_policy", within.standing === "within_policy" && within.ageDays === 12);

// A rotation dated in the FUTURE is an unreadable clock, not a fresh credential.
//
// Without a guard the negative age was trivially <= maxAgeDays, so the record
// graded "within_policy" and the verdict was rotation_current / none with
// rotationConfirmed: true — a permanent clean bill for a static secret that may
// never have been rotated, reachable from clock skew, a bad timezone conversion on
// a bridge, or anyone able to write the field. The evidence even carried the
// negative age as if it were a reading.
//
// "unknown", NOT "overdue": a lapse nobody established must not be asserted either.
// This is the shape local-authority/normalize.ts already uses for a future grant.
const future = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2036-01-01T00:00:00.000Z", maxAgeDays: 90 }, REF);
check(
  "a rotation dated in the FUTURE → unknown, never within_policy",
  future.standing === "unknown",
);
check(
  "...and reports NO age rather than a negative one",
  future.ageDays === null,
);
check(
  "...so the verdict does not grant, and does not claim rotation was confirmed",
  (() => {
    const v = evaluateCredentialRotation(future);
    return v.action !== "none" && v.rotationConfirmed === false;
  })(),
);
const futureNoPolicy = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2036-01-01T00:00:00.000Z" }, REF);
check(
  "the no_policy branch reports no age for a future basis either",
  futureNoPolicy.ageDays === null,
);

check("a null record is UNCOVERED, not clean", normalizeCredentialRotation(null, REF).covered === false);
check(
  "an unlisted kind spelling normalizes to unknown, never to short_lived",
  normalizeCredentialRotation({ kind: "ephemeral", custody: "vaulted" }, REF).kind === "unknown" &&
    normalizeCredentialRotation({ kind: "ephemeral", custody: "vaulted" }, REF).custody === "unknown",
);
check(
  "an unreadable reference instant makes standing unknown — no arithmetic on a bad clock",
  normalizeCredentialRotation(
    { kind: "static_secret", lastRotatedAt: "2025-01-01T00:00:00.000Z", maxAgeDays: 90 }, "not-a-date",
  ).standing === "unknown",
);

// ── 7b. THE THREE BRANCHES THE MUTATION SWEEP FOUND UNFALSIFIABLE ───────────
//
// Added 2026-08-25 after the daily sweep reported them as survivors for two
// consecutive days, which drove `check-ci-liveness.mjs` past its 48h threshold
// and turned every pull request in the repository red. All three are the same
// omission: the assertions above pin `standing` and never look at `ageDays`, so
// the code that computes the age could be deleted without a single check
// noticing.
//
// The assertion directly above this block is a fourth instance and is subtler.
// It feeds an unreadable reference AND a policy AND a lastRotatedAt, so when the
// `now === null` arm is removed the record falls through to the final `else`,
// where the negative-age guard added for row 126 catches it and ALSO returns
// "unknown". Two guards, one verdict, so disabling either leaves the assertion
// green. The case below removes the second guard's reach by posing no policy at
// all: without the `now === null` arm the record grades `no_policy`, which is a
// different answer, so the arm becomes the only thing that can produce the
// expected one.
const unreadableNoPolicy = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2025-12-20T00:00:00.000Z" },
  "not-a-date",
);
check(
  "an unreadable reference beats a missing policy — unknown, not no_policy (isolates the `now === null` arm)",
  unreadableNoPolicy.standing === "unknown" && unreadableNoPolicy.ageDays === null,
);

// no_policy still REPORTS an age. The standing says nothing was posed; the age
// says how long it has been anyway, and an operator needs both. Deleting the
// computation leaves standing correct and the number silently absent.
const noPolicyAged = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", lastRotatedAt: "2025-12-20T00:00:00.000Z" }, REF);
check(
  "no policy posed, but the age is still measured and reported",
  noPolicyAged.standing === "no_policy" && noPolicyAged.ageDays === 12,
);

// ...and it falls back to createdAt when nothing was ever rotated, which is a
// second, independent route into the same branch.
const noPolicyFromCreated = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", createdAt: "2025-12-20T00:00:00.000Z" }, REF);
check(
  "no policy and never rotated → the age is measured from createdAt",
  noPolicyFromCreated.standing === "no_policy" && noPolicyFromCreated.ageDays === 12,
);

// never_rotated likewise reports how long the credential has existed unrotated.
// This is the number that makes the standing actionable — "never rotated" for
// nine days and "never rotated" for two years are not the same finding.
const neverRotatedAged = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", createdAt: "2024-01-01T00:00:00.000Z", maxAgeDays: 90 }, REF);
check(
  "never rotated against a live policy → the age since creation is reported",
  neverRotatedAged.standing === "never_rotated" && neverRotatedAged.ageDays === 731,
);

// The negative-age guard from row 126 on the never_rotated path. The no_policy
// twin is already pinned above; this route into the same guard was not.
const futureCreated = normalizeCredentialRotation(
  { kind: "static_secret", custody: "managed_vault", createdAt: "2027-01-01T00:00:00.000Z", maxAgeDays: 90 }, REF);
check(
  "a future-dated createdAt reports NO age, never a negative one",
  futureCreated.standing === "never_rotated" && futureCreated.ageDays === null,
);

// ── 8. DETERMINISM ──────────────────────────────────────────────────────────
check(
  "the same inputs grade identically across repeated evaluation (no clock, no randomness)",
  space.every((s) => evaluateCredentialRotation(s.n).action === s.action),
);

console.log(
  `\nfigures=inputs=${space.length},granting=${grantShapes.size},kinds=${KINDS.length},standings=${STANDINGS.length}`,
);

// LIVE GATE and DEFAULT TRANSPORT — five branches here survived mutation until
// 2026-08-25: the tier test, the live-integrations flag, the missing-token refusal,
// the non-OK response, and the "a JSON body must be a record" check. Each is a place
// where a MISCONFIGURED or FAILING call could be mistaken for a real reading.
// The `full` env deliberately omits the BASE_URL key: it has a default, so it is not
// a gate, and asserting that removing it blocks the live call would assert something
// false.
checkLiveGateIsolated({
  check,
  family: "credential-rotation",
  resolve: (env) => resolveCredentialRotationConnector(env),
  full: { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CREDENTIAL_ROTATION_TOKEN: "t" },
});
await checkDefaultTransport({
  check,
  family: "credential-rotation",
  transport: makeDefaultCredentialRotationTransport("https://vendor.invalid/credential-rotation") as (a: never) => Promise<unknown>,
  arg: { subjectRef: "ref-1", token: "t" },
  codeOf: (err) => (err instanceof CredentialRotationConnectorError ? err.code : undefined),
});


console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
