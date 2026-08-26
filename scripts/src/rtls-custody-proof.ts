// RTLS / badge-dwell physical-custody proof — fully OFFLINE and deterministic.
//
// Drives the read-only RTLS custody connector against a deterministic mock
// (normalization of vendor zone vocabularies, pagination, read-only enforcement,
// auth failure, gating) and runs the pure evaluator per device — asserting each
// device's real-time location + dwell + badge association resolve to the right
// custody posture and the action it warrants (left the area ⇒ escalate; stale/
// unconfirmable fix ⇒ locate; untracked ⇒ unknown, never in-custody). No network,
// no real location data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RtlsConnectorError,
  RtlsCustodyConnector,
  createMockRtlsTransport,
  evaluateCustodyPosture,
  guardReadOnly,
  normalizeLocation,
  resolveRtlsCustodyConnector,
  type AssetLocationRaw,
  type RtlsTransport,
} from "@workspace/integrations/rtls-custody";
import { checkLiveGateIsolated, checkCollectionRefusals } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  zoneType: string;
}
interface Fixture {
  accessToken: string;
  locations: Record<string, { record: AssetLocationRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/rtls-custody/locations.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.rtls.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("RTLS / badge-dwell physical-custody proof");
const names = Object.keys(fixture.locations);
console.log(`devices=${names.length}`);

// Feed every device record through the connector to exercise paging/normalize.
const records: AssetLocationRaw[] = names.map((n) => fixture.locations[n].record);
const transport = createMockRtlsTransport({ locations: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new RtlsCustodyConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchLocations();
check(`pagination reassembles all ${records.length} devices`, normalized.length === records.length);
check("every normalized location carries sourceSystem", normalized.every((l) => l.sourceSystem === "rtls-custody"));

// Per-device custody posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.locations[name];
  const l = normalized.find((x) => x.deviceId === spec.record.deviceId)!;
  const v = evaluateCustodyPosture(l);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.zoneType === spec.expected.zoneType;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// Untracked ≠ in-custody: a device the RTLS has no record for is unknown (a
// blind spot), NOT in good custody.
const untracked = evaluateCustodyPosture(normalizeLocation({ deviceId: "ghost" }), { tracked: false });
check("an untracked device is 'unknown', never 'in_zone'", untracked.posture === "unknown" && untracked.reasonCode === "NOT_TRACKED");

// Not present dominates: a device that left the monitored area escalates even if
// every other field looks clean.
const gone = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 5, badgeAssociated: true, present: false }));
check("a device not present in the area escalates (LEFT_AREA), regardless of other fields", gone.posture === "left_area" && gone.recommendedAction === "escalate");

// Fail-safe: an unconfirmable (null) fix age is treated as stale, not fresh.
const noFix = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, badgeAssociated: true, present: true }));
check("an unreported fix age is treated as stale → locate (never in_zone)", noFix.posture === "stale_fix" && noFix.recommendedAction === "locate");

// Fail-safe: no badge + unconfirmable (null) dwell → abandoned (dwell not assumed short).
const noBadgeNoDwell = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "public", zoneAuthorized: true, fixAgeSeconds: 30, badgeAssociated: false, present: true }));
check("no badge with an unreported dwell is treated as abandoned", noBadgeNoDwell.posture === "abandoned" && noBadgeNoDwell.reasonCode === "ABANDONED");

// Order-proof: at egress (alert) co-present with a stale fix (locate) → the
// stronger alert wins, regardless of check order.
const egressAndStale = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "egress", zoneAuthorized: true, fixAgeSeconds: 5000, badgeAssociated: true, atEgress: true, present: true }));
check("at-egress (alert) outranks a co-present stale fix (locate)", egressAndStale.recommendedAction === "alert" && egressAndStale.posture === "at_egress");

// Fail-safe (regression): a device in an UNCLASSIFIABLE zone with UNCONFIRMED
// authorization must never read as 'custody OK' — it surfaces as zone_unverified.
const unverified = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "quarantine", fixAgeSeconds: 5, dwellSeconds: 10, badgeAssociated: true, present: true }));
check("an unmapped zone with unconfirmed authorization is never 'custody OK' (→ zone_unverified/monitor)", unverified.posture === "zone_unverified" && unverified.recommendedAction === "monitor" && unverified.reasonCode === "ZONE_UNVERIFIED");

// Fail-safe (regression): an OMITTED presence field is unknown (null), NOT a
// positive "present" — so a departed device with no presence flag and a stale
// fix still surfaces (via the fix-age fail-safe), never reads as clean in_zone.
const presenceOmitted = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, badgeAssociated: true }));
check("an omitted presence field does not read as a clean in_zone (null fix → stale/locate)", presenceOmitted.posture === "stale_fix" && presenceOmitted.recommendedAction === "locate");
check("only an explicit present:false escalates to left_area", evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 5, badgeAssociated: true, present: false })).posture === "left_area");

// A fresh fix just under the threshold stays in-zone.
const freshEnough = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 899, dwellSeconds: 60, badgeAssociated: true, present: true }));
check("a fix under the 900s threshold stays in_zone", freshEnough.posture === "in_zone" && freshEnough.recommendedAction === "none");

// Determinism.
const dl = normalized.find((l) => l.deviceId === "d-abandoned")!;
check("evaluator is deterministic", JSON.stringify(evaluateCustodyPosture(dl)) === JSON.stringify(evaluateCustodyPosture(dl)));

// ── Wedges #9/#10/#11, caught by the shift-1 sweep — each an executed
// counterexample before the fix, each pinned here after it ──────────────────────

// #9: a device in a CLASSIFIED zone with UNREPORTED authorization used to skip
// the zone_unverified branch (it also required zoneType unknown) and mint
// CUSTODY_OK/none. Knowing the zone's category never proved THIS device was
// allowed there.
const classifiedUnverified = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneId: "z1", zoneType: "clinical", fixAgeSeconds: 10, dwellSeconds: 60, badgeAssociated: true, present: true }));
check("a classified zone with unreported authorization → monitor/ZONE_UNVERIFIED, never CUSTODY_OK (wedge #9)",
  classifiedUnverified.recommendedAction === "monitor" && classifiedUnverified.reasonCode === "ZONE_UNVERIFIED");

// #10: a NEGATIVE fix age (a fix newer than now — contradictory) used to pass
// `typeof number` and read fresher than the stale threshold → CUSTODY_OK/none.
// A negative dwell likewise disarmed the abandonment arm.
const negFix = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneId: "z1", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: -5, dwellSeconds: 60, badgeAssociated: true, present: true }));
check("a NEGATIVE fix age is unverifiable → stale_fix/locate, never CUSTODY_OK (wedge #10)",
  negFix.posture === "stale_fix" && negFix.recommendedAction === "locate");
const negDwell = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneId: "z1", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 10, dwellSeconds: -5, badgeAssociated: false, present: true }));
check("a NEGATIVE dwell is unverifiable → the badge-less device is still abandoned (wedge #10)",
  negDwell.posture === "abandoned" && negDwell.recommendedAction === "alert");

// #11: UNREPORTED badge association over an abandonment-length dwell used to
// fall through `=== false` and mint CUSTODY_OK/none.
const badgeNull = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneId: "z1", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 10, dwellSeconds: 7200, present: true }));
check("an unreported badge over a long dwell → monitor/BADGE_UNVERIFIED, never CUSTODY_OK (wedge #11)",
  badgeNull.recommendedAction === "monitor" && badgeNull.reasonCode === "BADGE_UNVERIFIED");

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. This family shipped THREE such wedges (above) —
// all invisible to fixture-driven checks. Every combination of every axis is
// executed through the REAL normalizer + evaluator and the granting set is
// pinned by equality.
{
  const domains = {
    tracked: [true, false],
    present: [true, false, undefined],
    zoneType: ["clinical", "unauthorized", "garbage"],
    zoneAuthorized: [true, false, undefined],
    fixAgeSeconds: [10, 900, -5, undefined],
    dwellSeconds: [60, 3600, -5, undefined],
    badgeAssociated: [true, false, undefined],
    atEgress: [true, false],
  } as const;

  type Enum = { loc: ReturnType<typeof normalizeLocation>; tracked: boolean };
  const build = (c: Record<string, unknown>): Enum => ({
    loc: normalizeLocation({
      deviceId: "dev.enum",
      zoneId: "z.enum",
      zoneType: c.zoneType as string,
      zoneAuthorized: c.zoneAuthorized as boolean | undefined,
      fixAgeSeconds: c.fixAgeSeconds as number | undefined,
      dwellSeconds: c.dwellSeconds as number | undefined,
      badgeAssociated: c.badgeAssociated as boolean | undefined,
      atEgress: c.atEgress as boolean,
      present: c.present as boolean | undefined,
    }),
    tracked: c.tracked as boolean,
  });

  const swept = enumerateGrantSafety<Enum, ReturnType<typeof evaluateCustodyPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateCustodyPosture(s.loc, { tracked: s.tracked }),
    actionOf: (v) => v.recommendedAction,
    // Custody OK requires: tracked, not at egress, presence not denied, zone
    // authorization POSITIVELY confirmed (and the zone not classified
    // unauthorized — a contradiction that resolves to off_zone), a reported
    // fresh fix, and the badge axis clean. Two axes are deliberately free:
    // `present` may be unreported (the fix-age fail-safe is the documented
    // guard — a departed device stops producing fresh fixes), and the badge
    // association only bears on ABANDONMENT — it constrains the verdict only
    // when the dwell is abandonment-length or unconfirmable, so "no badge but
    // only briefly dwelling" (a device in transit between users) stays clean.
    positivelyClean: (c) =>
      c.tracked === true && c.atEgress === false && c.present !== false &&
      c.zoneAuthorized === true && c.zoneType !== "unauthorized" &&
      c.fixAgeSeconds === 10 &&
      (c.badgeAssociated === true || c.dwellSeconds === 60),
    confirmedWhenNone: (v) => v.reasonCode === "CUSTODY_OK" && v.posture === "in_zone",
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 2 * 3 * 3 * 3 * 4 * 4 * 3 * 2);
  check("ENUMERATION: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: the granting set is present{2} × zoneType{2} × (badge-true×dwell{4} + badge-other{2}×short-dwell) = 24 states (non-vacuous)",
    swept.noneCount === 24);

  // NEGATIVE CONTROL — the enumeration can fail: declare zone authorization
  // irrelevant to custody and the harness must object, because the evaluator
  // (correctly) refuses to grant unauthorized or unverified-authorization zones.
  const wrongPredicate = enumerateGrantSafety<Enum, ReturnType<typeof evaluateCustodyPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateCustodyPosture(s.loc, { tracked: s.tracked }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.tracked === true && c.atEgress === false && c.present !== false &&
      c.zoneType !== "unauthorized" && c.fixAgeSeconds === 10 && c.badgeAssociated === true,
  });
  check("NEGATIVE CONTROL: declaring zone authorization irrelevant is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");

  // The contradictory (negative) durations grade identically to unreported ones,
  // on every other axis combination — pinned so a future normalizer change
  // cannot quietly turn "newer than now" back into "fresh".
  const othersAgree = (field: "fixAgeSeconds" | "dwellSeconds"): boolean =>
    domains.tracked.every((tr) => domains.present.every((pr) => domains.zoneType.every((zt) =>
      domains.zoneAuthorized.every((za) => domains.badgeAssociated.every((ba) => domains.atEgress.every((eg) =>
        (field === "fixAgeSeconds" ? domains.dwellSeconds : domains.fixAgeSeconds).every((other) => {
          const mk = (val: number | undefined): ReturnType<typeof evaluateCustodyPosture> =>
            evaluateCustodyPosture(build({
              tracked: tr, present: pr, zoneType: zt, zoneAuthorized: za,
              fixAgeSeconds: field === "fixAgeSeconds" ? val : other,
              dwellSeconds: field === "dwellSeconds" ? val : other,
              badgeAssociated: ba, atEgress: eg,
            }).loc, { tracked: tr });
          const va = mk(-5);
          const vb = mk(undefined);
          return va.reasonCode === vb.reasonCode && va.recommendedAction === vb.recommendedAction && va.posture === vb.posture;
        })))))));
  check("a negative fix age grades identically to an unreported one, on every axis combination", othersAgree("fixAgeSeconds"));
  check("a negative dwell grades identically to an unreported one, on every axis combination", othersAgree("dwellSeconds"));
}

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("PATCH"); } catch (err) { readOnly = err instanceof RtlsConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new RtlsCustodyConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: RtlsConnectorError | null = null;
try { await bad.listLocations(); } catch (err) { authErr = err instanceof RtlsConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", RTLS_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "rtls-custody",
  resolve: (env) => resolveRtlsCustodyConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    RTLS_ACCESS_TOKEN: "t",
  },
});

// ── A garbled caller threshold may not switch a check off ─────────────────────
//
// `staleFixSeconds` and `abandonDwellSeconds` are POSED by the caller. They used to
// be read with a bare `?? DEFAULT`, and the comparisons are `>=`. A NaN threshold
// makes every `>=` false and an Infinity threshold makes every finite age smaller,
// so BOTH forms silently switched the check off — and this family's own header says
// "a device we can't physically see is never mistaken for one in good custody."
// Every internal fail-safe here is careful, and all of it was defeated by one
// unreadable option from outside.
//
// Executed before the fix: a badge-less device with a fix age and dwell of ~28 hours
// graded `abandoned / alert` on the defaults, and `in_zone / none / CUSTODY_OK` with
// NaN or Infinity. A device nobody could see became a device in good custody.
{
  const abandonedLoc = {
    subjectRef: "asset-9001",
    zoneId: "ward-3",
    zoneType: "clinical" as const,
    zoneAuthorized: true,
    fixAgeSeconds: 99999,
    dwellSeconds: 99999,
    badgeAssociated: false,
    present: true,
    atEgress: false,
    covered: true,
    source: "rtls",
    observedAt: "2026-07-13T12:00:00.000Z",
  };

  // EACH AXIS IS ISOLATED, and the first draft of this block was not — it asserted
  // "does not grant" on a record where the ABANDONMENT axis fired independently, so
  // it passed with the fix-age guard removed. A test that passes for a reason other
  // than the one it names is the unfalsifiable-guard defect this repo hunts, and it
  // appeared here first. Each case below is built so the bound under test is the
  // ONLY thing that can raise.

  // Fix-age axis alone: badge held, dwell short — nothing else objects.
  const staleFixOnly = {
    ...abandonedLoc,
    badgeAssociated: true,
    dwellSeconds: 5,
    fixAgeSeconds: 99999,
  };
  const staleFixControl = evaluateCustodyPosture(staleFixOnly as never);
  check(
    "fix-age axis control: on the DEFAULT bound this stale fix raises",
    staleFixControl.recommendedAction !== "none" && staleFixControl.reasonCode === "STALE_FIX",
  );

  // Dwell axis alone: fix fresh — only the badge-less long dwell can object.
  const dwellOnly = {
    ...abandonedLoc,
    fixAgeSeconds: 5,
    badgeAssociated: false,
    dwellSeconds: 99999,
  };
  const dwellControl = evaluateCustodyPosture(dwellOnly as never);
  check(
    "dwell axis control: on the DEFAULT bound this badge-less dwell raises",
    dwellControl.recommendedAction !== "none" && dwellControl.reasonCode === "ABANDONED",
  );

  // WHICH OF THESE ACTUALLY DISCRIMINATE, stated because a case that cannot fail
  // is not evidence: planting the defect back fails the NaN and Infinity cases
  // only. `zero` and `negative` pass with OR without the guard, because any
  // positive age satisfies `age >= 0` and `age >= -1` — the comparison happens to
  // fall the safe way. They are kept because they pin the INTENT (a non-positive
  // bound is a garbled pose and must never be honoured) and would become
  // load-bearing the moment the comparison changed shape or a negative age became
  // representable. Four falsifiable, two intentional.
  for (const [label, bound] of [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
  ] as ReadonlyArray<readonly [string, number]>) {
    const byFix = evaluateCustodyPosture(staleFixOnly as never, { staleFixSeconds: bound });
    check(
      `a ${label} staleFixSeconds does NOT silence the stale-fix finding`,
      byFix.recommendedAction !== "none",
    );
    const byDwell = evaluateCustodyPosture(dwellOnly as never, { abandonDwellSeconds: bound });
    check(
      `a ${label} abandonDwellSeconds does NOT silence the abandonment finding`,
      byDwell.recommendedAction !== "none",
    );
  }

  // The fix must not degrade into "always raise": a HONEST bound still grades.
  const honest = evaluateCustodyPosture(
    { ...abandonedLoc, fixAgeSeconds: 10, dwellSeconds: 10, badgeAssociated: true } as never,
    { staleFixSeconds: 900, abandonDwellSeconds: 3600 },
  );
  check(
    "...and a readable bound over a fresh, badged fix still grants",
    honest.recommendedAction === "none",
  );
}



// COLLECTION SHAPE and PAGE-CAP REFUSAL — both survived mutation until 2026-08-25.
// Shared helper, one statement of a rule nine families implement identically.
await checkCollectionRefusals({
  check,
  family: "rtls-custody",
  listWith: (t, pageLimit) => () =>
    new RtlsCustodyConnector({ accessToken: "t", baseUrl: BASE_URL, pageLimit }, t as unknown as RtlsTransport).listLocations(),
  codeOf: (e) => (e instanceof RtlsConnectorError ? e.code : undefined),
});


const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
