// Device-management-health / config-drift proof — fully OFFLINE and deterministic.
//
// Drives the read-only device-management-health connector against captured
// management-plane reports and runs the pure evaluator per device. The fabric already
// asks whether a device is HARDENED (macos-posture) and whether it was COMPLIANT at
// some evaluation (intune-entra-posture). Neither asks whether either answer is still
// worth anything. A ward iPad that stopped checking in three weeks ago reports its
// last-known posture forever; a device whose enrollment failed, or that was retired in
// the MDM but never physically collected, looks fine in a snapshot and is ungoverned.
// A retired/failed enrollment or a device no compliance policy covers is contained;
// drift, a stale or absent check-in, an unreachable plane, and anything unreadable step
// up. Only a device confirmed on all five counts contributes 'none'. No network.
//
// It also proves the fabric fuses this dimension: fromDeviceManagementHealth → a
// device_management_health ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeviceManagementHealthConnector,
  DeviceManagementHealthConnectorError,
  createMockDeviceManagementHealthTransport,
  evaluateDeviceManagementHealth,
  guardReadOnly,
  normalizeReport,
  resolveDeviceManagementHealthConnector,
  type DeviceManagementHealthReportRaw,
  type NormalizedDeviceManagementHealth,
} from "@workspace/integrations/device-management-health";
import { composeDeviceRisk, fromDeviceManagementHealth } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  managementEffective: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: DeviceManagementHealthReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/device-management-health/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://device-management-bridge.local/device-management-health";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Device-management-health / config-drift proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, DeviceManagementHealthReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockDeviceManagementHealthTransport({ reports, expectedToken: fixture.accessToken });
const connector = new DeviceManagementHealthConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchHealth(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "device-management-health");
  const v = evaluateDeviceManagementHealth(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.managementEffective === spec.expected.managementEffective &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── management-health invariants ────────────────────────────────────────────────

const healthy = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["managed-healthy"].deviceId));
check("a fresh + on-baseline + covered + enrolled + reachable device → managed_healthy/none", healthy.posture === "managed_healthy" && healthy.recommendedAction === "none" && healthy.managementEffective === true);
check("a healthy device composes to the 'ok' tier", composeDeviceRisk([fromDeviceManagementHealth(healthy)]).riskTier === "ok");

// The management plane is not actually governing this device.
const retired = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["enrollment-retired"].deviceId));
check("a RETIRED enrollment (removed from MDM, still in someone's hands) → restrict + critical", retired.recommendedAction === "restrict" && retired.criticalFindings.includes("enrollment_retired"));
check("a retired device composes to the 'blocked' tier, NEVER 'ok'", composeDeviceRisk([fromDeviceManagementHealth(retired)]).riskTier === "blocked");
const failed = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["enrollment-failed"].deviceId));
check("a FAILED enrollment → restrict + critical", failed.recommendedAction === "restrict" && failed.criticalFindings.includes("enrollment_failed"));
const uncovered = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["compliance-uncovered"].deviceId));
check("a device NO compliance policy covers → restrict + critical ('compliant' would be vacuous)", uncovered.recommendedAction === "restrict" && uncovered.criticalFindings.includes("compliance_uncovered"));

// Governed, but the governance is drifting or going quiet.
const drifted = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["policy-drifted"].deviceId));
check("CONFIG DRIFT (applied config no longer matches the assigned baseline) → step_up", drifted.posture === "drifted_config" && drifted.recommendedAction === "step_up");
const stale = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["checkin-stale"].deviceId));
check("a STALE check-in → step_up (the posture snapshot has silently expired)", stale.posture === "stale_management" && stale.reasonCode === "CHECKIN_STALE");
check("a stale device never composes to 'ok'", composeDeviceRisk([fromDeviceManagementHealth(stale)]).riskTier !== "ok");

// The consistency guard: a device that has NEVER reported cannot have been OBSERVED on
// its baseline or in policy scope. Those claims are derived from a check-in that never
// happened, so they are demoted — and only ever demoted.
const never = await connector.fetchHealth(fixture.devices["checkin-never"].deviceId);
check("a device that NEVER checked in cannot be confirmed on-baseline — the claim is demoted to unknown", never.policyDrift === "unknown" && never.complianceCoverage === "unknown");
check("...and it never grants", evaluateDeviceManagementHealth(never).recommendedAction === "step_up" && evaluateDeviceManagementHealth(never).managementEffective === false);
const retiredNorm = await connector.fetchHealth(fixture.devices["enrollment-retired"].deviceId);
check("a retired device is not 'covered' by a policy however the bridge summarized it", retiredNorm.complianceCoverage === "unknown");
// The guard only DOWNGRADES. A guard that could also promote unknown → covered when the
// surrounding fields looked agreeable would manufacture the confirmation the grant
// demands. Feeding it an already-unknown report must leave it unknown.
const stillUnknown = normalizeReport("g", { checkInFreshness: "fresh", policyDrift: "unknown", complianceCoverage: "unknown", enrollmentState: "enrolled", managementReachable: true });
check("the consistency guard NEVER promotes an unknown to a confirmation", stillUnknown.policyDrift === "unknown" && stillUnknown.complianceCoverage === "unknown");

// No management result at all → a gap → step_up (never an effective-management grant).
const noCov = evaluateDeviceManagementHealth(normalizeReport("ghost", {}), { covered: false });
check("an uncovered device is 'unknown'/step_up, never effectively managed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.managementEffective === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromDeviceManagementHealth(noCov)]).riskTier !== "ok");

// The grant demands POSITIVE confirmation the plane answered for THIS device.
const noReach = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["reachability-unreported"].deviceId));
check("UNREPORTED management reachability → step_up, never granted", noReach.reasonCode === "MANAGEMENT_UNREACHABLE" && noReach.managementEffective === false);
check("only an explicit managementReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromDeviceManagementHealth(noReach)]).riskTier !== "ok");

// Report integrity: a field PRESENT but unparseable is an assertion we could not read,
// which is not the same as silence. The allowlist folds both into "unknown", so
// presence is tracked separately and independently denied on.
const malformed = await connector.fetchHealth(fixture.devices["report-malformed-enum"].deviceId);
check("an unparseable enum value marks the report malformed", malformed.reportIntegrity === "malformed" && malformed.checkInFreshness === "unknown");
const malformedBool = await connector.fetchHealth(fixture.devices["report-malformed-boolean"].deviceId);
check("a string-quoted boolean is an assertion, not silence", malformedBool.reportIntegrity === "malformed" && malformedBool.managementReachable === null);
const aliased = await connector.fetchHealth(fixture.devices["report-aliased-keys"].deviceId);
check("an unrecognized key means the envelope was not understood", aliased.reportIntegrity === "malformed");
// The key scan walks the prototype chain with Reflect.ownKeys. The shipped HTTP
// transport hands us a JSON.parse result, but the transport is injectable — an
// in-process adapter returning a class instance or Proxy could otherwise hide an
// assertion where Object.keys cannot see it.
const protoHidden = Object.create({ policy_drift: "drifted" }) as DeviceManagementHealthReportRaw;
protoHidden.checkInFreshness = "fresh"; protoHidden.policyDrift = "on_baseline";
protoHidden.complianceCoverage = "covered"; protoHidden.enrollmentState = "enrolled";
protoHidden.managementReachable = true;
check("a key inherited from the PROTOTYPE is still an unrecognized envelope", normalizeReport("p", protoHidden).reportIntegrity === "malformed");
check("a plain parsed-JSON report is NOT flagged by the prototype walk", normalizeReport("j", JSON.parse('{"checkInFreshness":"fresh"}') as DeviceManagementHealthReportRaw).reportIntegrity === "clean");
// JSON null is the wire spelling of "no value", not an unreadable assertion — a bridge
// emitting a fixed row shape with nulls is being honest and must behave as omission.
const nulls = normalizeReport("nl", { checkInFreshness: null, policyDrift: null, complianceCoverage: null, enrollmentState: null, managementReachable: null } as DeviceManagementHealthReportRaw);
check("JSON null on every field behaves as ABSENT, not as malformed", nulls.reportIntegrity === "clean" && nulls.checkInFreshness === "unknown");
check("...and still never grants, because nothing was positively confirmed", evaluateDeviceManagementHealth(nulls).recommendedAction === "step_up");
check("a malformed report never grants, even when every parsed field looks clean", evaluateDeviceManagementHealth(aliased).recommendedAction === "step_up" && evaluateDeviceManagementHealth(aliased).managementEffective === false);
// Defence in depth: the evaluator refuses independently of the normalizer.
const forged = evaluateDeviceManagementHealth({
  sourceSystem: "device-management-health", deviceId: "forged", source: "test",
  checkInFreshness: "fresh", policyDrift: "on_baseline", complianceCoverage: "covered",
  enrollmentState: "enrolled", managementReachable: true, reportIntegrity: "malformed",
});
check("the EVALUATOR independently refuses a malformed report, even a fully clean-looking one", forged.recommendedAction === "step_up" && forged.managementEffective === false);

// Unknown ≠ managed: an unrecognized enum normalizes to the safe unknown.
const norm = normalizeReport("n", { checkInFreshness: "recently", enrollmentState: "in_progress", policyDrift: "maybe" });
check("unrecognized enums normalize to 'unknown' (never a fabricated fresh/enrolled)", norm.checkInFreshness === "unknown" && norm.enrollmentState === "unknown" && norm.policyDrift === "unknown");
const boolNorm = normalizeReport("b", { managementReachable: 1 } as unknown as DeviceManagementHealthReportRaw);
check("a non-boolean managementReachable is null, never fabricated", boolNorm.managementReachable === null);
// Case and whitespace are canonicalized, so a shouty bridge is understood, not rejected.
const shouty = normalizeReport("s", { checkInFreshness: " FRESH ", enrollmentState: "Enrolled" });
check("case/whitespace variants are canonicalized, not treated as malformed", shouty.reportIntegrity === "clean" && shouty.checkInFreshness === "fresh" && shouty.enrollmentState === "enrolled");

// ── exhaustive, in TWO passes over two DIFFERENT spaces ────────────────────────
//
// Pass 1 quantifies over the NORMALIZED space (including reportIntegrity) against the
// evaluator alone: action "none" is emitted for exactly the five-way confirmation, and
// never on a report flagged malformed.
const domains = {
  checkInFreshness: ["fresh", "stale", "never", "unknown"],
  policyDrift: ["on_baseline", "drifted", "unknown"],
  complianceCoverage: ["covered", "uncovered", "unknown"],
  enrollmentState: ["enrolled", "failed", "retired", "unknown"],
  managementReachable: [true, false, null],
  reportIntegrity: ["clean", "malformed"],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) =>
    ({ sourceSystem: "device-management-health", deviceId: "enum", source: "enum", ...c }) as NormalizedDeviceManagementHealth,
  evaluate: evaluateDeviceManagementHealth,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.managementEffective === true &&
    v.posture === "managed_healthy" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.checkInFreshness === "fresh" &&
    c.policyDrift === "on_baseline" &&
    c.complianceCoverage === "covered" &&
    c.enrollmentState === "enrolled" &&
    c.managementReachable === true,
});
check(
  `exhaustive (normalized): over all ${enumRes.combos} normalized states, action 'none' requires ALL FIVE positively confirmed and a clean report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 864,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// Pass 2 quantifies over the RAW WIRE space, and unlike pass 1 it carries the MALFORMED
// values a real bridge emits — a junk enum spelling, a string-quoted boolean, a number,
// an array, an object, an omitted key. Built only from well-formed values,
// `normalizeReport` would be the identity function here and the pass would prove
// nothing about the parse layer.
// `null` appears on the enum fields too: it is the standard wire spelling of "no
// value", and a bridge emitting a fixed row shape with nulls rather than omitting keys
// is being honest. It must behave as absence, not as an unreadable assertion.
//
// `__alias` is a build-time toggle, not a wire field: when set it adds a snake_case key
// to the raw report. Without it the unrecognized-key branch of the integrity check
// would be load-bearing and structurally unreachable by this enumeration.
const rawDomains = {
  checkInFreshness: ["fresh", "stale", "never", "unknown", undefined, null, "very_old"],
  policyDrift: ["on_baseline", "drifted", "unknown", undefined, null, ["drifted"]],
  complianceCoverage: ["covered", "uncovered", "unknown", undefined, null, {}],
  enrollmentState: ["enrolled", "failed", "retired", "unknown", undefined, null, "pending_enrollment"],
  managementReachable: [true, false, null, undefined, "true", 1],
  __alias: ["absent", "present"],
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as DeviceManagementHealthReportRaw;
    if (__alias === "present") raw.policy_drift = "drifted";
    return normalizeReport("enum", raw, "enum");
  },
  evaluate: evaluateDeviceManagementHealth,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.managementEffective === true &&
    v.posture === "managed_healthy" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  // An INDEPENDENT spec: the positive wire contract a bridge must satisfy, stated as
  // the five exact values, not as the negation of any guard in the implementation. A
  // guard that silently lost a condition would still fail here.
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.checkInFreshness === "fresh" &&
    c.policyDrift === "on_baseline" &&
    c.complianceCoverage === "covered" &&
    c.enrollmentState === "enrolled" &&
    c.managementReachable === true,
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — including junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects and an aliased extra key — normalizeReport + evaluate grant ONLY the five-way confirmation (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 21168,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
check("exhaustive (raw wire): exactly ONE raw report grants — the five-way confirmation is unique", rawEnumRes.noneCount === 1);

// Worst-concern-wins: the restrict outranks the drift/check-in step_ups.
const worst = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: a retired enrollment (restrict) outranks drift and a dead check-in", worst.recommendedAction === "restrict" && worst.criticalFindings.length === 2);

// Determinism.
const d = await connector.fetchHealth(fixture.devices["policy-drifted"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateDeviceManagementHealth(d)) === JSON.stringify(evaluateDeviceManagementHealth(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromDeviceManagementHealth(retired);
check("fromDeviceManagementHealth emits a device_management_health signal", signal.kind === "device_management_health");
check("fabric fuses a retired device into a restrict verdict", composeDeviceRisk([signal]).strongestAction === "restrict");
check("a healthy device contributes 'none' to the fabric", fromDeviceManagementHealth(healthy).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof DeviceManagementHealthConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new DeviceManagementHealthConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["managed-healthy"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: DeviceManagementHealthConnectorError | null = null;
try { await bad.fetchHealth(fixture.devices["managed-healthy"].deviceId); } catch (err) { authErr = err instanceof DeviceManagementHealthConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: DeviceManagementHealthConnectorError | null = null;
try { await connector.fetchHealth("no-such-device"); } catch (err) { missingErr = err instanceof DeviceManagementHealthConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented healthy device", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveDeviceManagementHealthConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveDeviceManagementHealthConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveDeviceManagementHealthConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveDeviceManagementHealthConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", DEVICE_MANAGEMENT_HEALTH_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
