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
  CUSTODY_LEDGER_FIXTURES,
  CUSTODY_LEDGER_INTEGRITY_DOMAIN,
  CUSTODY_LEDGER_REPORT_KEYS,
  CAP_STATE_DOMAIN,
  LEDGER_HOLDER_DOMAIN,
  LEDGER_STATE_DOMAIN,
  PAIRING_DOMAIN,
  SLOT_STATE_DOMAIN,
  evaluateCustodyLedger,
  evaluateCustodyLedgerFixture,
  normalizeCustodyLedger,
  type CapState,
  type CustodyLedgerReportIntegrity,
  type CustodyLedgerReportRaw,
  type CustodyLedgerVerdict,
  type LedgerHolder,
  type LedgerState,
  type NormalizedCustodyLedger,
  type PairingState,
  type SlotState,
} from "@workspace/integrations/rtls-custody";
import * as rtlsCustodyModule from "@workspace/integrations/rtls-custody";
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

// Fail-safe (regression, 2026-09-06): an UNREADABLE fix age or dwell — NaN, the
// value a failed upstream parse produces — must grade exactly like an unreported
// one. `=== null || >= bound` let NaN fall through both arms: a NaN fix age read
// FRESH and a NaN dwell read SHORT. Number.isFinite closes both. Mutation record:
// with either predicate reverted to `=== null`, its assertion fails by name.
const nanFix = evaluateCustodyPosture({ ...normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 5, badgeAssociated: true, present: true }), fixAgeSeconds: Number.NaN });
check("an UNREADABLE fix age (NaN) is stale → locate, never in_zone", nanFix.posture === "stale_fix" && nanFix.recommendedAction === "locate");
const nanDwell = evaluateCustodyPosture({ ...normalizeLocation({ deviceId: "d", zoneType: "public", zoneAuthorized: true, fixAgeSeconds: 30, dwellSeconds: 10, badgeAssociated: false, present: true }), dwellSeconds: Number.NaN });
check("no badge with an UNREADABLE dwell (NaN) is abandoned, never in_zone", nanDwell.posture === "abandoned" && nanDwell.reasonCode === "ABANDONED");

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

// ── THE CUSTODY-LEDGER RECONCILIATION (custody-ledger.ts) ───────────────────────
//
// Two runbook rows the family did not model (docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md):
// a returned device the ledger still assigns to a prior holder / an unpaired device
// occupying a slot, and a per-user cap that blocks a clinician only because a prior
// return never cleared. Distinct from the physical-custody evaluator above (where the
// device IS) — this grades what the LEDGER SAYS against what the BAY SEES, plus the
// requester's cap. Named outcomes, single-axis flips of the one grant, the exhaustive
// 864-state sweep pinning that grant by equality, the normalizer on hostile wire input,
// and the computed cap axis on every count shape.
const L = (name: string): CustodyLedgerVerdict => {
  const v = evaluateCustodyLedgerFixture(name);
  if (v === undefined) throw new Error(`custody-ledger fixture missing: ${name}`);
  return v;
};
check("custody-ledger: an unknown fixture name is undefined, never a fabricated verdict", evaluateCustodyLedgerFixture("no-such-fixture") === undefined);
const ledgerExpected: Array<[string, CustodyLedgerVerdict["posture"], CustodyLedgerVerdict["recommendedAction"], CustodyLedgerVerdict["reasonCode"]]> = [
  ["clear", "custody_clear", "none", "CUSTODY_CLEAR"],
  ["stale-return-other", "stale_return", "step_up", "CUSTODY_STALE_RETURN_OTHER"],
  ["stale-return-own", "stale_return", "step_up", "CUSTODY_STALE_RETURN_OWN"],
  ["held-by-other", "held_elsewhere", "restrict", "CUSTODY_HELD_BY_OTHER"],
  ["already-held", "already_held", "monitor", "CUSTODY_ALREADY_HELD"],
  ["unaccounted", "unaccounted", "escalate", "CUSTODY_DEVICE_UNACCOUNTED"],
  ["unpaired-in-slot", "unpaired", "restrict", "CUSTODY_UNPAIRED_IN_SLOT"],
  ["unpaired-absent", "unpaired", "restrict", "CUSTODY_UNPAIRED_DEVICE"],
  ["cap-reached", "cap_reached", "restrict", "CUSTODY_CAP_REACHED"],
  ["cap-blocked-stale", "cap_blocked_stale", "step_up", "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"],
  ["clear-with-holder", "ledger_inconsistent", "step_up", "CUSTODY_LEDGER_INCONSISTENT"],
  ["checked-out-without-holder", "ledger_inconsistent", "step_up", "CUSTODY_LEDGER_INCONSISTENT"],
  ["ledger-unknown", "custody_unverified", "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["holder-unknown", "custody_unverified", "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["slot-unknown", "custody_unverified", "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["pairing-unknown", "custody_unverified", "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["cap-unknown", "custody_unverified", "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["report-malformed", "unverified", "step_up", "CUSTODY_REPORT_MALFORMED"],
  ["worst-of-several", "unpaired", "restrict", "CUSTODY_UNPAIRED_IN_SLOT"],
];
for (const [name, posture, action, reason] of ledgerExpected) {
  const v = L(name);
  check(`custody-ledger '${name}' → ${posture} / ${action} / ${reason} (${v.posture} / ${v.recommendedAction} / ${v.reasonCode})`,
    v.posture === posture && v.recommendedAction === action && v.reasonCode === reason && v.readyForCheckout === (action === "none"));
}
check("custody-ledger: every fixture name in the corpus evaluates (no silent skip)",
  Object.keys(CUSTODY_LEDGER_FIXTURES).every((n) => evaluateCustodyLedgerFixture(n) !== undefined) && Object.keys(CUSTODY_LEDGER_FIXTURES).length === ledgerExpected.length);
// The three ledgers of a verdict, each populated by the branch that owns it.
check("custody-ledger: the phantom (stale-return-other) is a CONTRADICTION, not a critical finding, and names itself",
  L("stale-return-other").contradictions.includes("stale_return_other") && L("stale-return-other").criticalFindings.length === 0 && L("stale-return-other").unknownSignals.length === 0);
check("custody-ledger: the requester's own stale return names itself", L("stale-return-own").contradictions.includes("stale_return_own"));
check("custody-ledger: a cap hit only by stale returns is a contradiction named as such", L("cap-blocked-stale").contradictions.includes("cap_blocked_by_stale_return"));
check("custody-ledger: 'unpaired in slot' and 'cap reached' are critical findings; 'held by other' and 'unaccounted' too",
  L("unpaired-in-slot").criticalFindings.includes("unpaired_in_slot") && L("unpaired-absent").criticalFindings.includes("unpaired") &&
  L("cap-reached").criticalFindings.includes("cap_reached") && L("held-by-other").criticalFindings.includes("held_by_other") &&
  L("unaccounted").criticalFindings.includes("unaccounted"));
check("custody-ledger: a clear ledger that names a holder is 'clear_with_holder'; checked out with nobody is 'checked_out_without_holder'",
  L("clear-with-holder").contradictions.includes("clear_with_holder") && L("checked-out-without-holder").contradictions.includes("checked_out_without_holder"));
check("custody-ledger: the grant carries empty findings, contradictions and unknowns",
  L("clear").criticalFindings.length === 0 && L("clear").contradictions.length === 0 && L("clear").unknownSignals.length === 0);
const ledgerWorst = L("worst-of-several");
check("custody-ledger 'worst-of-several': the unpaired bay is named first (tie on restrict), the cap and the stale return are all recorded",
  ledgerWorst.criticalFindings.includes("unpaired_in_slot") && ledgerWorst.criticalFindings.includes("cap_reached") &&
  ledgerWorst.contradictions.includes("stale_return_other") && ledgerWorst.reasonCode === "CUSTODY_UNPAIRED_IN_SLOT");
check("custody-ledger: the advisory (already held) is NOT ready for check-out — the device is not in the bay",
  L("already-held").readyForCheckout === false && L("already-held").recommendedAction === "monitor");
// A clear ledger that names the REQUESTER (not just another person) is the same contradiction.
const ledgerBase = CUSTODY_LEDGER_FIXTURES["clear"];
check("custody-ledger: a clear ledger naming the requester as holder is inconsistent too (the disjunct is live)",
  evaluateCustodyLedger({ ...ledgerBase, ledgerHolder: "requester" }).reasonCode === "CUSTODY_LEDGER_INCONSISTENT");
check("custody-ledger: an unknown ledger beside an unknown slot names BOTH axes",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "unknown", slotState: "unknown" }).unknownSignals.includes("slot_state") &&
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "unknown", slotState: "unknown" }).unknownSignals.includes("ledger_state"));
check("custody-ledger: checked out to an unknown holder while seated / absent both hold on the holder axis",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "unknown" }).unknownSignals.includes("ledger_holder") &&
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "unknown", slotState: "absent" }).unknownSignals.includes("ledger_holder"));
check("custody-ledger: checked out with the bay unknown holds on the slot axis",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "other", slotState: "unknown" }).unknownSignals.includes("slot_state"));
check("custody-ledger: checked out to nobody while absent is inconsistent (not the phantom, not held elsewhere)",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "none", slotState: "absent" }).reasonCode === "CUSTODY_LEDGER_INCONSISTENT");
check("custody-ledger: an unpaired device with the bay unknown is still contained as unpaired (the else arm)",
  evaluateCustodyLedger({ ...ledgerBase, pairing: "unpaired", slotState: "unknown" }).reasonCode === "CUSTODY_UNPAIRED_DEVICE");
check("custody-ledger: an unaccounted device outranks an unpaired one (escalate over restrict), both recorded",
  evaluateCustodyLedger({ ...ledgerBase, pairing: "unpaired", slotState: "absent" }).recommendedAction === "escalate" &&
  evaluateCustodyLedger({ ...ledgerBase, pairing: "unpaired", slotState: "absent" }).criticalFindings.includes("unpaired"));
check("custody-ledger: a hold beside the advisory outranks it (already held + cap blocked by stale returns → step_up)",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "requester", slotState: "absent", capState: "cap_stale" }).recommendedAction === "step_up");

// single-axis flips of the one grant
const ledgerFlips: Array<[string, Partial<NormalizedCustodyLedger>, CustodyLedgerVerdict["recommendedAction"], CustodyLedgerVerdict["reasonCode"]]> = [
  ["ledger checked out (phantom, other)", { ledgerState: "checked_out", ledgerHolder: "other" }, "step_up", "CUSTODY_STALE_RETURN_OTHER"],
  ["ledger checked out (own stale return)", { ledgerState: "checked_out", ledgerHolder: "requester" }, "step_up", "CUSTODY_STALE_RETURN_OWN"],
  ["ledger checked out, no holder", { ledgerState: "checked_out" }, "step_up", "CUSTODY_LEDGER_INCONSISTENT"],
  ["ledger unknown", { ledgerState: "unknown" }, "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["holder named on a clear ledger", { ledgerHolder: "other" }, "step_up", "CUSTODY_LEDGER_INCONSISTENT"],
  ["holder unknown", { ledgerHolder: "unknown" }, "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["bay empty", { slotState: "absent" }, "escalate", "CUSTODY_DEVICE_UNACCOUNTED"],
  ["bay unknown", { slotState: "unknown" }, "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["unpaired", { pairing: "unpaired" }, "restrict", "CUSTODY_UNPAIRED_IN_SLOT"],
  ["pairing unknown", { pairing: "unknown" }, "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["cap reached", { capState: "cap_reached" }, "restrict", "CUSTODY_CAP_REACHED"],
  ["cap blocked by stale returns", { capState: "cap_stale" }, "step_up", "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"],
  ["cap unknown", { capState: "unknown" }, "step_up", "CUSTODY_STATE_UNKNOWN"],
  ["report malformed", { reportIntegrity: "malformed" }, "step_up", "CUSTODY_REPORT_MALFORMED"],
];
check("custody-ledger FAIL-CLOSED: the base state is the grant", evaluateCustodyLedger(ledgerBase).readyForCheckout === true);
for (const [label, patch, action, reason] of ledgerFlips) {
  const v = evaluateCustodyLedger({ ...ledgerBase, ...patch });
  check(`custody-ledger FAIL-CLOSED: ${label} flips the grant to ${action} / ${reason} (${v.recommendedAction} / ${v.reasonCode})`,
    v.recommendedAction === action && v.reasonCode === reason && v.readyForCheckout === false);
}

// the grant set, pinned by equality over the whole state space
// The sweep walks the MODULE's exported domains, not a hand-typed copy. The 864 below is
// the documented figure and stays literal on purpose: if a domain grows, this line fails
// first. The docs↔proof figure guard binds a documented figure only when it can SEE it —
// a comma-formatted number of 1,000 or more, or "N … combos" / "N … grants" with
// whitespace after the digits — so the docs write "864 combos" (never "864-state", which
// the guard's noun pass cannot read: in-house review finding) and the raw-space sweep
// below adds a comma-formatted figure the guard reads on its own.
const ledgerDomains = {
  ledgerState: LEDGER_STATE_DOMAIN,
  ledgerHolder: LEDGER_HOLDER_DOMAIN,
  slotState: SLOT_STATE_DOMAIN,
  pairing: PAIRING_DOMAIN,
  capState: CAP_STATE_DOMAIN,
  reportIntegrity: CUSTODY_LEDGER_INTEGRITY_DOMAIN,
} as const;
const buildLedger = (c: Record<string, unknown>): NormalizedCustodyLedger => ({
  sourceSystem: "rtls-custody",
  deviceRef: "enum",
  requesterRef: "enum-requester",
  ledgerState: c.ledgerState as LedgerState,
  ledgerHolder: c.ledgerHolder as LedgerHolder,
  slotState: c.slotState as SlotState,
  pairing: c.pairing as PairingState,
  capState: c.capState as CapState,
  reportIntegrity: c.reportIntegrity as CustodyLedgerReportIntegrity,
});
const isLedgerClear = (c: Record<string, unknown>): boolean =>
  c.ledgerState === "clear" &&
  c.ledgerHolder === "none" &&
  c.slotState === "seated" &&
  c.pairing === "paired" &&
  c.capState === "under_cap" &&
  c.reportIntegrity === "clean";
const ledgerRes = enumerateGrantSafety<NormalizedCustodyLedger, CustodyLedgerVerdict>({
  domains: ledgerDomains,
  build: buildLedger,
  evaluate: evaluateCustodyLedger,
  actionOf: (v) => v.recommendedAction,
  positivelyClean: isLedgerClear,
  confirmedWhenNone: (v) =>
    v.readyForCheckout === true && v.reasonCode === "CUSTODY_CLEAR" &&
    v.criticalFindings.length === 0 && v.contradictions.length === 0 && v.unknownSignals.length === 0,
});
check(`custody-ledger ENUMERATION: all ${ledgerRes.combos} reconciliation states swept (= product of domains)`,
  ledgerRes.combos === productOf(ledgerDomains) && ledgerRes.combos === 3 * 4 * 3 * 3 * 4 * 2);
check("custody-ledger ENUMERATION: ready is EXACTLY the one positively-confirmed state — zero mismatches", ledgerRes.mismatches === 0);
check("custody-ledger ENUMERATION: exactly one state grants (non-vacuous)", ledgerRes.noneCount === 1);
// NEGATIVE CONTROL — declare every clear-ledger state clean (ignoring the bay and the cap)
// and the harness must object.
const ledgerWrong = enumerateGrantSafety<NormalizedCustodyLedger, CustodyLedgerVerdict>({
  domains: ledgerDomains,
  build: buildLedger,
  evaluate: evaluateCustodyLedger,
  actionOf: (v) => v.recommendedAction,
  positivelyClean: (c) => c.ledgerState === "clear" && c.ledgerHolder === "none",
});
check("custody-ledger NEGATIVE CONTROL: declaring every clear-ledger state clean is CAUGHT (mismatches > 0)",
  ledgerWrong.mismatches > 0 && typeof ledgerWrong.firstMismatch === "string");
// The ladder, pinned over the whole space: monitor is reserved for "already held and not in
// the bay"; escalate for "clear and not in the bay"; alert is unreachable; ready ⇔ none.
let ledgerMonitorOffAxis = 0;
let ledgerEscalateOffAxis = 0;
let ledgerAlert = 0;
let ledgerReadyCount = 0;
let ledgerReadyMismatch = 0;
for (const ledgerState of ledgerDomains.ledgerState)
  for (const ledgerHolder of ledgerDomains.ledgerHolder)
    for (const slotState of ledgerDomains.slotState)
      for (const pairing of ledgerDomains.pairing)
        for (const capState of ledgerDomains.capState)
          for (const reportIntegrity of ledgerDomains.reportIntegrity) {
            const v = evaluateCustodyLedger(buildLedger({ ledgerState, ledgerHolder, slotState, pairing, capState, reportIntegrity }));
            const a = v.recommendedAction;
            if (a === "monitor" && !(ledgerState === "checked_out" && ledgerHolder === "requester" && slotState === "absent")) ledgerMonitorOffAxis += 1;
            if (a === "escalate" && !(ledgerState === "clear" && slotState === "absent")) ledgerEscalateOffAxis += 1;
            if (a === "alert") ledgerAlert += 1;
            if (v.readyForCheckout) ledgerReadyCount += 1;
            if (v.readyForCheckout !== (a === "none")) ledgerReadyMismatch += 1;
          }
check("custody-ledger: monitor is reachable ONLY as 'already held by the requester and not in the bay'", ledgerMonitorOffAxis === 0);
check("custody-ledger: escalate is reachable ONLY as 'ledger clear and the bay empty' (unaccounted)", ledgerEscalateOffAxis === 0);
check("custody-ledger: no reconciliation state resolves to alert", ledgerAlert === 0);
check("custody-ledger: over all states readyForCheckout ⇔ none, with no state disagreeing", ledgerReadyMismatch === 0);
check(`custody-ledger: exactly ONE state is ready for check-out — the advisory is not (${ledgerReadyCount})`, ledgerReadyCount === 1);

// the normalizer on hostile wire input — the asymmetry that makes it safe
const ledgerGrantRaw = { ledger_state: "none", ledger_holder: "none", slot_state: "seated", pairing: "paired", open_checkouts: 1, checkout_cap: 3, stale_returns: 0 };
const ledgerWireOk = normalizeCustodyLedger("w-1", "rn-1", ledgerGrantRaw);
check("custody-ledger: a fully-confirmed wire report normalizes clean and evaluates to the grant",
  ledgerWireOk.reportIntegrity === "clean" && ledgerWireOk.capState === "under_cap" && evaluateCustodyLedger(ledgerWireOk).readyForCheckout === true);
check("custody-ledger: 'returned' and 'none' both normalize to a CLEAR ledger; 'checked_out' stays checked out; absent is unknown",
  normalizeCustodyLedger("w-2", "r", { ...ledgerGrantRaw, ledger_state: "returned" }).ledgerState === "clear" &&
  normalizeCustodyLedger("w-2", "r", { ...ledgerGrantRaw, ledger_state: "none" }).ledgerState === "clear" &&
  normalizeCustodyLedger("w-2", "r", { ...ledgerGrantRaw, ledger_state: "checked_out" }).ledgerState === "checked_out" &&
  normalizeCustodyLedger("w-2", "r", { ...ledgerGrantRaw, ledger_state: undefined }).ledgerState === "unknown");
const ledgerWireVocab = normalizeCustodyLedger("w-3", "r", { ledger_state: "sorta", ledger_holder: "someone", slot_state: "half", pairing: "kinda", open_checkouts: 1, checkout_cap: 3, stale_returns: 0 });
check("custody-ledger: out-of-vocabulary strings normalize to unknown on every enum axis (never a fabricated state), report clean",
  ledgerWireVocab.ledgerState === "unknown" && ledgerWireVocab.ledgerHolder === "unknown" && ledgerWireVocab.slotState === "unknown" &&
  ledgerWireVocab.pairing === "unknown" && ledgerWireVocab.reportIntegrity === "clean" && evaluateCustodyLedger(ledgerWireVocab).readyForCheckout === false);
const ledgerWireMalformed = normalizeCustodyLedger("w-4", "r", { ...ledgerGrantRaw, slot_state: true });
check("custody-ledger: a present-but-non-string enum slot marks the report MALFORMED — step_up for that reason",
  ledgerWireMalformed.reportIntegrity === "malformed" && evaluateCustodyLedger(ledgerWireMalformed).reasonCode === "CUSTODY_REPORT_MALFORMED");
const ledgerWireSilent = normalizeCustodyLedger("w-5", "r", null);
check("custody-ledger: an absent report (silence) is all-unknown and CLEAN — silence is not malformed — and still steps up",
  ledgerWireSilent.ledgerState === "unknown" && ledgerWireSilent.capState === "unknown" && ledgerWireSilent.reportIntegrity === "clean" &&
  evaluateCustodyLedger(ledgerWireSilent).recommendedAction === "step_up");
// THE CAP AXIS IS COMPUTED, never asserted — every count shape, each isolated.
const capOf = (open: unknown, cap: unknown, stale: unknown): [CapState, CustodyLedgerReportIntegrity] => {
  const n = normalizeCustodyLedger("w-cap", "r", { ...ledgerGrantRaw, open_checkouts: open, checkout_cap: cap, stale_returns: stale });
  return [n.capState, n.reportIntegrity];
};
check("custody-ledger cap: under the cap (1 of 3, none stale) → under_cap, clean", capOf(1, 3, 0)[0] === "under_cap" && capOf(1, 3, 0)[1] === "clean");
check("custody-ledger cap: at the cap with none stale → cap_reached", capOf(3, 3, 0)[0] === "cap_reached");
check("custody-ledger cap: at the cap ONLY because one return never cleared → cap_stale (the mystery beep, named)", capOf(3, 3, 1)[0] === "cap_stale");
check("custody-ledger cap: over the cap with enough stale returns to fall under it → cap_stale", capOf(4, 3, 2)[0] === "cap_stale");
check("custody-ledger cap: over the cap even after discounting stale returns → cap_reached", capOf(4, 3, 1)[0] === "cap_reached");
check("custody-ledger cap: exactly at the cap after discounting stale returns is REACHED, not stale (the boundary is strict)", capOf(5, 3, 2)[0] === "cap_reached");
check("custody-ledger cap: an ABSENT open count → unknown and clean (a cap without its count is uninterpretable, and unknown raises)",
  capOf(undefined, 3, 0)[0] === "unknown" && capOf(undefined, 3, 0)[1] === "clean" && evaluateCustodyLedger(normalizeCustodyLedger("w", "r", { ...ledgerGrantRaw, open_checkouts: undefined })).readyForCheckout === false);
check("custody-ledger cap: an ABSENT cap → unknown and clean", capOf(1, undefined, 0)[0] === "unknown" && capOf(1, undefined, 0)[1] === "clean");
check("custody-ledger cap: an ABSENT stale count → unknown and clean", capOf(1, 3, undefined)[0] === "unknown" && capOf(1, 3, undefined)[1] === "clean");
check("custody-ledger cap: a ZERO cap is a garbled configuration → malformed, unknown", capOf(1, 0, 0)[0] === "unknown" && capOf(1, 0, 0)[1] === "malformed");
check("custody-ledger cap: more stale returns than open checkouts contradict each other → malformed, unknown", capOf(1, 3, 2)[0] === "unknown" && capOf(1, 3, 2)[1] === "malformed");
check("custody-ledger cap: a string count is never coerced → malformed", capOf("1", 3, 0)[1] === "malformed" && capOf(1, "3", 0)[1] === "malformed" && capOf(1, 3, "0")[1] === "malformed");
check("custody-ledger cap: a float count → malformed", capOf(1.5, 3, 0)[1] === "malformed");
check("custody-ledger cap: a NEGATIVE count → malformed", capOf(-1, 3, 0)[1] === "malformed" && capOf(1, 3, -1)[1] === "malformed");
check("custody-ledger cap: NaN / Infinity / an unsafe integer → malformed",
  capOf(Number.NaN, 3, 0)[1] === "malformed" && capOf(1, Number.POSITIVE_INFINITY, 0)[1] === "malformed" && capOf(2 ** 53, 3, 0)[1] === "malformed");
check("custody-ledger cap: a boolean count → malformed", capOf(true, 3, 0)[1] === "malformed");
check("custody-ledger cap: a malformed count still leaves the enum axes readable (the parse is per-slot)",
  normalizeCustodyLedger("w", "r", { ...ledgerGrantRaw, open_checkouts: "1" }).slotState === "seated");
// Own-property reads: a report that INHERITS the recognized fields asserted nothing itself.
const ledgerInherited = normalizeCustodyLedger("w-6", "r", Object.create(ledgerGrantRaw) as CustodyLedgerReportRaw);
check("custody-ledger: a report that only INHERITS the confirmed axes is malformed, all-unknown, and never ready",
  ledgerInherited.reportIntegrity === "malformed" && ledgerInherited.ledgerState === "unknown" && ledgerInherited.slotState === "unknown" &&
  ledgerInherited.pairing === "unknown" && ledgerInherited.capState === "unknown" && evaluateCustodyLedger(ledgerInherited).readyForCheckout === false);
const ledgerAlias = normalizeCustodyLedger("w-7", "r", Object.assign(Object.create({ pairing: "unpaired" }), ledgerGrantRaw) as CustodyLedgerReportRaw);
check("custody-ledger: a recognized key inherited BEHIND a clean own set still marks the report malformed (the chain scan notices it)",
  ledgerAlias.reportIntegrity === "malformed" && evaluateCustodyLedger(ledgerAlias).readyForCheckout === false);
check("custody-ledger: Object.prototype itself as the report is malformed",
  normalizeCustodyLedger("w-8", "r", Object.prototype as CustodyLedgerReportRaw).reportIntegrity === "malformed");
check("custody-ledger: an array or a string where the report should be is malformed, never a thrown TypeError",
  normalizeCustodyLedger("w-9", "r", [] as unknown as CustodyLedgerReportRaw).reportIntegrity === "malformed" &&
  normalizeCustodyLedger("w-10", "r", "seated" as unknown as CustodyLedgerReportRaw).reportIntegrity === "malformed");
const ledgerExtra = normalizeCustodyLedger("w-11", "r", { ...ledgerGrantRaw, holder_name: "rn-9" } as CustodyLedgerReportRaw);
check("custody-ledger: an unrecognized OWN key is an assertion in a spelling we ignore — malformed, and the clean-looking rest is not ready",
  ledgerExtra.reportIntegrity === "malformed" && evaluateCustodyLedger(ledgerExtra).readyForCheckout === false);
check("custody-ledger: a symbol-keyed report is malformed",
  normalizeCustodyLedger("w-12", "r", { ...ledgerGrantRaw, [Symbol("x")]: 1 } as CustodyLedgerReportRaw).reportIntegrity === "malformed");
let ledgerDeepProto: object = {};
for (let i = 0; i < 100; i += 1) ledgerDeepProto = Object.create(ledgerDeepProto);
check("custody-ledger: a report behind a 100-deep prototype chain is malformed (the walk is bounded, not trusted)",
  normalizeCustodyLedger("w-13", "r", Object.assign(Object.create(ledgerDeepProto), ledgerGrantRaw) as CustodyLedgerReportRaw).reportIntegrity === "malformed");
const ledgerThrowing = new Proxy(ledgerGrantRaw, { ownKeys: () => { throw new Error("hostile"); } }) as CustodyLedgerReportRaw;
check("custody-ledger: a Proxy whose key enumeration throws is malformed, never an exception out of the normalizer",
  normalizeCustodyLedger("w-14", "r", ledgerThrowing).reportIntegrity === "malformed");
check("custody-ledger: a plain own-property report still reaches the grant (the hostile-shape guards do not foreclose the honest path)",
  evaluateCustodyLedger(normalizeCustodyLedger("w-15", "r", { ...ledgerGrantRaw })).readyForCheckout === true);
const ledgerGetter = Object.defineProperty({ ledger_holder: "none", slot_state: "seated", pairing: "paired", open_checkouts: 1, checkout_cap: 3, stale_returns: 0 },
  "ledger_state", { get() { throw new Error("hostile getter"); }, enumerable: true });
const ledgerGetterOut = normalizeCustodyLedger("w-16", "r", ledgerGetter as CustodyLedgerReportRaw);
check("custody-ledger: an own accessor whose getter throws is malformed and all-unknown, never an exception out of the normalizer",
  ledgerGetterOut.reportIntegrity === "malformed" && ledgerGetterOut.ledgerState === "unknown" && ledgerGetterOut.capState === "unknown");
const ledgerGetTrap = new Proxy(ledgerGrantRaw, { get: () => { throw new Error("hostile get"); } }) as CustodyLedgerReportRaw;
check("custody-ledger: a Proxy whose `get` trap throws is malformed, never an exception", normalizeCustodyLedger("w-17", "r", ledgerGetTrap).reportIntegrity === "malformed");
// The grant is a POSITIVE predicate: a NORMALIZED value outside the declared union — a
// JavaScript caller, a cast — matches no branch and must be HELD, not ready. (Report
// integrity is the one axis an existing branch already catches.)
const ledgerOodAxes: Array<[string, Partial<NormalizedCustodyLedger>, CustodyLedgerVerdict["reasonCode"], string]> = [
  ["ledger state", { ledgerState: "garbage" as LedgerState }, "CUSTODY_STATE_UNKNOWN", "state_out_of_domain"],
  ["ledger holder", { ledgerHolder: "garbage" as LedgerHolder }, "CUSTODY_STATE_UNKNOWN", "state_out_of_domain"],
  ["slot state", { slotState: "garbage" as SlotState }, "CUSTODY_STATE_UNKNOWN", "state_out_of_domain"],
  ["pairing", { pairing: "garbage" as PairingState }, "CUSTODY_STATE_UNKNOWN", "state_out_of_domain"],
  ["cap state", { capState: "garbage" as CapState }, "CUSTODY_STATE_UNKNOWN", "state_out_of_domain"],
  ["report integrity", { reportIntegrity: "garbage" as CustodyLedgerReportIntegrity }, "CUSTODY_REPORT_MALFORMED", "report_integrity"],
];
for (const [label, patch, reason, signal] of ledgerOodAxes) {
  const v = evaluateCustodyLedger({ ...ledgerBase, ...patch });
  check(`custody-ledger: an out-of-domain runtime value on ${label} is held (step_up / ${reason}), never ready`,
    v.recommendedAction === "step_up" && v.reasonCode === reason && v.readyForCheckout === false && v.unknownSignals.includes(signal));
}
check("custody-ledger: the positive predicate does not disturb a real concern's reason (the phantom keeps its own reason)",
  evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "other" }).reasonCode === "CUSTODY_STALE_RETURN_OTHER");
const ledgerAdvisoryPlusGarbage = evaluateCustodyLedger({ ...ledgerBase, ledgerState: "checked_out", ledgerHolder: "requester", slotState: "absent", pairing: "garbage" as PairingState });
check("custody-ledger: the advisory beside an out-of-domain axis is HELD (step_up), never the advisory",
  ledgerAdvisoryPlusGarbage.recommendedAction === "step_up" && ledgerAdvisoryPlusGarbage.reasonCode === "CUSTODY_STATE_UNKNOWN" &&
  ledgerAdvisoryPlusGarbage.unknownSignals.includes("state_out_of_domain"));
const ledgerContainedPlusGarbage = evaluateCustodyLedger({ ...ledgerBase, capState: "cap_reached", pairing: "garbage" as PairingState });
check("custody-ledger: a containment beside an out-of-domain axis stays a containment with its own reason (the hold never weakens a restrict)",
  ledgerContainedPlusGarbage.recommendedAction === "restrict" && ledgerContainedPlusGarbage.reasonCode === "CUSTODY_CAP_REACHED" &&
  ledgerContainedPlusGarbage.unknownSignals.includes("state_out_of_domain"));
// The per-axis `unknown` branches must stay LIVE now that the positive predicate also holds
// those states under the same reason: each names ITS axis, never the backstop.
const ledgerUnknownAxisSignals: Array<[string, string]> = [
  ["ledger-unknown", "ledger_state"],
  ["holder-unknown", "ledger_holder"],
  ["slot-unknown", "slot_state"],
  ["pairing-unknown", "pairing"],
  ["cap-unknown", "cap_state"],
];
for (const [fixture, signal] of ledgerUnknownAxisSignals) {
  const v = L(fixture);
  check(`custody-ledger: the '${fixture}' hold names its own axis ('${signal}') and is NOT the out-of-domain backstop`,
    v.unknownSignals.includes(signal) && !v.unknownSignals.includes("state_out_of_domain"));
}
// The domain lists are the guard's allowlist — frozen at runtime; a mutation attempt must
// leave the hold in place. And EVERY exported array in the module namespace is frozen.
const ledgerDomainLists = [LEDGER_STATE_DOMAIN, LEDGER_HOLDER_DOMAIN, SLOT_STATE_DOMAIN, PAIRING_DOMAIN, CAP_STATE_DOMAIN, CUSTODY_LEDGER_INTEGRITY_DOMAIN];
check("custody-ledger: every exported domain list is frozen at runtime", ledgerDomainLists.every((d) => Object.isFrozen(d)));
let ledgerPushThrew = false;
try { (PAIRING_DOMAIN as unknown as string[]).push("garbage"); } catch { ledgerPushThrew = true; }
check("custody-ledger: pushing onto a domain list throws (strict mode) and does not widen it — the out-of-domain hold survives the attempt",
  ledgerPushThrew && PAIRING_DOMAIN.length === 3 && evaluateCustodyLedger({ ...ledgerBase, pairing: "garbage" as PairingState }).readyForCheckout === false);
const ledgerUnfrozenExports = Object.entries(rtlsCustodyModule).filter(([, v]) => Array.isArray(v) && !Object.isFrozen(v)).map(([k]) => k);
check(`custody-ledger: every exported array in the rtls-custody namespace is frozen (unfrozen: ${ledgerUnfrozenExports.join(", ") || "none"})`,
  ledgerUnfrozenExports.length === 0);
let ledgerKeysPushThrew = false;
try { (CUSTODY_LEDGER_REPORT_KEYS as unknown as string[]).push("vendor_note"); } catch { ledgerKeysPushThrew = true; }
check("custody-ledger: pushing onto the REPORT_KEYS allowlist throws and an unrecognized key still reads malformed",
  ledgerKeysPushThrew && CUSTODY_LEDGER_REPORT_KEYS.length === 7 &&
  normalizeCustodyLedger("w-18", "r", { ...ledgerGrantRaw, vendor_note: "anything" } as CustodyLedgerReportRaw).reportIntegrity === "malformed");
// The own-property read is the ONLY thing between a polluted Object.prototype and a full
// grant. Pollute, normalize {} and undefined, assert all-unknown and not ready, restore.
{
  const planted = { ...ledgerGrantRaw };
  const proto = Object.prototype as unknown as Record<string, unknown>;
  try {
    for (const [k, v] of Object.entries(planted)) Object.defineProperty(proto, k, { value: v, configurable: true, enumerable: false, writable: true });
    const pollutedEmpty = normalizeCustodyLedger("w-19", "r", {} as CustodyLedgerReportRaw);
    const pollutedAbsent = normalizeCustodyLedger("w-20", "r", undefined);
    check("custody-ledger: with Object.prototype polluted with every recognized key, an EMPTY report is all-unknown and never ready (own-property read is load-bearing)",
      pollutedEmpty.ledgerState === "unknown" && pollutedEmpty.slotState === "unknown" && pollutedEmpty.capState === "unknown" &&
      evaluateCustodyLedger(pollutedEmpty).readyForCheckout === false);
    check("custody-ledger: with Object.prototype polluted, an ABSENT report is all-unknown and never ready",
      pollutedAbsent.ledgerState === "unknown" && pollutedAbsent.capState === "unknown" && evaluateCustodyLedger(pollutedAbsent).readyForCheckout === false);
  } finally {
    for (const k of Object.keys(planted)) delete proto[k];
  }
}
check("custody-ledger evaluator is deterministic",
  JSON.stringify(evaluateCustodyLedger(ledgerBase)) === JSON.stringify(evaluateCustodyLedger(ledgerBase)));

// ── in-house audit follow-ups: the threads the mutators cannot see ─────────────────
// Every readEnum call site that passes `integrity` needs a present-but-non-string value on
// ITS slot asserting malformed — with only slot_state exercised, the integrity argument
// could be dropped from three call sites and the proof stayed green.
for (const slot of ["ledger_state", "ledger_holder", "pairing", "slot_state"] as const) {
  const n = normalizeCustodyLedger("w-int", "r", { ...ledgerGrantRaw, [slot]: 42 } as CustodyLedgerReportRaw);
  check(`custody-ledger: a non-string ${slot} marks the report MALFORMED and the reason is CUSTODY_REPORT_MALFORMED (the integrity thread is live on this slot)`,
    n.reportIntegrity === "malformed" && evaluateCustodyLedger(n).reasonCode === "CUSTODY_REPORT_MALFORMED");
  const v = normalizeCustodyLedger("w-vocab", "r", { ...ledgerGrantRaw, [slot]: "zzz" } as CustodyLedgerReportRaw);
  check(`custody-ledger: an out-of-vocabulary ${slot} stays CLEAN (silence, not an unreadable assertion) and the hold names the state, not the report`,
    v.reportIntegrity === "clean" && evaluateCustodyLedger(v).reasonCode === "CUSTODY_STATE_UNKNOWN");
}
// The prototype-walk bound is exact: 63 empty prototypes are within it, 64 are not.
// chainOf(n): the report at depth 0, then exactly n empty prototypes (the first is the
// base object literal), then Object.prototype — so the walk reaches depth n.
const chainOf = (n: number): object => { let o: object = {}; for (let i = 1; i < n; i += 1) o = Object.create(o); return Object.assign(Object.create(o), ledgerGrantRaw); };
check("custody-ledger: a report behind 63 empty prototypes is within the bound (clean, and still the grant)",
  evaluateCustodyLedger(normalizeCustodyLedger("w-63", "r", chainOf(63) as CustodyLedgerReportRaw)).readyForCheckout === true);
check("custody-ledger: a report behind 64 empty prototypes hits the bound (malformed) — the `>=` is load-bearing",
  normalizeCustodyLedger("w-64", "r", chainOf(64) as CustodyLedgerReportRaw).reportIntegrity === "malformed");
// Cap boundaries in the fail-closed direction: a cap of exactly 1 is a valid cap, and
// stale === open is a valid (fully stale) count — neither may read malformed.
check("custody-ledger cap: a cap of exactly 1 is valid (0 of 1 → under_cap, clean)", capOf(0, 1, 0)[0] === "under_cap" && capOf(0, 1, 0)[1] === "clean");
check("custody-ledger cap: stale returns equal to the open count is valid (1 of 1, all stale → cap_stale, clean)", capOf(1, 1, 1)[0] === "cap_stale" && capOf(1, 1, 1)[1] === "clean");
// Keys are matched exactly against the frozen allowlist; VALUES are trimmed and lowercased.
check("custody-ledger: a key in another spelling (Slot_State) is unrecognized → malformed; the same value in another case (' SEATED ') confirms",
  normalizeCustodyLedger("w-key", "r", { ...ledgerGrantRaw, slot_state: undefined, Slot_State: "seated" } as CustodyLedgerReportRaw).reportIntegrity === "malformed" &&
  normalizeCustodyLedger("w-val", "r", { ...ledgerGrantRaw, slot_state: " SEATED " }).slotState === "seated");
// The ledger-state mapping names its clear members and defaults to UNKNOWN: only
// "returned" and "none" read clear.
check("custody-ledger: exactly 'returned' and 'none' read clear; 'checked_out' does not; anything else is unknown",
  normalizeCustodyLedger("w-ls", "r", { ...ledgerGrantRaw, ledger_state: "returned" }).ledgerState === "clear" &&
  normalizeCustodyLedger("w-ls", "r", { ...ledgerGrantRaw, ledger_state: "none" }).ledgerState === "clear" &&
  normalizeCustodyLedger("w-ls", "r", { ...ledgerGrantRaw, ledger_state: "checked_out" }).ledgerState === "checked_out" &&
  normalizeCustodyLedger("w-ls", "r", { ...ledgerGrantRaw, ledger_state: "lost" }).ledgerState === "unknown");

// ── the RAW space: every adversarial value on every wire slot, through the real
// normalizer AND evaluator — the class the mutators cannot reach (ternaries, comparison
// flips, vocabulary edits). Every grant must normalize to the ONE confirmed tuple.
const ledgerRawDomains = {
  ledger_state: ["none", "returned", "checked_out", "zzz", 7, undefined],
  ledger_holder: ["none", "other", "requester", "zzz", 7, undefined],
  slot_state: ["seated", "absent", "zzz", 7, undefined],
  pairing: ["paired", "unpaired", "zzz", 7, undefined],
  open_checkouts: [1, "1", -1, undefined],
  checkout_cap: [3, 0, "3", undefined],
  stale_returns: [0, 2, "0", undefined],
} as const;
const ledgerRawRes = enumerateGrantSafety<CustodyLedgerReportRaw, CustodyLedgerVerdict>({
  domains: ledgerRawDomains,
  build: (c) => ({ ...c }) as CustodyLedgerReportRaw,
  evaluate: (raw) => evaluateCustodyLedger(normalizeCustodyLedger("raw", "r", raw)),
  actionOf: (v) => v.recommendedAction,
  // The honest wire shapes: a clear ledger in either spelling, no holder, seated, paired,
  // a valid count triple under the cap (1 of 3, none stale), every slot a real string/number.
  positivelyClean: (c) =>
    (c.ledger_state === "none" || c.ledger_state === "returned") && c.ledger_holder === "none" &&
    c.slot_state === "seated" && c.pairing === "paired" &&
    c.open_checkouts === 1 && c.checkout_cap === 3 && c.stale_returns === 0,
  confirmedWhenNone: (v) => v.readyForCheckout === true && v.reasonCode === "CUSTODY_CLEAR",
});
check(`custody-ledger RAW ENUMERATION: all ${ledgerRawRes.combos} raw reports swept (= product of the adversarial slot values)`,
  ledgerRawRes.combos === productOf(ledgerRawDomains) && ledgerRawRes.combos === 6 * 6 * 5 * 5 * 4 * 4 * 4);
check("custody-ledger RAW ENUMERATION: a grant is reachable ONLY by the honest wire shapes — zero mismatches", ledgerRawRes.mismatches === 0);
check("custody-ledger RAW ENUMERATION: exactly two raw reports grant — the two spellings of a clear ledger (non-vacuous)", ledgerRawRes.noneCount === 2);
const ledgerRawWrong = enumerateGrantSafety<CustodyLedgerReportRaw, CustodyLedgerVerdict>({
  domains: ledgerRawDomains,
  build: (c) => ({ ...c }) as CustodyLedgerReportRaw,
  evaluate: (raw) => evaluateCustodyLedger(normalizeCustodyLedger("raw", "r", raw)),
  actionOf: (v) => v.recommendedAction,
  positivelyClean: (c) => c.ledger_state === "none" && c.ledger_holder === "none" && c.slot_state === "seated" && c.pairing === "paired",
});
check("custody-ledger RAW NEGATIVE CONTROL: declaring the counts irrelevant is CAUGHT (mismatches > 0)",
  ledgerRawWrong.mismatches > 0 && typeof ledgerRawWrong.firstMismatch === "string");

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
console.log(`figures=custodyLedgerCombos=${ledgerRes.combos},custodyLedgerGrants=${ledgerRes.noneCount},custodyLedgerRawCombos=${ledgerRawRes.combos},custodyLedgerRawGrants=${ledgerRawRes.noneCount}`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
