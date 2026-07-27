// Link-usability proof — fully OFFLINE and deterministic.
//
// Drives the read-only link-usability connector against captured wireless-controller
// reports and runs the pure evaluator per device. The fabric already asks whether a
// device was ADMITTED to the network (`network-nac`: 802.1X state, segment, NAC policy,
// which AP). It has never asked whether the link that admission produced is actually
// carrying traffic — and on shared frontline fleets that is the failure people actually
// hit: a handheld moves between access points, the association survives, and nothing
// gets through. The client shows connected. The console shows connected. The
// transactions time out.
//
// That matters to a TRUST fabric and not just to a helpdesk, because every other
// dimension grants on freshness. `device-management-health` requires
// managementReachable===true; `agent-identity` requires bridgeReachable===true. A bridge
// answering over a link like this returns a stale read wearing a fresh timestamp.
//
// The severity inversion below is the point and is asserted rather than assumed: an
// ASSOCIATED link the bridge affirmatively reports is carrying nothing alerts, ABOVE a
// device that is plainly not associated. The honest failure is the safer one — the
// fabric can see it. The quiet one keeps manufacturing fresh-looking confirmations.
//
// It also proves the fabric fuses this dimension: fromLinkUsability → a link_usability
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LINK_USABILITY_REPORT_KEYS,
  LinkUsabilityConnector,
  LinkUsabilityConnectorError,
  createMockLinkUsabilityTransport,
  evaluateLinkUsability,
  guardReadOnly,
  normalizeReport,
  resolveLinkUsabilityConnector,
  type LinkUsabilityReportRaw,
  type NormalizedLinkUsability,
} from "@workspace/integrations/link-usability";
import { composeDeviceRisk, fromLinkUsability } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  linkUsable: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: LinkUsabilityReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/link-usability/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://wlan-bridge.local/link-usability";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Link-usability proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, LinkUsabilityReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockLinkUsabilityTransport({ reports, expectedToken: fixture.accessToken });
const connector = new LinkUsabilityConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchLink(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "link-usability");
  const v = evaluateLinkUsability(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.linkUsable === spec.expected.linkUsable &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── link-usability invariants ──────────────────────────────────────────────────

const usable = evaluateLinkUsability(await connector.fetchLink(fixture.devices["link-usable"].deviceId));
check("a link confirmed on all six counts → link_carrying_traffic/none", usable.posture === "link_carrying_traffic" && usable.recommendedAction === "none" && usable.linkUsable === true);
check("a usable link composes to the 'ok' tier", composeDeviceRisk([fromLinkUsability(usable)]).riskTier === "ok");
// `basic` roaming is a FACT about the site, not a defect. A dimension that penalised
// every fleet without 802.11r would be reporting an architecture preference as a risk.
const basicRoam = evaluateLinkUsability(await connector.fetchLink(fixture.devices["link-usable-basic-roaming"].deviceId));
check("a fleet roaming WITHOUT 802.11r still grants — capability is context, not a defect", basicRoam.linkUsable === true);
// A wired cart or single-AP site has no roaming domain at all, positively asserted.
const noRoamDomain = evaluateLinkUsability(await connector.fetchLink(fixture.devices["link-usable-no-roaming-domain"].deviceId));
check("a device with NO roaming domain (wired, single-AP) grants — not_applicable is an assertion", noRoamDomain.linkUsable === true);

// ── the case this dimension exists for ────────────────────────────────────────
//
// Associated, and the bridge affirmatively reports that no rung above association
// completed. Wireless dashboards report the ladder as separate rungs — failed
// association, failed authentication, failed DHCP, failed DNS — which is exactly the
// primitive needed to tell "connected" from "working".
const quiet = evaluateLinkUsability(await connector.fetchLink(fixture.devices["associated-but-not-carrying-traffic"].deviceId));
check("ASSOCIATED with nothing getting through → alert + a critical finding (a fact, not a gap)", quiet.recommendedAction === "alert" && quiet.posture === "associated_not_usable" && quiet.criticalFindings.includes("associated_but_not_carrying_traffic"));
check("...and it never composes to 'ok'", composeDeviceRisk([fromLinkUsability(quiet)]).riskTier !== "ok");
const absent = evaluateLinkUsability(await connector.fetchLink(fixture.devices["not-associated"].deviceId));
check("a device plainly NOT associated is graded step_up — the honest failure", absent.recommendedAction === "step_up" && absent.posture === "link_absent");
// An ASSERTED "not on the network" with the progress ladder silent — an ordinary shape
// when a controller simply has no client entry. This reported a generic
// LINK_STATE_UNKNOWN until review measured the branch: its guard was satisfied 360 times
// across the normalized space and its candidate won ZERO times, because the ladder's
// `unknown` had already pushed at the same severity and won the tie by being first. A
// confirmed fact suppressed by a gap, which is the inversion this evaluator forbids for
// `controllerReachable === false` forty lines earlier. Same principle, now applied to
// both asserted negatives.
const absentLadderSilent = evaluateLinkUsability(await connector.fetchLink(fixture.devices["not-associated-with-ladder-silent"].deviceId));
check("an ASSERTED 'not associated' with the ladder SILENT names itself, it is not buried by the gap", absentLadderSilent.reasonCode === "NOT_ASSOCIATED" && absentLadderSilent.posture === "link_absent");
check("...and the gap is still reported alongside it", absentLadderSilent.unknownSignals.includes("link_progress"));
// The `!== \"not_associated\"` clause stops a device absent on BOTH fields raising the
// same finding twice — load-bearing now that association is judged first.
check("a device absent on BOTH fields raises NOT_ASSOCIATED once, not twice", absent.unknownSignals.length === 0 && absent.criticalFindings.length === 0);
// Finding 7: association state was the one field with no unreported fixture, which is
// why deleting its unknownSignals push left the proof green.
const assocUnreported = evaluateLinkUsability(await connector.fetchLink(fixture.devices["association-unreported"].deviceId));
check("an UNREPORTED association state is a gap that denies, and is named in unknownSignals", assocUnreported.reasonCode === "LINK_STATE_UNKNOWN" && assocUnreported.unknownSignals.includes("association_state"));
// The inversion, asserted. A device that is visibly offline is safe to reason about;
// one that reports connected while carrying nothing keeps manufacturing fresh-looking
// confirmations for every other dimension that grants on reachability.
check("SEVERITY INVERSION: 'associated but carrying nothing' outranks 'not associated at all'", quiet.recommendedAction === "alert" && absent.recommendedAction === "step_up");
const dhcp = evaluateLinkUsability(await connector.fetchLink(fixture.devices["dhcp-failing"].deviceId));
const dns = evaluateLinkUsability(await connector.fetchLink(fixture.devices["dns-failing"].deviceId));
check("a link failing at DHCP names the rung it failed at", dhcp.reasonCode === "DHCP_FAILING" && dhcp.recommendedAction === "alert");
check("a link failing at DNS names the rung it failed at", dns.reasonCode === "DNS_FAILING" && dns.recommendedAction === "alert");

// ── roaming behaviour: works now, predicts it will not ────────────────────────
const sticky = evaluateLinkUsability(await connector.fetchLink(fixture.devices["roam-sticky"].deviceId));
check("a STICKY client (holding a weak AP while a stronger one is available) → step_up", sticky.reasonCode === "ROAM_STICKY" && sticky.posture === "roaming_unstable");
const flapping = evaluateLinkUsability(await connector.fetchLink(fixture.devices["roam-excessive"].deviceId));
check("a FLAPPING client is the opposite pathology and is named separately", flapping.reasonCode === "ROAM_EXCESSIVE");
const stickyWorking = evaluateLinkUsability(await connector.fetchLink(fixture.devices["sticky-but-still-working"].deviceId));
check("a sticky client that is STILL carrying traffic does not grant — the link works now, not next aisle", stickyWorking.linkUsable === false && stickyWorking.recommendedAction === "step_up");
const degraded = evaluateLinkUsability(await connector.fetchLink(fixture.devices["latency-degraded"].deviceId));
check("DEGRADED latency (banded by the bridge, never by a threshold invented here) → step_up", degraded.reasonCode === "LINK_LATENCY_DEGRADED");
// The connector deliberately carries no millisecond figure and no threshold: what counts
// as degraded is a property of the site and the workload. A number invented here would
// be a fabricated fact dressed as a measurement.
check("the normalized shape carries a latency CLASS, never a fabricated millisecond threshold", !Object.keys(await connector.fetchLink(fixture.devices["latency-degraded"].deviceId)).some((k) => /ms|millis|threshold/i.test(k)));

// ── unknowns deny, and reachability is asserted vs unreported ─────────────────
const capUnreported = evaluateLinkUsability(await connector.fetchLink(fixture.devices["roam-capability-unreported"].deviceId));
check("roam capability is not GRADED, but it must be REPORTED — silence denies", capUnreported.reasonCode === "LINK_STATE_UNKNOWN" && capUnreported.unknownSignals.includes("roam_capability"));
const ctrlFalse = evaluateLinkUsability(await connector.fetchLink(fixture.devices["controller-unreachable"].deviceId));
check("an explicit controllerReachable:false → step_up, never granted", ctrlFalse.reasonCode === "CONTROLLER_UNREACHABLE" && ctrlFalse.linkUsable === false);
const ctrlNull = evaluateLinkUsability(await connector.fetchLink(fixture.devices["controller-unreported"].deviceId));
check("an UNREPORTED controller reachability is a gap and also denies", ctrlNull.reasonCode === "CONTROLLER_UNREACHABLE" && ctrlNull.unknownSignals.includes("controller_reachable"));
// An asserted negative must not lose a step_up tie to a generic unknown from one
// unreadable field — the ordering mistake found by review in the sibling connector.
const assertedUnreachable = evaluateLinkUsability(await connector.fetchLink(fixture.devices["unreachable-outranks-an-unknown-field"].deviceId));
check("an ASSERTED 'the controller did not answer' outranks a generic unknown from another field", assertedUnreachable.reasonCode === "CONTROLLER_UNREACHABLE");

// ── self-contradictory reports ────────────────────────────────────────────────
//
// A device reported NOT associated cannot simultaneously have reached a rung above
// association, and one reported associated cannot be at the `not_associated` rung. Both
// directions are covered, and each contradictory pair has its own fixture — the sibling
// connector shipped a guard where two of three terms were unfalsifiable, and mutation
// testing was what found it.
for (const [name, label] of [
  ["inconsistent-absent-yet-carrying", "carrying traffic"],
  ["inconsistent-absent-yet-associated-only", "associated-only"],
  ["inconsistent-absent-yet-dhcp-failing", "failing at DHCP"],
  ["inconsistent-absent-yet-dns-failing", "failing at DNS"],
] as const) {
  const v = evaluateLinkUsability(await connector.fetchLink(fixture.devices[name].deviceId));
  check(`'not associated' + '${label}' is self-contradictory → step_up, never a grant`, v.reasonCode === "LINK_REPORT_INCONSISTENT" && v.linkUsable === false);
}
const reverseInconsistent = evaluateLinkUsability(await connector.fetchLink(fixture.devices["inconsistent-associated-yet-absent"].deviceId));
check("the reverse direction ('associated' + 'not associated' rung) is caught too", reverseInconsistent.reasonCode === "LINK_REPORT_INCONSISTENT");
// The SECOND contradiction relation, in the same six fields, missed by the first draft
// and found by adversarial review. `roamCapability: not_applicable` asserts there is NO
// roaming domain; `roamHealth` reports observed roaming BEHAVIOUR. A report claiming both
// is self-contradictory in exactly the way association-versus-progress is — and three of
// the six shapes that granted were incoherent in precisely this way.
for (const label of ["stable", "sticky", "excessive"] as const) {
  const v = evaluateLinkUsability(await connector.fetchLink(fixture.devices[`inconsistent-no-roam-domain-yet-${label}`].deviceId));
  check(`'no roaming domain' + observed roaming '${label}' is self-contradictory → step_up, never a grant`, v.reasonCode === "LINK_REPORT_INCONSISTENT" && v.linkUsable === false);
}
const roamMirror = evaluateLinkUsability(await connector.fetchLink(fixture.devices["inconsistent-roaming-capable-yet-no-behaviour"].deviceId));
check("the mirror — a live roaming capability with NO behaviour to report — is caught too", roamMirror.reasonCode === "LINK_REPORT_INCONSISTENT");
check("...and the disbelieved roam claim is not cited", roamMirror.unknownSignals.includes("roam_report_consistency") && roamMirror.criticalFindings.length === 0);
// Why this mattered beyond taxonomy: roamCapability is deliberately not graded, so
// `not_applicable` was a free pass through the only check that field has — and it is
// exactly the value a bridge hardcodes for "we do not model this". It is the nearest
// thing to `unknown` on the wire while being the one spelling that granted, which
// inverted this dimension's own rule that silence denies.
const freePass = normalizeReport("fp", { associationState: "associated", linkProgress: "carrying_traffic", roamCapability: "not_applicable", roamHealth: "stable", linkLatencyClass: "nominal", controllerReachable: true });
check("a bridge hardcoding roamCapability 'not_applicable' beside live behaviour no longer grants", evaluateLinkUsability(freePass).linkUsable === false);
// The disbelieved half is not judged AT ALL — a dimension does not get to disbelieve a
// claim and cite it in the same breath. This is carried in from a review finding on
// device-management-health rather than rediscovered the same way.
const disbelieved = evaluateLinkUsability(await connector.fetchLink(fixture.devices["inconsistent-absent-yet-dns-failing"].deviceId));
check("...and the disbelieved claim is NOT cited as a confirmed fact", disbelieved.criticalFindings.length === 0 && disbelieved.recommendedAction === "step_up");

// No link result at all → a gap → step_up (never a usable-link grant).
const noCov = evaluateLinkUsability(normalizeReport("ghost", {}), { covered: false });
check("an uncovered device is 'unknown'/step_up, never a usable link", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.linkUsable === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromLinkUsability(noCov)]).riskTier !== "ok");

// ── report integrity + hostile shapes ─────────────────────────────────────────
//
// Every shape below is built from CLEAN_WIRE — a report that DOES grant when passed
// through untouched — so each check isolates exactly the hostile property it names. If
// the base stopped granting they would pass vacuously, so it is asserted first.
const CLEAN_WIRE = {
  associationState: "associated", linkProgress: "carrying_traffic",
  roamCapability: "fast_transition", roamHealth: "stable",
  linkLatencyClass: "nominal", controllerReachable: true,
} as const;
check("the base wire report used by the hostile-shape checks below DOES grant (they are not vacuous)", evaluateLinkUsability(normalizeReport("cw", { ...CLEAN_WIRE })).recommendedAction === "none");
const malformed = await connector.fetchLink(fixture.devices["report-malformed-enum"].deviceId);
check("an unparseable enum value marks the report malformed", malformed.reportIntegrity === "malformed" && malformed.roamHealth === "unknown");
const malformedBool = await connector.fetchLink(fixture.devices["report-malformed-boolean"].deviceId);
check("a string-quoted boolean is an assertion, not silence", malformedBool.reportIntegrity === "malformed" && malformedBool.controllerReachable === null);
const aliased = await connector.fetchLink(fixture.devices["report-aliased-keys"].deviceId);
check("an unrecognized key means the envelope was not understood", aliased.reportIntegrity === "malformed");
check("...and a malformed report never grants, even when every parsed field looks clean", evaluateLinkUsability(aliased).recommendedAction === "step_up" && evaluateLinkUsability(aliased).linkUsable === false);
const inherited = normalizeReport("inh", Object.create({ ...CLEAN_WIRE }) as LinkUsabilityReportRaw);
check("a report with ZERO own keys asserts nothing — every field falls to unknown", inherited.associationState === "unknown" && inherited.linkProgress === "unknown" && inherited.controllerReachable === null);
check("...and therefore cannot grant", evaluateLinkUsability(inherited).recommendedAction !== "none");
const aliasOnProto = Object.assign(Object.create({ roam_health: "sticky" }), CLEAN_WIRE) as LinkUsabilityReportRaw;
check("an unrecognized key INHERITED from the prototype is still an unrecognized envelope", normalizeReport("ap", aliasOnProto).reportIntegrity === "malformed");
const { roamHealth: _hoisted, ...restOfClean } = CLEAN_WIRE;
const knownOnProto = Object.assign(Object.create({ roamHealth: "stable" }), restOfClean) as LinkUsabilityReportRaw;
check("a RECOGNIZED key inherited from the prototype is an unrecognized envelope too", normalizeReport("kp", knownOnProto).reportIntegrity === "malformed");
check("...and cannot grant", evaluateLinkUsability(normalizeReport("kp", knownOnProto)).recommendedAction !== "none");
const symbolKeyed = Object.assign({}, CLEAN_WIRE) as LinkUsabilityReportRaw;
(symbolKeyed as Record<symbol, unknown>)[Symbol.for("roamHealth")] = "sticky";
check("a SYMBOL-keyed assertion is an unrecognized envelope", normalizeReport("sym", symbolKeyed).reportIntegrity === "malformed");
const throwingKeys = new Proxy({ ...CLEAN_WIRE }, { ownKeys: () => { throw new Error("hostile"); } }) as LinkUsabilityReportRaw;
check("a Proxy that THROWS from ownKeys fails closed, it does not grant", evaluateLinkUsability(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
const endlessProto = (): object => new Proxy({}, { getPrototypeOf: () => endlessProto(), ownKeys: () => [] });
check("a Proxy with an endless prototype chain terminates and fails closed", normalizeReport("ep", endlessProto() as LinkUsabilityReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not an untyped TypeError", normalizeReport("nb", null as unknown as LinkUsabilityReportRaw).reportIntegrity === "malformed");
check("an ARRAY report is malformed, never a grant", normalizeReport("arr", [] as unknown as LinkUsabilityReportRaw).reportIntegrity === "malformed");
const notAnObject = normalizeReport("s", "ERR: dashboard timeout" as unknown as LinkUsabilityReportRaw);
check("a non-object report is malformed, not a thrown TypeError", notAnObject.reportIntegrity === "malformed" && evaluateLinkUsability(notAnObject).recommendedAction !== "none");
const hidden = new Proxy({ ...CLEAN_WIRE, roam_health: "sticky" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as LinkUsabilityReportRaw;
check("a Proxy that hides BOTH its keys and its descriptors reads as ABSENT and cannot grant", evaluateLinkUsability(normalizeReport("px", hidden)).recommendedAction !== "none");
// The honest limit, asserted rather than only described: a Proxy that hides a key from
// ownKeys while still answering getOwnPropertyDescriptor keeps its values readable, so
// the scan sees nothing and it grants. A Proxy can always lie about its own shape.
const hidesKeysOnly = new Proxy({ ...CLEAN_WIRE, roam_health: "sticky" }, { ownKeys: () => [...LINK_USABILITY_REPORT_KEYS] }) as LinkUsabilityReportRaw;
check("KNOWN LIMIT: a Proxy that hides only its KEYS keeps its values and does grant", evaluateLinkUsability(normalizeReport("pk", hidesKeysOnly)).recommendedAction === "none");
// A report that IS Object.prototype was never scanned in the sibling connector, because
// the walk's stop condition conflated the chain terminus with the report.
const pollutionKeys = Object.keys(CLEAN_WIRE) as (keyof typeof CLEAN_WIRE)[];
for (const k of pollutionKeys) (Object.prototype as Record<string, unknown>)[k] = CLEAN_WIRE[k];
const asPrototype = normalizeReport("op", Object.prototype as LinkUsabilityReportRaw);
for (const k of pollutionKeys) delete (Object.prototype as Record<string, unknown>)[k];
check("a report that IS Object.prototype is malformed — the chain terminus is not the report", asPrototype.reportIntegrity === "malformed");
check("...and a polluted prototype passed as the report cannot grant", evaluateLinkUsability(asPrototype).recommendedAction !== "none");
// An own ACCESSOR that throws must land where every unreadable report lands.
const throwingAccessor = Object.defineProperty({ ...CLEAN_WIRE }, "roamHealth", {
  get() { throw new Error("hostile accessor"); }, enumerable: true, configurable: true,
}) as LinkUsabilityReportRaw;
let accessorThrew = false;
let accessorNormalized: NormalizedLinkUsability | null = null;
try { accessorNormalized = normalizeReport("ta", throwingAccessor); } catch { accessorThrew = true; }
check("an own accessor that THROWS does not escape the normalizer as an untyped Error", accessorThrew === false);
check("...it is malformed and cannot grant", accessorNormalized?.reportIntegrity === "malformed" && evaluateLinkUsability(accessorNormalized!).recommendedAction !== "none");
check("a plain parsed-JSON report is NOT flagged by the prototype walk", normalizeReport("j", JSON.parse('{"roamHealth":"stable"}') as LinkUsabilityReportRaw).reportIntegrity === "clean");
// JSON null is the wire spelling of "no value", not an unreadable assertion.
const nulls = normalizeReport("nl", { associationState: null, linkProgress: null, roamCapability: null, roamHealth: null, linkLatencyClass: null, controllerReachable: null } as LinkUsabilityReportRaw);
check("JSON null on every field behaves as ABSENT, not as malformed", nulls.reportIntegrity === "clean" && nulls.associationState === "unknown");
check("...and still never grants, because nothing was positively confirmed", evaluateLinkUsability(nulls).recommendedAction === "step_up");
// Defence in depth: the evaluator refuses independently of the normalizer.
const forged = evaluateLinkUsability({
  sourceSystem: "link-usability", deviceId: "forged", source: "test",
  associationState: "associated", linkProgress: "carrying_traffic", roamCapability: "fast_transition",
  roamHealth: "stable", linkLatencyClass: "nominal", controllerReachable: true, reportIntegrity: "malformed",
});
check("the EVALUATOR independently refuses a malformed report, even a fully clean-looking one", forged.recommendedAction === "step_up" && forged.linkUsable === false);
// Case and whitespace are canonicalized, so a shouty bridge is understood, not rejected.
const shouty = normalizeReport("sh", { associationState: " ASSOCIATED ", linkProgress: "Carrying_Traffic", roamHealth: "Stable" });
check("case/whitespace variants are canonicalized, not treated as malformed", shouty.reportIntegrity === "clean" && shouty.associationState === "associated" && shouty.linkProgress === "carrying_traffic");

// ── exhaustive, in THREE passes over two DIFFERENT spaces ─────────────────────
//
// The grant contract, stated once as an independent positive whitelist rather than as
// the negation of any guard in the implementation, so a guard that silently lost a
// condition still fails here.
const linkClean = (c: Record<string, unknown>): boolean =>
  c.associationState === "associated" &&
  c.linkProgress === "carrying_traffic" &&
  // Coherent roam PAIRS, not an independent product of the two fields. A live roaming
  // domain reports stable behaviour; no roaming domain reports no behaviour. The first
  // draft treated these as independent and admitted three incoherent combinations.
  ((c.roamCapability === "fast_transition" && c.roamHealth === "stable") ||
    (c.roamCapability === "basic" && c.roamHealth === "stable") ||
    (c.roamCapability === "not_applicable" && c.roamHealth === "not_applicable")) &&
  c.linkLatencyClass === "nominal" &&
  c.controllerReachable === true;

/** The full contradiction relation, stated independently of the evaluator's guard. */
const linkContradictory = (assoc: unknown, progress: unknown): boolean =>
  (assoc === "not_associated" &&
    (progress === "carrying_traffic" || progress === "dns_failing" || progress === "dhcp_failing" || progress === "associated_only")) ||
  (assoc === "associated" && progress === "not_associated");

/** The roam contradiction relation, stated independently of the evaluator's guard. */
const roamContradictory = (cap: unknown, health: unknown): boolean =>
  (cap === "not_applicable" && (health === "stable" || health === "sticky" || health === "excessive")) ||
  ((cap === "fast_transition" || cap === "basic") && health === "not_applicable");

// Pass 1 — the NORMALIZED space (including reportIntegrity) against the evaluator alone.
const domains = {
  associationState: ["associated", "not_associated", "unknown"],
  linkProgress: ["carrying_traffic", "dns_failing", "dhcp_failing", "associated_only", "not_associated", "unknown"],
  roamCapability: ["fast_transition", "basic", "not_applicable", "unknown"],
  roamHealth: ["stable", "sticky", "excessive", "not_applicable", "unknown"],
  linkLatencyClass: ["nominal", "degraded", "unknown"],
  controllerReachable: [true, false, null],
  reportIntegrity: ["clean", "malformed"],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) => ({ sourceSystem: "link-usability", deviceId: "enum", source: "enum", ...c }) as NormalizedLinkUsability,
  evaluate: evaluateLinkUsability,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.linkUsable === true &&
    v.posture === "link_carrying_traffic" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  positivelyClean: (c) => c.reportIntegrity === "clean" && linkClean(c),
});
check(
  `exhaustive (normalized): over all ${enumRes.combos} normalized states, action 'none' requires ALL SIX positively confirmed and a clean report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 6480,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);
// Six: three roam capabilities × two roam-health shapes (stable, or no roaming domain).
// Pinning the count is what makes a seventh route into the grant a test failure rather
// than a silent widening.
check("exhaustive (normalized): exactly THREE shapes grant — one per COHERENT roam pair, down from six once the roam contradiction was modelled", enumRes.noneCount === 3);
// Grant-ness is not the only thing worth pinning. `linkUsable` is a separate field, and
// nothing previously stopped it drifting away from `action === "none"` — mutation E38
// (widening it to accept `monitor`) survived, because no candidate happens to emit
// `monitor`. Asserted directly over the whole normalized space instead.
let usableDisagreements = 0;
let reachableActions = new Set<string>();
const dKeys = Object.keys(domains);
const walkNorm = (i: number, acc: Record<string, unknown>): void => {
  if (i === dKeys.length) {
    const v = evaluateLinkUsability({ sourceSystem: "link-usability", deviceId: "n", source: "n", ...acc } as NormalizedLinkUsability);
    reachableActions.add(v.recommendedAction);
    if (v.linkUsable !== (v.recommendedAction === "none")) usableDisagreements += 1;
    return;
  }
  for (const val of domains[dKeys[i] as keyof typeof domains]) walkNorm(i + 1, { ...acc, [dKeys[i]]: val });
};
walkNorm(0, {});
check(`exhaustive (normalized): linkUsable agrees with action === 'none' on every one of the ${enumRes.combos} states (disagreements=${usableDisagreements})`, usableDisagreements === 0);
check(`exhaustive (normalized): only none/step_up/alert are reachable — the wider ladder type is shared, not all of it used (reachable=${[...reachableActions].sort().join("/")})`, reachableActions.size === 3 && reachableActions.has("none") && reachableActions.has("step_up") && reachableActions.has("alert"));

// Pass 2 — the RAW WIRE space, carrying the MALFORMED values a real bridge emits. Built
// only from well-formed values, `normalizeReport` would be the identity function here
// and the pass would prove nothing about the parse layer. `__alias` is a build-time
// toggle, not a wire field: without it the unrecognized-key branch of the integrity
// check would be load-bearing and structurally unreachable by this enumeration.
//
// Every enum field carries the same wire CLASSES — allowed spellings, an omitted key, a
// JSON null, and a junk value — so no `PARSEABLE_RAW` entry below is ever unproduced.
const rawDomains = {
  associationState: ["associated", "not_associated", "unknown", undefined, null, "connected"],
  linkProgress: ["carrying_traffic", "dns_failing", "dhcp_failing", "associated_only", "not_associated", "unknown", undefined, null, ["dns_failing"]],
  roamCapability: ["fast_transition", "basic", "not_applicable", "unknown", undefined, null, 11],
  roamHealth: ["stable", "sticky", "excessive", "not_applicable", "unknown", undefined, null, "flappy"],
  linkLatencyClass: ["nominal", "degraded", "unknown", undefined, null, {}],
  controllerReachable: [true, false, null, undefined, "true", 1],
  __alias: ["absent", "present"],
};
// The harness calls `evaluate` once per combination, so wrapping it audits the ENTIRE
// raw space at zero extra cost — which is what the "cited a disbelieved claim" invariant
// needs, since grant-ness cannot see it (both readings deny).
let contradictoryCount = 0;
let citedWhileContradictory = 0;
let roamContradictoryCount = 0;
let roamCitedWhileContradictory = 0;
const evaluateAndAudit = (n: NormalizedLinkUsability): ReturnType<typeof evaluateLinkUsability> => {
  const v = evaluateLinkUsability(n);
  if (linkContradictory(n.associationState, n.linkProgress)) {
    contradictoryCount += 1;
    if (v.criticalFindings.length > 0 || v.reasonCode === "NOT_ASSOCIATED" ||
        v.reasonCode === "ASSOCIATED_BUT_NOT_CARRYING_TRAFFIC" || v.reasonCode === "DNS_FAILING" ||
        v.reasonCode === "DHCP_FAILING") {
      citedWhileContradictory += 1;
    }
  }
  if (roamContradictory(n.roamCapability, n.roamHealth)) {
    roamContradictoryCount += 1;
    if (v.reasonCode === "ROAM_STICKY" || v.reasonCode === "ROAM_EXCESSIVE") roamCitedWhileContradictory += 1;
  }
  return v;
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as LinkUsabilityReportRaw;
    if (__alias === "present") raw.roam_health = "sticky";
    return normalizeReport("enum", raw, "enum");
  },
  evaluate: evaluateAndAudit,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.linkUsable === true &&
    v.posture === "link_carrying_traffic" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  positivelyClean: (c) => c.__alias !== "present" && linkClean(c),
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — including junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects and an aliased extra key — normalizeReport + evaluate grant ONLY the six-way confirmation (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 217728,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
check("exhaustive (raw wire): exactly THREE raw reports grant — one per coherent roam pair", rawEnumRes.noneCount === 3);
check(
  `exhaustive (raw wire): across all ${contradictoryCount} ladder-contradictory reports, NOT ONE cites the disbelieved half — no ladder reason code and no critical finding (violations=${citedWhileContradictory})`,
  citedWhileContradictory === 0 && contradictoryCount > 0,
);
// Weaker than its ladder counterpart, and labelled so. The ladder audit is load-bearing:
// `associated_only`/`dns_failing`/`dhcp_failing` ALERT, so without the guard they would
// outrank the contradiction and the check goes red. The roam candidates are `step_up`,
// equal to the contradiction's own severity and pushed after it, so this holds whether or
// not the roam guard exists. It pins the OUTCOME, not the guard — the guard is documented
// in `evaluate.ts` as inert at current severities rather than being claimed as proven.
check(
  `exhaustive (raw wire): across all ${roamContradictoryCount} ROAM-contradictory reports, the verdict never HEADLINES the disbelieved roam behaviour (violations=${roamCitedWhileContradictory})`,
  roamCitedWhileContradictory === 0 && roamContradictoryCount > 0,
);

// Pass 3 — PARSE FIDELITY, over the same raw space.
//
// Passes 1 and 2 only ever observe grant-ness, and every malformed value already
// normalizes to a denying `unknown`. That makes each individual integrity condition
// INVISIBLE to them: deleting one changes `reportIntegrity` but not the action, so the
// enumeration stays at 0 mismatches and the condition is load-bearing but unproven. This
// pass closes it by asserting the integrity flag against an independent allowlist.
const PARSEABLE_RAW: Record<string, readonly unknown[]> = {
  associationState: [undefined, null, "associated", "not_associated", "unknown"],
  linkProgress: [undefined, null, "carrying_traffic", "dns_failing", "dhcp_failing", "associated_only", "not_associated", "unknown"],
  roamCapability: [undefined, null, "fast_transition", "basic", "not_applicable", "unknown"],
  roamHealth: [undefined, null, "stable", "sticky", "excessive", "not_applicable", "unknown"],
  linkLatencyClass: [undefined, null, "nominal", "degraded", "unknown"],
  controllerReachable: [undefined, null, true, false],
};
const integrityRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as LinkUsabilityReportRaw;
    if (__alias === "present") raw.roam_health = "sticky";
    return normalizeReport("enum", raw, "enum");
  },
  // The normalized report IS the verdict for this pass; "none" stands for "clean".
  evaluate: (n) => n,
  actionOf: (n) => (n.reportIntegrity === "clean" ? "none" : "malformed"),
  positivelyClean: (c) =>
    c.__alias !== "present" && Object.keys(PARSEABLE_RAW).every((k) => PARSEABLE_RAW[k].includes(c[k])),
});
check(
  `parse fidelity: over all ${integrityRes.combos} raw reports, reportIntegrity is 'clean' for EXACTLY the reports whose every field carries a parseable wire value and which carry no unrecognized key (mismatches=${integrityRes.mismatches}${integrityRes.firstMismatch ? ", first=" + integrityRes.firstMismatch : ""})`,
  integrityRes.mismatches === 0 && integrityRes.combos === productOf(rawDomains),
);
check("parse fidelity: both outcomes occur (the pass is not vacuous)", integrityRes.noneCount > 0 && integrityRes.noneCount < integrityRes.combos);

// Worst-concern-wins across several concerns at once.
const worst = evaluateLinkUsability(await connector.fetchLink(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: a confirmed DNS failure (alert) outranks sticky roaming and degraded latency", worst.recommendedAction === "alert" && worst.reasonCode === "DNS_FAILING");

// Determinism.
const d = await connector.fetchLink(fixture.devices["roam-sticky"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateLinkUsability(d)) === JSON.stringify(evaluateLinkUsability(d)));

// ── fabric fusion ─────────────────────────────────────────────────────────────

const signal = fromLinkUsability(quiet);
check("fromLinkUsability emits a link_usability signal", signal.kind === "link_usability");
check("fabric fuses an associated-but-unusable link into an alert verdict", composeDeviceRisk([signal]).strongestAction === "alert");
check("a usable link contributes 'none' to the fabric", fromLinkUsability(usable).action === "none");
// The point of the dimension, end to end: a device every other signal calls healthy is
// still not healthy if the link its signals arrived over is carrying nothing.
check("a healthy link fused with an unusable one never composes to 'ok'", composeDeviceRisk([fromLinkUsability(usable), fromLinkUsability(quiet)]).riskTier !== "ok");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof LinkUsabilityConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new LinkUsabilityConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["link-usable"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: LinkUsabilityConnectorError | null = null;
try { await bad.fetchLink(fixture.devices["link-usable"].deviceId); } catch (err) { authErr = err instanceof LinkUsabilityConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: LinkUsabilityConnectorError | null = null;
try { await connector.fetchLink("no-such-device"); } catch (err) { missingErr = err instanceof LinkUsabilityConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented healthy link", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveLinkUsabilityConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveLinkUsabilityConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveLinkUsabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveLinkUsabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", LINK_USABILITY_ACCESS_TOKEN: "t" }).mode === "live");

console.log(`figures=normalized=${enumRes.combos},raw=${rawEnumRes.combos},grants=${rawEnumRes.noneCount},contradictory=${contradictoryCount},roamContradictory=${roamContradictoryCount}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
