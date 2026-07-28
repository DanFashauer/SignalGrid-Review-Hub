// Custody-beacon (asset-recovery) decision proof — fully OFFLINE and deterministic.
//
// This dimension is the INDEPENDENT, out-of-band recovery channel that still reports
// when every online custody signal (rtls, location, reachability, dock-state) has gone
// dark with the device. Its value is the FUSION of the beacon's zone reading with the
// device's reachability, which distinguishes the two cases the online signals collapse
// into one: in-zone + unreachable is benign (powered off in its bay); off-premises +
// dark is high-confidence removal. The grant (`none`) requires POSITIVE CONFIRMATION on
// every axis — in zone, reachable, fresh reading, clean parse.
import {
  CustodyBeaconConnector,
  CustodyBeaconConnectorError,
  createMockCustodyBeaconTransport,
  evaluateCustodyBeacon,
  guardReadOnly,
  normalizeReport,
  type CustodyBeaconReportRaw,
  type NormalizedCustodyBeacon,
} from "@workspace/integrations/custody-beacon";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Custody-beacon (asset-recovery) decision proof");

const ev = (r: CustodyBeaconReportRaw, id = "dev-1") => evaluateCustodyBeacon(normalizeReport(id, r));

// ── the fusion: zone × reachability ─────────────────────────────────────────────

const confirmed = ev({ zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" });
check("in zone + reachable + fresh → custody confirmed (the grant)", confirmed.recommendedAction === "none" && confirmed.reasonCode === "CUSTODY_CONFIRMED" && confirmed.custodyConfirmed === true);
check("...with no critical findings and no unknowns", confirmed.criticalFindings.length === 0 && confirmed.unknownSignals.length === 0);
check("...and removal is NOT suspected", confirmed.removalSuspected === false);

// THE key insight: unreachable is NOT alarming when the beacon still places the device in its bay.
const benign = ev({ zone: "in_custody_zone", reachability: "unreachable", freshness: "fresh" });
check("in zone + UNREACHABLE → monitor (benign: powered off in its bay), never an alarm", benign.recommendedAction === "monitor" && benign.reasonCode === "IN_ZONE_OFFLINE_BENIGN");
check("...and removal is NOT suspected (this is the fatigue the fabric must not create)", benign.removalSuspected === false);

// THE theft case: off premises AND dark.
const theft = ev({ zone: "off_premises", reachability: "unreachable" });
check("off premises + UNREACHABLE → escalate (highest-confidence removal)", theft.recommendedAction === "escalate" && theft.reasonCode === "OFF_PREMISES_DARK");
check("...and removal IS suspected (drives lost-mode/wipe + incident)", theft.removalSuspected === true);
check("...with the affirmative finding on the evidence trail", theft.criticalFindings.includes("off_premises_dark"));

const offReachable = ev({ zone: "off_premises", reachability: "reachable" });
check("off premises but REACHABLE → restrict (out and controllable — contain it)", offReachable.recommendedAction === "restrict" && offReachable.reasonCode === "OFF_PREMISES" && offReachable.removalSuspected === true);

const departing = ev({ zone: "departing", reachability: "reachable" });
check("departing + reachable → alert (attention, still online)", departing.recommendedAction === "alert" && departing.reasonCode === "DEPARTING");
const departingDark = ev({ zone: "departing", reachability: "unreachable" });
check("departing + unreachable → restrict (leaving and going dark)", departingDark.recommendedAction === "restrict" && departingDark.reasonCode === "DEPARTING_DARK");

// ── fail-closed on unknowns ───────────────────────────────────────────────────────

const unknownDark = ev({ zone: "unknown", reachability: "unreachable" });
check("unknown zone + unreachable → restrict (dark AND location unconfirmed)", unknownDark.recommendedAction === "restrict" && unknownDark.reasonCode === "LOCATION_UNKNOWN_DARK");
const unknownReachable = ev({ zone: "unknown", reachability: "reachable" });
check("unknown zone + reachable → step_up (online but location unconfirmed)", unknownReachable.recommendedAction === "step_up" && unknownReachable.reasonCode === "LOCATION_UNKNOWN");

const stale = ev({ zone: "in_custody_zone", reachability: "reachable", freshness: "stale" });
check("in zone + reachable but STALE reading → step_up (cannot confirm current location)", stale.recommendedAction === "step_up" && stale.reasonCode === "IN_ZONE_STALE");
const expired = ev({ zone: "in_custody_zone", reachability: "reachable", freshness: "expired" });
check("in zone + reachable but EXPIRED reading → step_up (stale claim never grants)", expired.recommendedAction === "step_up");
const noFreshness = ev({ zone: "in_custody_zone", reachability: "reachable" });
check("in zone + reachable but UNKNOWN freshness → step_up (freshness must be positively fresh)", noFreshness.recommendedAction === "step_up" && noFreshness.custodyConfirmed === false);

// The in-zone claim is only as good as its freshness ON EVERY ARM (review
// finding): the benign reading was trusted regardless of age, so an EXPIRED
// sighting on a DARK device — the exact shape of a theft that began after the
// beacon's last report — graded as the benign case.
const expiredDark = ev({ zone: "in_custody_zone", reachability: "unreachable", freshness: "expired" });
check("EXPIRED in-zone sighting + DARK device → restrict (epistemically location-unknown-dark, never 'benign')",
  expiredDark.recommendedAction === "restrict" && expiredDark.reasonCode === "LOCATION_UNKNOWN_DARK" && expiredDark.criticalFindings.includes("location_unknown_dark"));
const staleDark = ev({ zone: "in_custody_zone", reachability: "unreachable", freshness: "stale" });
check("STALE in-zone sighting + dark device → step_up (cannot confirm still in place)",
  staleDark.recommendedAction === "step_up" && staleDark.reasonCode === "IN_ZONE_STALE");
const freshUnknownReach = ev({ zone: "in_custody_zone", reachability: "unknown", freshness: "fresh" });
check("FRESH in-zone sighting + reachability unknown → monitor (the benign case requires the fresh sighting)",
  freshUnknownReach.recommendedAction === "monitor" && freshUnknownReach.reasonCode === "IN_ZONE_OFFLINE_BENIGN");

const uncovered = evaluateCustodyBeacon(normalizeReport("d", { zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" }), { covered: false });
check("no beacon reading returned for the device (covered=false) → step_up, never a confirmation", uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── malformed / hostile report shapes ───────────────────────────────────────────

const malformedEnum = normalizeReport("m", { zone: "in_custody_zone", reachability: "reachable", freshness: "fresh", extra: 1 } as CustodyBeaconReportRaw);
// The refusal must come from the INTEGRITY branch itself (REPORT_MALFORMED), not
// merely from the grant backstop happening to catch it — a malformed report whose
// fields all parse valid is exactly the state only the integrity branch can name.
check("an unrecognized key marks the report malformed and refuses AS malformed (not via the backstop)",
  malformedEnum.reportIntegrity === "malformed" && evaluateCustodyBeacon(malformedEnum).reasonCode === "REPORT_MALFORMED" && evaluateCustodyBeacon(malformedEnum).recommendedAction !== "none");
// Per-field integrity: each asserted-but-unparseable field must mark the report
// MALFORMED on its own (one junk field per report — several at once would let one
// integrity term hide behind another, the unfalsifiability this guard exists to catch).
const junkEnum = ev({ zone: "somewhere", reachability: "reachable", freshness: "fresh" });
check("junk zone alone → malformed, cannot grant",
  normalizeReport("jz", { zone: "somewhere", reachability: "reachable", freshness: "fresh" }).reportIntegrity === "malformed" && junkEnum.recommendedAction !== "none");
check("junk freshness alone → malformed",
  normalizeReport("jf", { zone: "in_custody_zone", reachability: "reachable", freshness: "soon" }).reportIntegrity === "malformed");
check("junk reachability alone → malformed",
  normalizeReport("jr", { zone: "in_custody_zone", reachability: "maybe", freshness: "fresh" }).reportIntegrity === "malformed");
const inherited = evaluateCustodyBeacon(normalizeReport("i", Object.create({ zone: "in_custody_zone" }) as CustodyBeaconReportRaw));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const protoAlias = normalizeReport("pa", Object.assign(Object.create({ zone: "in_custody_zone" }), { zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" }) as CustodyBeaconReportRaw);
check("an unrecognized key inherited from the prototype is caught too", protoAlias.reportIntegrity === "malformed");
const hidden = new Proxy({ zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as CustodyBeaconReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant", evaluateCustodyBeacon(normalizeReport("px", hidden)).recommendedAction !== "none");
const throwing = new Proxy({ zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" }, { ownKeys: () => { throw new Error("hostile"); } }) as CustodyBeaconReportRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluateCustodyBeacon(normalizeReport("tk", throwing)).recommendedAction !== "none");
const throwingAccessor = { reachability: "reachable", freshness: "fresh" } as CustodyBeaconReportRaw;
Object.defineProperty(throwingAccessor, "zone", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try { check("a throwing ACCESSOR fails closed to malformed without an exception", normalizeReport("ta", throwingAccessor).reportIntegrity === "malformed" && evaluateCustodyBeacon(normalizeReport("ta2", throwingAccessor)).recommendedAction !== "none"); }
catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError", normalizeReport("s", "boom" as unknown as CustodyBeaconReportRaw).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", Object.prototype as CustodyBeaconReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError", normalizeReport("n", null as unknown as CustodyBeaconReportRaw).reportIntegrity === "malformed");
check("case and whitespace are canonicalized, not rejected", normalizeReport("cw", { zone: " IN_CUSTODY_ZONE " } as CustodyBeaconReportRaw).zone === "in_custody_zone");

// ── exhaustive (normalized): the grant requires every axis positively confirmed ──
const normDomains = {
  zone: ["in_custody_zone", "departing", "off_premises", "unknown"],
  freshness: ["fresh", "stale", "expired", "unknown"],
  reachability: ["reachable", "unreachable", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedCustodyBeacon => ({
  sourceSystem: "custody-beacon", deviceRef: "enum", source: "enum",
  zone: c.zone as NormalizedCustodyBeacon["zone"],
  freshness: c.freshness as NormalizedCustodyBeacon["freshness"],
  reachability: c.reachability as NormalizedCustodyBeacon["reachability"],
  reportIntegrity: c.reportIntegrity as NormalizedCustodyBeacon["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluateCustodyBeacon,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.custodyConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.zone === "in_custody_zone" && c.reachability === "reachable" && c.freshness === "fresh" && c.reportIntegrity === "clean",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, custody is confirmed ONLY when in-zone + reachable + fresh + clean (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 96,
);
check("exhaustive (normalized): exactly ONE state grants", normRes.noneCount === 1);

// ── exhaustive (raw wire): the normalizer + evaluator on hostile input ───────────
const rawDomains = {
  zone: ["in_custody_zone", "off_premises", undefined, null, "gone", 1],
  freshness: ["fresh", "stale", undefined, "soon"],
  reachability: ["reachable", "unreachable", undefined, "maybe"],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedCustodyBeacon => {
  const { __alias, ...wire } = c;
  const raw = { ...wire } as CustodyBeaconReportRaw;
  if (__alias === "present") raw.last_seen = "x";
  return normalizeReport("enum", raw, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluateCustodyBeacon,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.custodyConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" && c.zone === "in_custody_zone" && c.freshness === "fresh" && c.reachability === "reachable",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw readings — junk enums, nulls, numbers, an aliased key — custody is confirmed only on the fully-clean in-zone/fresh/reachable reading (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 192,
);
check("exhaustive (raw wire): exactly ONE raw reading grants", rawRes.noneCount === 1);

// ── connector surface (mutation-guard coverage: every guard falsifiable) ────────
let cbReadOnly = false;
try { guardReadOnly("POST"); } catch (err) { cbReadOnly = err instanceof CustodyBeaconConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", cbReadOnly);
const cbConn = new CustodyBeaconConnector(
  { accessToken: "t", baseUrl: "https://beacon.example" },
  createMockCustodyBeaconTransport({ readings: { "dev-9": { zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" } } }),
);
check("the connector round-trip normalizes a clean reading end to end (grantable)",
  evaluateCustodyBeacon(await cbConn.fetchNormalized("dev-9")).recommendedAction === "none");
check("an unknown device yields an all-unknown reading that cannot grant",
  evaluateCustodyBeacon(await cbConn.fetchNormalized("dev-unknown")).recommendedAction !== "none");
// The prototype walk must be BOUNDED, not trusted: a chain of >64 empty prototypes
// under an otherwise-clean report must read as malformed — without the depth bound
// the walk would end quietly at Object.prototype and the report would read clean.
let cbDeepProto: object = {};
for (let i = 0; i < 100; i += 1) cbDeepProto = Object.create(cbDeepProto);
const cbDeepReport = Object.assign(Object.create(cbDeepProto), { zone: "in_custody_zone", reachability: "reachable", freshness: "fresh" });
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", cbDeepReport as CustodyBeaconReportRaw).reportIntegrity === "malformed");

// Determinism.
const d1 = normalizeReport("det", { zone: "off_premises", reachability: "unreachable" });
check("evaluator is deterministic", JSON.stringify(evaluateCustodyBeacon(d1)) === JSON.stringify(evaluateCustodyBeacon(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},zones=4,ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
