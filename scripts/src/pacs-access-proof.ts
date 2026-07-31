// Physical access-control (PACS) proof — fully OFFLINE and deterministic.
//
// Drives the read-only PACS connector against captured access-control reports and
// runs the pure evaluator per controlled entry. The model: on a shared, badge-
// checked-out device the person now holding it must have legitimately badged into
// this controlled area, be authorized to be here right now, and the door itself must
// be secure. A denial / revoked credential / a PACS holder ≠ the checked-out device
// holder is the strongest negative (escalate); a tailgating (anti-passback) breach or
// a forced door is contained (restrict); an out-of-schedule/zone entry or a held door
// steps up; only a positively-confirmed authorized entry at a secure door contributes
// 'none'. No network, no door/turnstile control.
//
// It also proves the fabric fuses this dimension: fromPacsAccess → a pacs_access
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PacsAccessConnector,
  PacsAccessConnectorError,
  createMockPacsAccessTransport,
  evaluatePacsAccess,
  guardReadOnly,
  normalizeReport,
  resolvePacsAccessConnector,
  type NormalizedPacsAccess,
  type PacsAccessReportRaw,
} from "@workspace/integrations/pacs-access";
import { composeDeviceRisk, fromPacsAccess } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  physicalAccessConfirmed: boolean;
}
interface Fixture {
  accessToken: string;
  entries: Record<string, { deviceId: string; report: PacsAccessReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/pacs-access/events.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://pacs-access-bridge.local/pacs-access";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Physical access-control (PACS) proof");
const names = Object.keys(fixture.entries);
console.log(`entries=${names.length}`);

const reports: Record<string, PacsAccessReportRaw> = {};
for (const n of names) reports[fixture.entries[n].deviceId] = fixture.entries[n].report;
const transport = createMockPacsAccessTransport({ reports, expectedToken: fixture.accessToken });
const connector = new PacsAccessConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.entries[name];
  const normalized = await connector.fetchAccess(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "pacs-access");
  const v = evaluatePacsAccess(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.physicalAccessConfirmed === spec.expected.physicalAccessConfirmed &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── physical-custody invariants ─────────────────────────────────────────────────

// The ONLY path to 'none' is a positively-confirmed authorized entry — and only then
// is the verdict marked physicalAccessConfirmed.
const clean = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["clean-biometric-badge-in"].deviceId));
check("a granted + authorized + secure-door + identity-matched entry → physical_access_ok/none, confirmed", clean.posture === "physical_access_ok" && clean.recommendedAction === "none" && clean.physicalAccessConfirmed === true);
check("a confirmed physical entry composes to the 'ok' tier", composeDeviceRisk([fromPacsAccess(clean)]).riskTier === "ok");

// A PACS holder who does NOT match the checked-out device holder is the strongest negative.
const mismatch = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["identity-mismatch"].deviceId));
check("a PACS identity mismatch → escalate + critical, NOT confirmed", mismatch.recommendedAction === "escalate" && mismatch.criticalFindings.includes("identity_mismatch") && mismatch.physicalAccessConfirmed === false);
check("an identity mismatch composes to the 'blocked' tier, NEVER 'ok'", composeDeviceRisk([fromPacsAccess(mismatch)]).riskTier === "blocked");

// A denied entry escalates; a tailgating breach and a forced door restrict.
const denied = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["access-denied"].deviceId));
check("a denied badge presentation → escalate + critical", denied.recommendedAction === "escalate" && denied.criticalFindings.includes("access_denied"));
const tailgate = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["tailgating"].deviceId));
check("an anti-passback (tailgating) violation → restrict + critical", tailgate.recommendedAction === "restrict" && tailgate.criticalFindings.includes("antipassback_violation"));

// No PACS record → gap → step_up (never a confirmed entry).
const noCov = evaluatePacsAccess(normalizeReport("ghost", {} as PacsAccessReportRaw), { covered: false });
check("an uncovered entry is 'unknown'/step_up, never confirmed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.physicalAccessConfirmed === false);
check("an uncovered entry composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromPacsAccess(noCov)]).riskTier !== "ok");

// The grant demands POSITIVE verification: a clean entry whose bridge reachability
// was NOT reported (null) must NOT grant — fail closed.
const noReach = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["reachability-unreported"].deviceId));
check("a clean entry with UNREPORTED bridge reachability → step_up, never physical_access_ok", noReach.reasonCode === "BRIDGE_UNREACHABLE" && noReach.recommendedAction === "step_up" && noReach.physicalAccessConfirmed === false);
check("only an explicit bridgeReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromPacsAccess(noReach)]).riskTier !== "ok");

// A self-contradictory report — a `granted` label but the two subjects differ — is
// forced to identityMatched=false by the normalizer and can never grant.
const derived = await connector.fetchAccess(fixture.entries["subject-mismatch-derived"].deviceId);
check("a subject mismatch normalizes identityMatched to false", derived.identityMatched === false);
check("a subject-mismatched 'granted' entry → escalate, NEVER physical_access_ok/none", evaluatePacsAccess(derived).recommendedAction === "escalate");

// The subject comparison only ever DOWNGRADES — an explicit identityMatched:false
// that contradicts EQUAL subjects is a self-contradictory report and must fail
// closed (never upgraded to a match/grant), while equal subjects with no flag
// positively corroborate a match.
const contradiction = await connector.fetchAccess(fixture.entries["contradiction-flag-false-subjects-equal"].deviceId);
check("an explicit identityMatched:false with EQUAL subjects stays false (contradiction fails closed, never upgraded)", contradiction.identityMatched === false);
check("a contradictory false/equal-subjects entry → escalate, NEVER granted", evaluatePacsAccess(contradiction).recommendedAction === "escalate");
const corroborated = await connector.fetchAccess(fixture.entries["subjects-corroborate-clean"].deviceId);
check("equal subjects with no explicit flag positively confirm the match (identityMatched=true)", corroborated.identityMatched === true);

// ── the credential-technology (mixed-estate) axis ───────────────────────────────
// A 125 kHz prox clone and a PKOC/Aliro credential both arrive as one "granted";
// this axis grades what the reader actually VERIFIED, and only when the CALLER
// poses a floor — the legacy estate is graded, never condemned.

const cleanRaw = fixture.entries["clean-card-badge-in"].report;
const staticRead = normalizeReport("est", { ...cleanRaw, credentialTechnology: "static_identifier" } as PacsAccessReportRaw);
const cryptoRead = normalizeReport("est", { ...cleanRaw, credentialTechnology: "cryptographic" } as PacsAccessReportRaw);

const belowFloor = evaluatePacsAccess(staticRead, { minimumCredentialTechnology: "cryptographic" });
check("a static-identifier read below a posed cryptographic floor → credential_below_floor/step_up, assurance below_floor", belowFloor.posture === "credential_below_floor" && belowFloor.reasonCode === "CREDENTIAL_BELOW_FLOOR" && belowFloor.recommendedAction === "step_up" && belowFloor.credentialAssurance === "below_floor" && belowFloor.physicalAccessConfirmed === false);
check("below-floor is a CHALLENGE, never a lockout — exactly step_up, not restrict/deny", belowFloor.recommendedAction === "step_up");

const unposed = evaluatePacsAccess(staticRead);
check("the SAME static read with NO floor posed still grants — unassessed never forecloses (readers don't all disappear overnight)", unposed.recommendedAction === "none" && unposed.physicalAccessConfirmed === true && unposed.credentialAssurance === "unassessed");

const acceptedLegacy = evaluatePacsAccess(staticRead, { minimumCredentialTechnology: "static_identifier" });
check("an operator who explicitly poses the static floor keeps the grant — the choice stays theirs, assurance meets_floor", acceptedLegacy.recommendedAction === "none" && acceptedLegacy.credentialAssurance === "meets_floor");

const meets = evaluatePacsAccess(cryptoRead, { minimumCredentialTechnology: "cryptographic" });
check("a cryptographic read meets the posed cryptographic floor and grants", meets.recommendedAction === "none" && meets.physicalAccessConfirmed === true && meets.credentialAssurance === "meets_floor");

const posedSilent = evaluatePacsAccess(normalizeReport("est", cleanRaw), { minimumCredentialTechnology: "cryptographic" });
check("a posed floor the PACS did not answer → step_up CREDENTIAL_TECHNOLOGY_UNKNOWN, assurance unknown (silence is not a cryptographic credential)", posedSilent.reasonCode === "CREDENTIAL_TECHNOLOGY_UNKNOWN" && posedSilent.recommendedAction === "step_up" && posedSilent.credentialAssurance === "unknown" && posedSilent.unknownSignals.includes("credential_technology"));

check("a garbled technology value normalizes to unknown, never a fabricated class", normalizeReport("g", { ...cleanRaw, credentialTechnology: "DESFire EV3!!" } as PacsAccessReportRaw).credentialTechnology === "unknown");

const deniedBelow = evaluatePacsAccess(normalizeReport("est", { ...cleanRaw, accessResult: "denied", credentialTechnology: "static_identifier" } as PacsAccessReportRaw), { minimumCredentialTechnology: "cryptographic" });
check("worst-concern-wins: a denial still escalates past a below-floor read (the axis never dilutes a stronger negative)", deniedBelow.recommendedAction === "escalate" && deniedBelow.reasonCode === "ACCESS_DENIED" && deniedBelow.credentialAssurance === "below_floor");

const uncoveredPosed = evaluatePacsAccess(normalizeReport("ghost", {} as PacsAccessReportRaw), { covered: false, minimumCredentialTechnology: "cryptographic" });
check("an uncovered entry with a posed floor answers the axis honestly: assurance unknown, still NOT_COVERED", uncoveredPosed.reasonCode === "NOT_COVERED" && uncoveredPosed.credentialAssurance === "unknown");

// Exhaustive: brute-force the ENTIRE normalized input space (not fixture-bound), so
// the proof genuinely CONSTRAINS the allow path. Action "none" is emitted for EXACTLY
// a positively-confirmed authorized entry — granted, authorized, anti-passback-ok, a
// secure door, identity matched, on a known credential, with the bridge reachable —
// and for nothing else. Any unknown/missing value on a decisive field falls out.
const domains = {
  accessResult: ["granted", "denied", "unknown"],
  credentialType: ["biometric", "card", "mobile", "pin", "unknown"],
  credentialTechnology: ["cryptographic", "static_identifier", "unknown"],
  authorization: ["authorized", "out_of_schedule", "out_of_zone", "revoked", "unknown"],
  antipassback: ["ok", "violation", "unknown"],
  doorState: ["secured", "forced", "held_open", "unknown"],
  identityMatched: [true, false, null],
  bridgeReachable: [true, false, null],
};
const buildEnum = (c: Record<string, unknown>) =>
  ({ sourceSystem: "pacs-access", deviceId: "enum", pacsSubject: null, expectedSubject: null, source: "enum", ...c }) as NormalizedPacsAccess;
const positivelyCleanBase = (c: Record<string, unknown>): boolean => {
  const { accessResult, credentialType, authorization, antipassback, doorState, identityMatched, bridgeReachable } = c;
  return (
    accessResult === "granted" &&
    authorization === "authorized" &&
    antipassback === "ok" &&
    doorState === "secured" &&
    identityMatched === true &&
    bridgeReachable === true &&
    (credentialType === "biometric" || credentialType === "card" || credentialType === "mobile" || credentialType === "pin")
  );
};
const enumRes = enumerateGrantSafety({
  domains,
  build: buildEnum,
  evaluate: evaluatePacsAccess,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) => v.posture === "physical_access_ok" && v.physicalAccessConfirmed === true,
  // UNPOSED: the technology axis must be invisible to the grant — any of its three
  // values grants when the rest of the entry is positively clean.
  positivelyClean: positivelyCleanBase,
});
check(
  `exhaustive (unposed): over all ${enumRes.combos} input combinations, action 'none' is emitted for EXACTLY the positively-confirmed authorized entries — the technology axis forecloses NOTHING unposed (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 24300,
);
check("exhaustive (unposed): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// POSED cryptographic floor: the SAME space, and now the grant additionally
// requires the reader to have verified a cryptographic credential — a static or
// unreported technology falls out of the allow path, and nothing else changes.
const enumPosed = enumerateGrantSafety({
  domains,
  build: buildEnum,
  evaluate: (n) => evaluatePacsAccess(n, { minimumCredentialTechnology: "cryptographic" }),
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) => v.posture === "physical_access_ok" && v.physicalAccessConfirmed === true,
  positivelyClean: (c) => positivelyCleanBase(c) && c["credentialTechnology"] === "cryptographic",
});
check(
  `exhaustive (posed cryptographic floor): over the same ${enumPosed.combos} combinations, the grant additionally demands a cryptographic read — static/unknown fall out, nothing else moves (mismatches=${enumPosed.mismatches}${enumPosed.firstMismatch ? ", first=" + enumPosed.firstMismatch : ""})`,
  enumPosed.mismatches === 0 && enumPosed.combos === 24300,
);
check("exhaustive (posed): the cryptographic allow path is exactly one third of the unposed one (the two static/unknown thirds step up)", enumPosed.noneCount * 3 === enumRes.noneCount);

// Unknown ≠ granted: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { accessResult: "maybe", authorization: "sorta", doorState: "ajar" } as PacsAccessReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated granted/authorized)", norm.accessResult === "unknown" && norm.authorization === "unknown" && norm.doorState === "unknown");
const boolNorm = normalizeReport("b", { identityMatched: "yes", bridgeReachable: 1 } as unknown as PacsAccessReportRaw);
check("a non-boolean identityMatched / bridgeReachable is null, never fabricated", boolNorm.identityMatched === null && boolNorm.bridgeReachable === null);

// Worst-concern-wins: a denial (escalate) outranks the restricts and step_ups.
const worst = evaluatePacsAccess(await connector.fetchAccess(fixture.entries["worst-of-several"].deviceId));
check("worst-concern-wins: a denial (escalate) outranks the tailgating/forced restricts", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 5);

// Determinism.
const d = await connector.fetchAccess(fixture.entries["out-of-schedule"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluatePacsAccess(d)) === JSON.stringify(evaluatePacsAccess(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromPacsAccess(mismatch);
check("fromPacsAccess emits a pacs_access signal", signal.kind === "pacs_access");
check("fabric fuses an identity mismatch into an escalate verdict", composeDeviceRisk([signal]).strongestAction === "escalate");
check("a confirmed physical entry contributes 'none' to the fabric", fromPacsAccess(clean).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof PacsAccessConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new PacsAccessConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.entries["clean-card-badge-in"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: PacsAccessConnectorError | null = null;
try { await bad.fetchAccess(fixture.entries["clean-card-badge-in"].deviceId); } catch (err) { authErr = err instanceof PacsAccessConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: PacsAccessConnectorError | null = null;
try { await connector.fetchAccess("no-such-device"); } catch (err) { missingErr = err instanceof PacsAccessConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented granted entry", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolvePacsAccessConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolvePacsAccessConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolvePacsAccessConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolvePacsAccessConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", PACS_ACCESS_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
