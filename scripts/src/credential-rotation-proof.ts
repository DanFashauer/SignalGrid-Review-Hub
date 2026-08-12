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
} from "@workspace/integrations/credential-rotation";

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

// ── 8. DETERMINISM ──────────────────────────────────────────────────────────
check(
  "the same inputs grade identically across repeated evaluation (no clock, no randomness)",
  space.every((s) => evaluateCredentialRotation(s.n).action === s.action),
);

console.log(
  `\nfigures=inputs=${space.length},granting=${grantShapes.size},kinds=${KINDS.length},standings=${STANDINGS.length}`,
);
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
