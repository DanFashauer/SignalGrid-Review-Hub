// Local-authority proof — OFFLINE and deterministic.
//
// The dimension this guards answers a question no neighbouring family can: may
// this device act on its own authority right now, and did it ever establish that
// authority since it last booted? `signalgrid-core/continuity.ts` reconciles
// offline decisions AFTER they exist; nothing gated whether the device was fit
// to mint one. `custody-beacon` knows where the device is, `carrier` and
// `link-usability` know whether it can talk, `device-management-health` knows
// whether the management plane can reach it — and none of them can see a device
// that is powered, radio-enabled and unable to read its own credential.
//
// Asserted, in order of how much each matters:
//   1. AN UNTRUSTED CLOCK CANNOT ESTABLISH A LIVE GRANT. A device-asserted clock
//      is settable by whoever holds the device, so rolling the date back must
//      never renew authority. This is the clause an attacker attacks.
//   2. BEFORE FIRST UNLOCK IS ITS OWN STATE and it restricts. Every other
//      surface looks healthy while the vault is unreadable.
//   3. THE GRANTING SET IS PINNED BY EQUALITY over the whole input space, not by
//      negatives — `!== bad` would let a value nobody enumerated through.
//   4. NO CLOCK IN THE DECISION PATH. The reference instant is supplied.
//   5. THE NORMALIZER IS ASYMMETRIC. never_issued, no_grant_policy and unknown
//      are three different facts and must not collapse.

import {
  evaluateLocalAuthority,
  normalizeLocalAuthority,
  type ClockConfidence,
  type GrantStanding,
  type LocalAuthState,
  type LocalAuthorityAction,
  type NormalizedLocalAuthority,
  type ProtectedDataState,
  resolveLocalAuthorityConnector,
  makeDefaultLocalAuthorityTransport,
  LocalAuthorityConnectorError,
} from "@workspace/integrations/local-authority";

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

console.log("Local-authority proof — may this device act on its own authority right now?\n");

const PROTECTED: ProtectedDataState[] = [
  "available", "awaiting_first_unlock", "unavailable", "unknown",
];
const LOCAL_AUTH: LocalAuthState[] = ["verified", "not_verified", "unknown"];
const STANDING: GrantStanding[] = [
  "within_grant", "expired", "never_issued", "no_grant_policy", "unknown",
];
const CLOCK: ClockConfidence[] = ["trusted", "device_asserted", "unknown"];

const norm = (
  protectedData: ProtectedDataState,
  localAuth: LocalAuthState,
  standing: GrantStanding,
  clockConfidence: ClockConfidence,
  covered = true,
): NormalizedLocalAuthority => ({
  deviceRef: "dev.test",
  protectedData, localAuth, standing, clockConfidence, covered,
  grantAgeSeconds: null, maxDisconnectedSeconds: null,
  source: "proof", observedAt: "2026-01-01T00:00:00.000Z",
});

// ── 1. THE FULL INPUT SPACE, SWEPT ──────────────────────────────────────────
const RANK: Record<LocalAuthorityAction, number> = {
  none: 0, monitor: 1, alert: 2, step_up: 3, restrict: 4,
};
const space: {
  n: NormalizedLocalAuthority;
  action: LocalAuthorityAction;
  mayAct: boolean;
}[] = [];
for (const p of PROTECTED) {
  for (const a of LOCAL_AUTH) {
    for (const s of STANDING) {
      for (const c of CLOCK) {
        for (const covered of [true, false]) {
          const n = norm(p, a, s, c, covered);
          const v = evaluateLocalAuthority(n);
          space.push({ n, action: v.action, mayAct: v.mayActLocally });
        }
      }
    }
  }
}
check(
  `the whole input space is enumerated (${space.length} = 4 protected x 3 localAuth x 5 standing x 3 clock x covered/not)`,
  space.length === PROTECTED.length * LOCAL_AUTH.length * STANDING.length * CLOCK.length * 2 &&
    space.length === 360,
);

// ── 2. THE GRANTING SET, PINNED BY EQUALITY ─────────────────────────────────
const key = (s: (typeof space)[number]): string =>
  `${s.n.protectedData}|${s.n.localAuth}|${s.n.standing}|${s.n.clockConfidence}|${s.n.covered}`;
const grantShapes = new Set(space.filter((s) => s.action === "none").map(key));
const EXPECTED_GRANTS = new Set([
  // The ONLY state in which a device may act alone: vault readable, a human
  // authenticated since boot, an unexpired grant, on time it did not choose.
  "available|verified|within_grant|trusted|true",
]);
check(
  `exactly ${EXPECTED_GRANTS.size} input shape lets the device act on its own authority, pinned by equality`,
  grantShapes.size === EXPECTED_GRANTS.size && [...grantShapes].every((s) => EXPECTED_GRANTS.has(s)),
);
check(
  "…and `mayActLocally` is true on exactly that shape and no other",
  space.every((s) => s.mayAct === (s.action === "none")),
);

// ── 3. THE CLOCK IS THE ATTACK SURFACE ──────────────────────────────────────
//
// Rolling the date back on a device you are holding must never renew authority.
check(
  "a device-asserted clock NEVER lets the device act locally, on any other axis combination",
  space.filter((s) => s.n.clockConfidence === "device_asserted").every((s) => !s.mayAct),
);
check(
  "an unrecognised clock grade is treated exactly as device-asserted — never as trusted",
  space
    .filter((s) => s.n.clockConfidence === "unknown")
    .every((s) => !s.mayAct),
);
check(
  "NON-VACUITY: the SAME shape on trusted time IS clean, so the two checks above are not trivially true",
  evaluateLocalAuthority(norm("available", "verified", "within_grant", "trusted")).action === "none" &&
    evaluateLocalAuthority(norm("available", "verified", "within_grant", "device_asserted")).action === "step_up",
);

// ── 4. BEFORE FIRST UNLOCK RESTRICTS, AND IS ITS OWN STATE ──────────────────
check(
  "awaiting-first-unlock always restricts, whatever the other axes say",
  space
    .filter((s) => s.n.covered && s.n.protectedData === "awaiting_first_unlock")
    .every((s) => s.action === "restrict" && !s.mayAct),
);
check(
  "…and it is DISTINCT from `unavailable`: both restrict, but they carry different reason codes",
  evaluateLocalAuthority(norm("awaiting_first_unlock", "verified", "within_grant", "trusted"))
    .reasonCodes.includes("AWAITING_FIRST_UNLOCK") &&
    evaluateLocalAuthority(norm("unavailable", "verified", "within_grant", "trusted"))
      .reasonCodes.includes("PROTECTED_DATA_UNAVAILABLE"),
);

// ── 5. NOT COVERED IS NEVER A PASS ──────────────────────────────────────────
check(
  "an uncovered device always steps up — no record is a hole, not a grant",
  space.filter((s) => !s.n.covered).every((s) => s.action === "step_up" && !s.mayAct),
);

// ── 6. AUTHORITY DECAYS ─────────────────────────────────────────────────────
check(
  "an expired grant restricts — capability decays as the disconnected interval grows",
  evaluateLocalAuthority(norm("available", "verified", "expired", "trusted")).action === "restrict",
);
check(
  "the dimension NEVER denies — a device that cannot act alone is narrowed to recovery, not cut off",
  space.every((s) => (s.action as string) !== "deny"),
);

// ── 7. THE NORMALIZER IS ASYMMETRIC ─────────────────────────────────────────
const REF = "2026-01-01T12:00:00.000Z";
const base = {
  deviceRef: "dev.test",
  protectedDataState: "available",
  localAuthState: "verified",
  clockConfidence: "trusted",
} as const;

check(
  "a null record is UNCOVERED, not clean",
  normalizeLocalAuthority(null, REF).covered === false,
);
check(
  "a policy exists and no grant was ever minted → never_issued, NOT unknown",
  normalizeLocalAuthority({ ...base, maxDisconnectedSeconds: 3600 }, REF).standing === "never_issued",
);
check(
  "no policy at all → no_grant_policy, NOT within_grant",
  normalizeLocalAuthority({ ...base, grantIssuedAt: "2026-01-01T11:00:00.000Z" }, REF).standing ===
    "no_grant_policy",
);
// NEITHER a policy NOR a grant → `no_grant_policy`, NOT `never_issued`.
//
// This pair is what separates the two branches. `never_issued` says a policy
// exists and no grant was ever minted against it — a device that was supposed to
// have local authority and does not. `no_grant_policy` says nobody ever decided
// how long this device may act alone. Reporting the first when the truth is the
// second invents a policy that was never written.
//
// Added because a mutation SURVIVED here: the earlier no-policy check passed
// either way, since the inner `maxDisconnectedSeconds === null` fallback reaches
// the same answer whenever a grant instant IS present.
check(
  "neither a policy nor a grant → no_grant_policy, NOT never_issued",
  normalizeLocalAuthority({ ...base }, REF).standing === "no_grant_policy",
);
check(
  "an unreadable reference instant → unknown; no arithmetic on a bad clock",
  normalizeLocalAuthority(
    { ...base, grantIssuedAt: "2026-01-01T11:00:00.000Z", maxDisconnectedSeconds: 3600 },
    "not-a-date",
  ).standing === "unknown",
);
// THE CLOCK GATE, at the normalizer: a device-asserted clock must not produce a
// standing at all, in EITHER direction.
const deviceClock = normalizeLocalAuthority(
  {
    ...base,
    clockConfidence: "device_asserted",
    grantIssuedAt: "2026-01-01T11:00:00.000Z",
    maxDisconnectedSeconds: 3600,
  },
  REF,
);
check(
  "a device-asserted clock yields standing `unknown` — never within_grant, and never `expired` either",
  deviceClock.standing === "unknown" && deviceClock.grantAgeSeconds === null,
);
// The future-issuance trap: the newest value a naive age comparison can see.
const future = normalizeLocalAuthority(
  { ...base, grantIssuedAt: "2026-01-01T18:00:00.000Z", maxDisconnectedSeconds: 3600 },
  REF,
);
check(
  "a grant issued in the FUTURE is unknown, never the freshest possible — and reports no age",
  future.standing === "unknown" && future.grantAgeSeconds === null,
);

// THE SECOND HALF OF THE SAME TRAP, and the one that shipped. The assertion above
// only ever exercised the branch where a grant POLICY exists. With NO policy
// (`maxDisconnectedSeconds` absent) the normalizer took a different path that had
// no future guard at all:
//
//     if (issued !== null) grantAgeSeconds = Math.floor((now - issued) / 1000);
//
// A grant dated SIX hours ahead of the reference published
// `grantAgeSeconds: -21600` — a negative age, which is smaller than every bound
// anything downstream could compare it against, and which renders as a reading
// nobody observed. (Both figures read "seven hours" and "-25200" until 2026-09-02;
// the case is REF 12:00:00Z against grantIssuedAt 18:00:00Z, which is six hours,
// and re-planting the pre-fold line emits exactly:
//     FAIL — a FUTURE-dated grant with NO policy reports NO age, not a negative
//            one (got -21600)          summary=fail (36/37)
// A figure in a comment is worth the run behind it.) The STANDING was never wrong here; the published number was.
// Its sibling normalizer (credential-rotation) refuses to emit exactly this, and
// says so in a comment. One copy had the lesson written on it; the copy next door
// did not.
//
// This assertion FAILS on the pre-fold code — verified by reverting the fix and
// re-running (2026-09-02).
const futureNoPolicy = normalizeLocalAuthority(
  { ...base, grantIssuedAt: "2026-01-01T18:00:00.000Z" },
  REF,
);
check(
  `a FUTURE-dated grant with NO policy reports NO age, not a negative one (got ${String(futureNoPolicy.grantAgeSeconds)})`,
  futureNoPolicy.standing === "no_grant_policy" && futureNoPolicy.grantAgeSeconds === null,
);

// ── 8. THE EXPIRY BOUNDARY, PINNED ON BOTH SIDES ────────────────────────────
const atLimit = normalizeLocalAuthority(
  { ...base, grantIssuedAt: "2026-01-01T11:00:00.000Z", maxDisconnectedSeconds: 3600 }, REF,
);
const pastLimit = normalizeLocalAuthority(
  { ...base, grantIssuedAt: "2026-01-01T10:59:59.000Z", maxDisconnectedSeconds: 3600 }, REF,
);
check(
  `exactly at the declared interval is still within grant (age ${atLimit.grantAgeSeconds}s vs 3600s)`,
  atLimit.standing === "within_grant" && atLimit.grantAgeSeconds === 3600,
);
check(
  `one second past it is expired (age ${pastLimit.grantAgeSeconds}s)`,
  pastLimit.standing === "expired" && pastLimit.grantAgeSeconds === 3601,
);

// ── 9. UNLISTED SPELLINGS FALL TO THE RAISING SIDE ──────────────────────────
const junk = normalizeLocalAuthority(
  {
    deviceRef: "x",
    protectedDataState: "unlocked",
    localAuthState: "ok",
    clockConfidence: "ntp",
  },
  REF,
);
check(
  "unlisted protected-data and local-auth spellings normalize to unknown, never toward the clean end",
  junk.protectedData === "unknown" && junk.localAuth === "unknown",
);
check(
  "an unlisted CLOCK spelling becomes unknown — never `trusted`",
  junk.clockConfidence === "unknown",
);

// ── 10. DETERMINISM ─────────────────────────────────────────────────────────
check(
  "the same inputs grade identically across repeated evaluation (no clock, no randomness)",
  space.every((s) => evaluateLocalAuthority(s.n).action === s.action),
);

console.log(
  `\nfigures=inputs=${space.length},granting=${grantShapes.size},protected=${PROTECTED.length},standing=${STANDING.length},clock=${CLOCK.length}`,
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
  family: "local-authority",
  resolve: (env) => resolveLocalAuthorityConnector(env),
  full: { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", LOCAL_AUTHORITY_TOKEN: "t" },
});
await checkDefaultTransport({
  check,
  family: "local-authority",
  transport: makeDefaultLocalAuthorityTransport("https://vendor.invalid/local-authority") as (a: never) => Promise<unknown>,
  arg: { deviceRef: "ref-1", token: "t" },
  codeOf: (err) => (err instanceof LocalAuthorityConnectorError ? err.code : undefined),
});


console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
