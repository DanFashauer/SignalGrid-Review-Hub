// Device-management-health / config-drift proof — fully OFFLINE and deterministic.
//
// Drives the read-only device-management-health connector against captured
// management-plane reports and runs the pure evaluator per device. The fabric already
// asks whether a device is HARDENED (macos-posture) and whether it was COMPLIANT at
// some evaluation (intune-entra-posture). Neither asks whether either answer is still
// worth anything. A ward iPad that stopped checking in three weeks ago reports its
// last-known posture forever; a device whose enrollment failed, or that was retired in
// the MDM but never physically collected, looks fine in a snapshot and is ungoverned.
// A retired/failed enrollment or a device no compliance policy covers is contained; a
// detected-but-unremediated defect alerts; drift, a stale or absent check-in on EITHER
// delivery channel, a remediation script that could not run, an unreachable plane, and
// anything unreadable step up. Only a device confirmed on all seven counts contributes
// 'none'. No network.
//
// The two check-in channels are the reason this file grew: one sync in an MDM console
// drives the MDM channel (profiles, compliance, settings catalog) and the management
// AGENT channel (Win32 apps, scripts, Remediations) independently, and the console's
// `lastSyncDateTime` covers only the first. A device fresh on MDM whose agent has not
// run in three weeks reads as healthy while every app install, script and remediation
// queued in that window has silently not happened.
//
// It also proves the fabric fuses this dimension: fromDeviceManagementHealth → a
// device_management_health ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS,
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
check("a ward iPad fresh on MDM, with the agent channel confirmed absent, otherwise clean → managed_healthy/none", healthy.posture === "managed_healthy" && healthy.recommendedAction === "none" && healthy.managementEffective === true);
check("a healthy device composes to the 'ok' tier", composeDeviceRisk([fromDeviceManagementHealth(healthy)]).riskTier === "ok");
// The agent-bearing platform grants too — `not_applicable` is not the only way through,
// or the whole Windows/macOS half of a fleet could never be confirmed healthy.
const healthyAgent = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["managed-healthy-with-agent"].deviceId));
check("a Windows cart fresh on BOTH channels and remediation-healthy also grants", healthyAgent.recommendedAction === "none" && healthyAgent.managementEffective === true);

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
const stale = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["mdm-checkin-stale"].deviceId));
check("a STALE MDM check-in → step_up (the posture snapshot has silently expired)", stale.posture === "stale_management" && stale.reasonCode === "MDM_CHECKIN_STALE");
check("a stale device never composes to 'ok'", composeDeviceRisk([fromDeviceManagementHealth(stale)]).riskTier !== "ok");

// ── the two delivery channels ─────────────────────────────────────────────────
//
// The case this split exists for. In an Intune-class management plane ONE sync drives
// two independent paths: the MDM channel (configuration profiles, compliance policies,
// the settings catalog) and the management-agent channel (Win32 apps, PowerShell/shell
// scripts, Remediations). `lastSyncDateTime` — the number a console shows and the number
// a naive bridge maps to "checked in" — covers only the first. A device whose agent
// stopped running three weeks ago keeps reporting a fresh check-in while every app
// install, script and remediation queued since then has silently not happened.
const agentStale = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["agent-checkin-stale"].deviceId));
check("a device FRESH on MDM but STALE on the agent channel is not healthy — the console's number does not cover apps, scripts or remediations", agentStale.recommendedAction === "step_up" && agentStale.managementEffective === false);
check("...and the verdict NAMES the channel that went quiet, not a generic unknown", agentStale.posture === "stale_agent_channel" && agentStale.reasonCode === "AGENT_CHECKIN_STALE");
check("...and it never composes to 'ok'", composeDeviceRisk([fromDeviceManagementHealth(agentStale)]).riskTier !== "ok");
const agentNever = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["agent-checkin-never"].deviceId));
check("an agent that has NEVER run reports its own reason code", agentNever.reasonCode === "AGENT_CHECKIN_NEVER" && agentNever.recommendedAction === "step_up");
// When BOTH channels are quiet the MDM reading is the better headline — nothing at all
// is reaching the device — so it wins the tie. Ordering, not severity.
const bothStale = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["both-channels-stale"].deviceId));
check("when BOTH channels are stale, the MDM channel is the headline (nothing is reaching the device)", bothStale.reasonCode === "MDM_CHECKIN_STALE");
// `not_applicable` is a POSITIVE assertion — iOS/iPadOS has no management agent, so a
// ward iPad must be able to be confirmed healthy. Silence is not that assertion.
const agentUnreported = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["agent-checkin-unreported"].deviceId));
check("an UNREPORTED agent channel is 'unknown', never an implied not_applicable", agentUnreported.reasonCode === "MANAGEMENT_STATE_UNKNOWN" && agentUnreported.unknownSignals.includes("agent_check_in_freshness"));
check("...so a bridge that simply omits the field cannot grant by omission", agentUnreported.managementEffective === false);
// A bridge cannot claim the platform has no agent channel AND report a state only that
// channel produces. We do not know which half is wrong, so neither is believed.
const inconsistent = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["channel-report-inconsistent"].deviceId));
check("'no agent channel' + 'remediations healthy' is self-contradictory → step_up, never a grant", inconsistent.reasonCode === "CHANNEL_REPORT_INCONSISTENT" && inconsistent.managementEffective === false);
check("...and the contradiction is the headline, so the operator fixes the bridge, not the device", inconsistent.posture === "unverified" && inconsistent.unknownSignals.includes("channel_consistency"));
// The guard has THREE remediation terms and the first draft only ever exercised one of
// them. Mutation-testing found that deleting either of the other two left the proof at
// 141/141 green while silently changing the reason code — the exact "load-bearing but
// unproven" state pass 3 exists to prevent, reopened in new code. One fixture per term.
const inconsistentFailed = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["channel-inconsistent-remediation-failed"].deviceId));
check("'no agent channel' + 'remediation script FAILED' is contradictory too, and says so", inconsistentFailed.reasonCode === "CHANNEL_REPORT_INCONSISTENT");
// The sharpest of the three. `issues_detected` alerts, and alert outranks this step_up,
// so before the fix the contradiction was never the headline and the verdict carried
// `remediation_issues_detected` in criticalFindings — a field documented as CONFIRMED
// KNOWN-BAD FACTS — sourced from the half of the report it had just disbelieved.
const inconsistentDetected = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["channel-inconsistent-issues-detected"].deviceId));
check("'no agent channel' + 'defect detected' does NOT alert — a disbelieved claim is not evidence", inconsistentDetected.reasonCode === "CHANNEL_REPORT_INCONSISTENT" && inconsistentDetected.recommendedAction === "step_up");
check("...and the disbelieved claim is NOT cited as a confirmed fact", inconsistentDetected.criticalFindings.length === 0);
// An agent that has NEVER run cannot have produced a remediation result either. The
// guard originally covered only `not_applicable`, and the repo's own `agent-checkin-never`
// fixture was an uncaught instance of the contradiction it failed to model.
const inconsistentNever = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["channel-inconsistent-agent-never"].deviceId));
check("an agent that NEVER ran cannot have reported a remediation result — also contradictory", inconsistentNever.reasonCode === "CHANNEL_REPORT_INCONSISTENT");
// Silence is not contradiction. "No agent channel" + "remediation state unreported" is
// an honest report of a platform with neither, and must read as a plain unknown.
const silentNotContradictory = normalizeReport("sn", { mdmCheckInFreshness: "fresh", agentCheckInFreshness: "not_applicable", policyDrift: "on_baseline", complianceCoverage: "covered", enrollmentState: "enrolled", managementReachable: true });
check("'no agent channel' + remediation UNREPORTED is silence, not contradiction", evaluateDeviceManagementHealth(silentNotContradictory).reasonCode === "MANAGEMENT_STATE_UNKNOWN" && !evaluateDeviceManagementHealth(silentNotContradictory).unknownSignals.includes("channel_consistency"));
// The old single field is now an UNRECOGNIZED key. A bridge still emitting it fails
// loudly rather than being half-read as an MDM-only check-in.
const legacy = await connector.fetchHealth(fixture.devices["legacy-checkin-key"].deviceId);
check("a bridge still emitting the pre-split `checkInFreshness` is malformed, not silently half-read", legacy.reportIntegrity === "malformed" && legacy.mdmCheckInFreshness === "unknown");
check("...and cannot grant", evaluateDeviceManagementHealth(legacy).recommendedAction === "step_up");

// ── remediation health ────────────────────────────────────────────────────────
//
// A Remediations pair (detection script + remediation script) reports per device. A
// detection that FOUND something and was never fixed is a confirmed fact about the
// device, not a gap in what we know — so it outranks every step_up. It is not a
// restrict: the script is arbitrary customer code and we cannot know the severity of
// what it found, and containing every device with any open detection would make the
// strongest action mean nothing.
const detected = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["remediation-issues-detected"].deviceId));
check("a DETECTED, unremediated defect → alert + a critical finding (a fact, not an unknown)", detected.recommendedAction === "alert" && detected.posture === "unremediated_defect" && detected.criticalFindings.includes("remediation_issues_detected"));
check("...and it never composes to 'ok'", composeDeviceRisk([fromDeviceManagementHealth(detected)]).riskTier !== "ok");
const detectedOverStale = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["remediation-issues-outrank-a-dead-channel"].deviceId));
check("a confirmed defect outranks stale channels and drift — staleness makes it MORE likely still present, not less", detectedOverStale.reasonCode === "REMEDIATION_ISSUES_DETECTED");
const remFailed = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["remediation-failed"].deviceId));
check("a remediation script that COULD NOT RUN is a broken channel, not a known defect → step_up", remFailed.reasonCode === "REMEDIATION_FAILED" && remFailed.criticalFindings.length === 0);
const remUnreported = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["remediation-unreported"].deviceId));
check("an UNREPORTED remediation state is unknown and denies", remUnreported.reasonCode === "MANAGEMENT_STATE_UNKNOWN" && remUnreported.managementEffective === false);
// Severity still wins over ordering: an alert-level fact does not outrank containment.
const worstWithDefect = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["worst-of-several"].deviceId));
check("a RESTRICT still outranks a detected defect — the alert only wins among softer readings", worstWithDefect.recommendedAction === "restrict" && worstWithDefect.criticalFindings.includes("remediation_issues_detected"));

// A device that has NEVER checked in is the dimension's motivating case — a ward iPad
// that went silent — and the verdict must be able to NAME it. An earlier draft demoted
// the surrounding claims to `unknown` on the reasoning that they were derived from a
// check-in that never happened; measured over the full raw space that changed the action
// on zero reports while making MDM_CHECKIN_NEVER unreachable at the wire layer entirely.
// The normalizer now reports what the bridge said, and the evaluator judges it.
const never = await connector.fetchHealth(fixture.devices["mdm-checkin-never"].deviceId);
check("a device that NEVER checked in reports its own reason code, not a generic unknown", evaluateDeviceManagementHealth(never).reasonCode === "MDM_CHECKIN_NEVER");
check("...and it never grants", evaluateDeviceManagementHealth(never).recommendedAction === "step_up" && evaluateDeviceManagementHealth(never).managementEffective === false);
// Ordering is load-bearing for diagnosis: every one of these is step_up, and
// worst-concern-wins keeps the FIRST candidate on a tie, so a silent device outranks the
// softer readings that are downstream of its silence.
const neverAndDrifted = normalizeReport("nd", { mdmCheckInFreshness: "never", agentCheckInFreshness: "not_applicable", remediationHealth: "not_applicable", policyDrift: "drifted", complianceCoverage: "covered", enrollmentState: "enrolled", managementReachable: true });
check("a silent device outranks its own (stale) drift reading in the reason code", evaluateDeviceManagementHealth(neverAndDrifted).reasonCode === "MDM_CHECKIN_NEVER");
// Severity still wins over ordering — a restrict beats any step_up regardless of order.
const neverAndRetired = normalizeReport("nr", { mdmCheckInFreshness: "never", agentCheckInFreshness: "not_applicable", remediationHealth: "not_applicable", policyDrift: "on_baseline", complianceCoverage: "covered", enrollmentState: "retired", managementReachable: true });
check("but a RESTRICT still outranks it — ordering only breaks ties within a severity", evaluateDeviceManagementHealth(neverAndRetired).recommendedAction === "restrict" && evaluateDeviceManagementHealth(neverAndRetired).reasonCode === "ENROLLMENT_RETIRED");
// The normalizer reports what the bridge said and never manufactures a confirmation.
const stillUnknown = normalizeReport("g", { mdmCheckInFreshness: "fresh", agentCheckInFreshness: "not_applicable", remediationHealth: "not_applicable", policyDrift: "unknown", complianceCoverage: "unknown", enrollmentState: "enrolled", managementReachable: true });
check("an unknown is never promoted to a confirmation", stillUnknown.policyDrift === "unknown" && stillUnknown.complianceCoverage === "unknown");

// No management result at all → a gap → step_up (never an effective-management grant).
const noCov = evaluateDeviceManagementHealth(normalizeReport("ghost", {}), { covered: false });
check("an uncovered device is 'unknown'/step_up, never effectively managed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.managementEffective === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromDeviceManagementHealth(noCov)]).riskTier !== "ok");

// The grant demands POSITIVE confirmation the plane answered for THIS device.
const noReach = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["reachability-unreported"].deviceId));
check("UNREPORTED management reachability → step_up, never granted", noReach.reasonCode === "MANAGEMENT_UNREACHABLE" && noReach.managementEffective === false);
check("only an explicit managementReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromDeviceManagementHealth(noReach)]).riskTier !== "ok");
// An explicit `false` is the plane saying it did not answer for this device — a fact,
// not a gap — so it is judged near the top rather than last. Measured before the fix:
// MANAGEMENT_UNREACHABLE headlined 9 of 1,037,232 raw reports while 172,872 of them
// carried an explicit false, because an asserted negative was losing the step_up tie to
// any generic MANAGEMENT_STATE_UNKNOWN from one unreadable field.
const assertedUnreachable = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["unreachable-outranks-an-unknown-field"].deviceId));
check("an ASSERTED 'the plane did not answer' outranks a generic unknown from another field", assertedUnreachable.reasonCode === "MANAGEMENT_UNREACHABLE");
check("...but it is not a critical finding — that field is facts about the DEVICE, and this is a fact about the read", assertedUnreachable.criticalFindings.length === 0);

// Report integrity: a field PRESENT but unparseable is an assertion we could not read,
// which is not the same as silence. The allowlist folds both into "unknown", so
// presence is tracked separately and independently denied on.
const malformed = await connector.fetchHealth(fixture.devices["report-malformed-enum"].deviceId);
check("an unparseable enum value marks the report malformed", malformed.reportIntegrity === "malformed" && malformed.mdmCheckInFreshness === "unknown");
const malformedAgent = await connector.fetchHealth(fixture.devices["report-malformed-agent-enum"].deviceId);
check("an unparseable AGENT channel value is malformed too — the new fields are not exempt", malformedAgent.reportIntegrity === "malformed" && malformedAgent.agentCheckInFreshness === "unknown");
const malformedBool = await connector.fetchHealth(fixture.devices["report-malformed-boolean"].deviceId);
check("a string-quoted boolean is an assertion, not silence", malformedBool.reportIntegrity === "malformed" && malformedBool.managementReachable === null);
const aliased = await connector.fetchHealth(fixture.devices["report-aliased-keys"].deviceId);
check("an unrecognized key means the envelope was not understood", aliased.reportIntegrity === "malformed");
// The key scan walks the prototype chain with Reflect.ownKeys. The shipped HTTP
// transport hands us a JSON.parse result, but the transport is injectable — an
// in-process adapter returning a class instance or Proxy could otherwise hide an
// assertion where Object.keys cannot see it.
//
// Every shape below is built from CLEAN_WIRE — a report that DOES grant when passed
// through untouched — so each check isolates exactly the hostile property it names. If
// the base stopped granting these would pass vacuously, so it is asserted first.
const CLEAN_WIRE = {
  mdmCheckInFreshness: "fresh", agentCheckInFreshness: "fresh", remediationHealth: "healthy",
  policyDrift: "on_baseline", complianceCoverage: "covered", enrollmentState: "enrolled",
  managementReachable: true,
} as const;
check("the base wire report used by the hostile-shape checks below DOES grant (they are not vacuous)", evaluateDeviceManagementHealth(normalizeReport("cw", { ...CLEAN_WIRE })).recommendedAction === "none");
const inherited = normalizeReport("inh", Object.create({ ...CLEAN_WIRE }) as DeviceManagementHealthReportRaw);
check("a report with ZERO own keys asserts nothing — every field falls to unknown", inherited.mdmCheckInFreshness === "unknown" && inherited.agentCheckInFreshness === "unknown" && inherited.remediationHealth === "unknown" && inherited.managementReachable === null);
check("...and therefore cannot grant", evaluateDeviceManagementHealth(inherited).recommendedAction !== "none");
// Own-only READS and the chain SCAN are deliberately asymmetric — see the connector.
// An inherited value confirms nothing, but an inherited UNRECOGNIZED key is still an
// assertion in a spelling we ignore.
const aliasOnProto = Object.assign(Object.create({ agent_check_in_freshness: "stale" }), CLEAN_WIRE) as DeviceManagementHealthReportRaw;
check("an unrecognized key INHERITED from the prototype is still an unrecognized envelope", normalizeReport("ap", aliasOnProto).reportIntegrity === "malformed");
check("...so a report whose own keys all confirm still cannot grant", evaluateDeviceManagementHealth(normalizeReport("ap", aliasOnProto)).recommendedAction !== "none");
const symbolKeyed = Object.assign({}, CLEAN_WIRE) as DeviceManagementHealthReportRaw;
(symbolKeyed as Record<symbol, unknown>)[Symbol.for("agentCheckInFreshness")] = "stale";
check("a SYMBOL-keyed assertion is an unrecognized envelope", normalizeReport("sym", symbolKeyed).reportIntegrity === "malformed");
const { agentCheckInFreshness: _hoisted, ...restOfClean } = CLEAN_WIRE;
const knownOnProto = Object.assign(Object.create({ agentCheckInFreshness: "fresh" }), restOfClean) as DeviceManagementHealthReportRaw;
check("a RECOGNIZED key inherited from the prototype is an unrecognized envelope", normalizeReport("kp", knownOnProto).reportIntegrity === "malformed");
check("...and cannot grant", evaluateDeviceManagementHealth(normalizeReport("kp", knownOnProto)).recommendedAction !== "none");
const throwingKeys = new Proxy({ ...CLEAN_WIRE }, { ownKeys: () => { throw new Error("hostile"); } }) as DeviceManagementHealthReportRaw;
check("a Proxy that THROWS from ownKeys fails closed, it does not grant", evaluateDeviceManagementHealth(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
check("a null report body is malformed, not an untyped TypeError", normalizeReport("nb", null as unknown as DeviceManagementHealthReportRaw).reportIntegrity === "malformed");
const endlessProto = (): object => new Proxy({}, { getPrototypeOf: () => endlessProto(), ownKeys: () => [] });
check("a Proxy with an endless prototype chain terminates and fails closed", normalizeReport("ep", endlessProto() as DeviceManagementHealthReportRaw).reportIntegrity === "malformed");
check("an ARRAY report is malformed, never a grant", normalizeReport("arr", [] as unknown as DeviceManagementHealthReportRaw).reportIntegrity === "malformed");
const hidden = new Proxy(
  { ...CLEAN_WIRE, agent_check_in_freshness: "stale" },
  { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined },
) as DeviceManagementHealthReportRaw;
check("a Proxy that hides BOTH its keys and its descriptors reads as ABSENT and cannot grant", evaluateDeviceManagementHealth(normalizeReport("px", hidden)).recommendedAction !== "none");
// The honest limit, asserted rather than implied. A Proxy that hides a key from `ownKeys`
// while still answering `getOwnPropertyDescriptor` keeps its values readable, so the key
// scan sees nothing and the report grants. This is disclosed in INTEGRATION_CATALOG —
// a Proxy can always lie about its own shape — and the previous check's name ("hides its
// own properties") read as if it covered this, which it does not. Pinning the real
// behaviour means the disclosure cannot silently drift away from the code.
const hidesKeysOnly = new Proxy(
  { ...CLEAN_WIRE, agent_check_in_freshness: "stale" },
  { ownKeys: () => [...DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS] },
) as DeviceManagementHealthReportRaw;
check("KNOWN LIMIT: a Proxy that hides only its KEYS keeps its values and does grant — a Proxy can always lie about its shape", evaluateDeviceManagementHealth(normalizeReport("pk", hidesKeysOnly)).recommendedAction === "none");
// A report that IS Object.prototype was never scanned at all: the walk's stop condition
// `o !== Object.prototype` was evaluated before the first iteration, so a polluted
// prototype normalized to clean and granted. `isPlainReport` now excludes it.
const pollutionKeys = Object.keys(CLEAN_WIRE) as (keyof typeof CLEAN_WIRE)[];
for (const k of pollutionKeys) (Object.prototype as Record<string, unknown>)[k] = CLEAN_WIRE[k];
const asPrototype = normalizeReport("op", Object.prototype as DeviceManagementHealthReportRaw);
for (const k of pollutionKeys) delete (Object.prototype as Record<string, unknown>)[k];
check("a report that IS Object.prototype is malformed — the chain terminus is not the report", asPrototype.reportIntegrity === "malformed");
check("...and a polluted prototype passed as the report cannot grant", evaluateDeviceManagementHealth(asPrototype).recommendedAction !== "none");
// An own ACCESSOR that throws must land where every unreadable report lands, not escape
// as a bare Error. isPlainReport and the key scan both fail closed for this reason; the
// seven field reads were the one gap in that story.
const throwingAccessor = Object.defineProperty({ ...CLEAN_WIRE }, "policyDrift", {
  get() { throw new Error("hostile accessor"); }, enumerable: true, configurable: true,
}) as DeviceManagementHealthReportRaw;
let accessorThrew = false;
let accessorNormalized: ReturnType<typeof normalizeReport> | null = null;
try { accessorNormalized = normalizeReport("ta", throwingAccessor); } catch { accessorThrew = true; }
check("an own accessor that THROWS does not escape the normalizer as an untyped Error", accessorThrew === false);
check("...it is malformed and cannot grant", accessorNormalized?.reportIntegrity === "malformed" && evaluateDeviceManagementHealth(accessorNormalized!).recommendedAction !== "none");
const notAnObject = normalizeReport("s", "ERR: graph timeout" as unknown as DeviceManagementHealthReportRaw);
check("a non-object report is malformed, not a thrown TypeError", notAnObject.reportIntegrity === "malformed" && evaluateDeviceManagementHealth(notAnObject).recommendedAction !== "none");
check("a plain parsed-JSON report is NOT flagged by the prototype walk", normalizeReport("j", JSON.parse('{"mdmCheckInFreshness":"fresh"}') as DeviceManagementHealthReportRaw).reportIntegrity === "clean");
// JSON null is the wire spelling of "no value", not an unreadable assertion — a bridge
// emitting a fixed row shape with nulls is being honest and must behave as omission.
const nulls = normalizeReport("nl", { mdmCheckInFreshness: null, agentCheckInFreshness: null, remediationHealth: null, policyDrift: null, complianceCoverage: null, enrollmentState: null, managementReachable: null } as DeviceManagementHealthReportRaw);
check("JSON null on every field behaves as ABSENT, not as malformed", nulls.reportIntegrity === "clean" && nulls.mdmCheckInFreshness === "unknown" && nulls.agentCheckInFreshness === "unknown");
check("...and still never grants, because nothing was positively confirmed", evaluateDeviceManagementHealth(nulls).recommendedAction === "step_up");
check("a malformed report never grants, even when every parsed field looks clean", evaluateDeviceManagementHealth(aliased).recommendedAction === "step_up" && evaluateDeviceManagementHealth(aliased).managementEffective === false);
// Defence in depth: the evaluator refuses independently of the normalizer.
const forged = evaluateDeviceManagementHealth({
  sourceSystem: "device-management-health", deviceId: "forged", source: "test",
  mdmCheckInFreshness: "fresh", agentCheckInFreshness: "fresh", remediationHealth: "healthy",
  policyDrift: "on_baseline", complianceCoverage: "covered",
  enrollmentState: "enrolled", managementReachable: true, reportIntegrity: "malformed",
});
check("the EVALUATOR independently refuses a malformed report, even a fully clean-looking one", forged.recommendedAction === "step_up" && forged.managementEffective === false);

// Unknown ≠ managed: an unrecognized enum normalizes to the safe unknown.
const norm = normalizeReport("n", { mdmCheckInFreshness: "recently", agentCheckInFreshness: "ran_ok", remediationHealth: "green", enrollmentState: "in_progress", policyDrift: "maybe" });
check("unrecognized enums normalize to 'unknown' (never a fabricated fresh/enrolled/healthy)", norm.mdmCheckInFreshness === "unknown" && norm.agentCheckInFreshness === "unknown" && norm.remediationHealth === "unknown" && norm.enrollmentState === "unknown" && norm.policyDrift === "unknown");
const boolNorm = normalizeReport("b", { managementReachable: 1 } as unknown as DeviceManagementHealthReportRaw);
check("a non-boolean managementReachable is null, never fabricated", boolNorm.managementReachable === null);
// Case and whitespace are canonicalized, so a shouty bridge is understood, not rejected.
const shouty = normalizeReport("s", { mdmCheckInFreshness: " FRESH ", agentCheckInFreshness: "Not_Applicable", remediationHealth: " Healthy", enrollmentState: "Enrolled" });
check("case/whitespace variants are canonicalized, not treated as malformed", shouty.reportIntegrity === "clean" && shouty.mdmCheckInFreshness === "fresh" && shouty.agentCheckInFreshness === "not_applicable" && shouty.remediationHealth === "healthy" && shouty.enrollmentState === "enrolled");

// ── exhaustive, in THREE passes over two DIFFERENT spaces ──────────────────────
//
// Pass 1 quantifies over the NORMALIZED space (including reportIntegrity) against the
// evaluator alone: action "none" is emitted for exactly the five-way confirmation, and
// never on a report flagged malformed.
//
// `channelsConsistent` is the ONE cross-field term in the contract, stated once and
// reused by both passes. A bridge may report an agent channel that is fresh (then
// remediations are either healthy or unassigned) or one it positively asserts does not
// exist (then remediations must be unassigned too — a state only the agent channel
// produces cannot be reported for a device that has no agent channel). It is written
// here as a positive whitelist of the pairs that MAY grant, not as the negation of the
// evaluator's guard, so a guard that silently lost a term still fails.
const channelsConsistent = (agent: unknown, remediation: unknown): boolean =>
  (agent === "fresh" && (remediation === "healthy" || remediation === "not_applicable")) ||
  (agent === "not_applicable" && remediation === "not_applicable");

/** The full contradiction relation, stated independently of the evaluator's guard. A
 *  remediation state is AGENT-PRODUCED when only a run of the agent channel could have
 *  yielded it; a channel the bridge says does not exist, or has never once run, cannot
 *  have produced one. Silence (`unknown`) is not agent-produced and so not a
 *  contradiction — it is an ordinary gap. Used only for the reason-code assertions
 *  below; `channelsConsistent` above remains the grant contract. */
const channelsContradictory = (agent: unknown, remediation: unknown): boolean =>
  (agent === "not_applicable" || agent === "never") &&
  (remediation === "healthy" || remediation === "issues_detected" || remediation === "failed");

const domains = {
  mdmCheckInFreshness: ["fresh", "stale", "never", "unknown"],
  agentCheckInFreshness: ["fresh", "stale", "never", "not_applicable", "unknown"],
  remediationHealth: ["healthy", "issues_detected", "failed", "not_applicable", "unknown"],
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
    c.mdmCheckInFreshness === "fresh" &&
    channelsConsistent(c.agentCheckInFreshness, c.remediationHealth) &&
    c.policyDrift === "on_baseline" &&
    c.complianceCoverage === "covered" &&
    c.enrollmentState === "enrolled" &&
    c.managementReachable === true,
});
check(
  `exhaustive (normalized): over all ${enumRes.combos} normalized states, action 'none' requires ALL SEVEN positively confirmed — including BOTH delivery channels — and a clean report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 21600,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);
// Exactly three: a device with a live agent channel and remediations healthy, the same
// with no remediation assigned, and a platform with no agent channel at all. Pinning the
// count is what makes a fourth route into the grant a test failure rather than a silent
// widening.
check("exhaustive (normalized): exactly THREE channel shapes grant — live-agent+healthy, live-agent+unassigned, agent-less", enumRes.noneCount === 3);

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
  // Every enum field carries the same six wire CLASSES: the allowed spellings, an
  // omitted key, a JSON null, and a junk value. The two new fields were originally
  // asymmetric — `agentCheckInFreshness` omitted `null` and `remediationHealth` omitted
  // the literal `"unknown"` — while `PARSEABLE_RAW` below listed both, so the
  // parse-fidelity pass advertised coverage of two cells it never produced.
  mdmCheckInFreshness: ["fresh", "stale", "never", "unknown", undefined, null, "very_old"],
  agentCheckInFreshness: ["fresh", "stale", "never", "not_applicable", "unknown", undefined, null, 7],
  remediationHealth: ["healthy", "issues_detected", "failed", "not_applicable", "unknown", undefined, null, "green"],
  policyDrift: ["on_baseline", "drifted", "unknown", undefined, null, ["drifted"]],
  complianceCoverage: ["covered", "uncovered", "unknown", undefined, null, {}],
  enrollmentState: ["enrolled", "failed", "retired", "unknown", undefined, null, "pending_enrollment"],
  managementReachable: [true, false, null, undefined, "true", 1],
  __alias: ["absent", "present"],
};
// Pass 2 also carries a free rider. The harness calls `evaluate` once per combination,
// so wrapping it audits the ENTIRE raw space at zero extra cost — which is what finding
// #2 needed: grant-ness cannot see a claim being cited from a disbelieved report,
// because both readings deny. Counting it directly can.
let contradictoryCount = 0;
let citedWhileContradictory = 0;
// Figures the docs DISCLOSE as costs of the candidate ordering. They were originally
// measured by a throwaway script and quoted in prose, which is how the previous pair of
// disclosure numbers went stale by a factor of 64. Counted here so they cannot.
let driftedGeneric = 0;
let unreachableHeadline = 0;
let explicitUnreachable = 0;
const evaluateAndAudit = (n: NormalizedDeviceManagementHealth): ReturnType<typeof evaluateDeviceManagementHealth> => {
  const v = evaluateDeviceManagementHealth(n);
  if (channelsContradictory(n.agentCheckInFreshness, n.remediationHealth)) {
    contradictoryCount += 1;
    if (
      v.reasonCode === "REMEDIATION_ISSUES_DETECTED" ||
      v.reasonCode === "REMEDIATION_FAILED" ||
      v.criticalFindings.includes("remediation_issues_detected")
    ) {
      citedWhileContradictory += 1;
    }
  }
  if (n.policyDrift === "drifted" && v.reasonCode === "MANAGEMENT_STATE_UNKNOWN") driftedGeneric += 1;
  if (v.reasonCode === "MANAGEMENT_UNREACHABLE") unreachableHeadline += 1;
  if (n.managementReachable === false) explicitUnreachable += 1;
  return v;
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as DeviceManagementHealthReportRaw;
    if (__alias === "present") raw.policy_drift = "drifted";
    return normalizeReport("enum", raw, "enum");
  },
  evaluate: evaluateAndAudit,
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
    c.mdmCheckInFreshness === "fresh" &&
    channelsConsistent(c.agentCheckInFreshness, c.remediationHealth) &&
    c.policyDrift === "on_baseline" &&
    c.complianceCoverage === "covered" &&
    c.enrollmentState === "enrolled" &&
    c.managementReachable === true,
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — including junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects and an aliased extra key — normalizeReport + evaluate grant ONLY the seven-way confirmation (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 1354752,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
check("exhaustive (raw wire): exactly THREE raw reports grant — one per consistent channel shape, and nothing else", rawEnumRes.noneCount === 3);
check(
  `exhaustive (raw wire): across all ${contradictoryCount} self-contradictory reports, NOT ONE cites the disbelieved remediation claim — no REMEDIATION_* reason code and no remediation critical finding (violations=${citedWhileContradictory})`,
  citedWhileContradictory === 0 && contradictoryCount > 0,
);

// Pass 3 — PARSE FIDELITY, over the same raw space.
//
// Passes 1 and 2 only ever observe grant-ness, and every malformed value already
// normalizes to a denying `unknown`. That makes each individual integrity condition
// INVISIBLE to them: deleting one changes `reportIntegrity` but not the action, so the
// enumeration stays at 0 mismatches and the condition is load-bearing but unproven.
// Mutation testing found exactly that hole. This pass closes it by asserting the
// integrity flag itself against an independent positive allowlist of wire values.
const PARSEABLE_RAW: Record<string, readonly unknown[]> = {
  mdmCheckInFreshness: [undefined, null, "fresh", "stale", "never", "unknown"],
  agentCheckInFreshness: [undefined, null, "fresh", "stale", "never", "not_applicable", "unknown"],
  remediationHealth: [undefined, null, "healthy", "issues_detected", "failed", "not_applicable", "unknown"],
  policyDrift: [undefined, null, "on_baseline", "drifted", "unknown"],
  complianceCoverage: [undefined, null, "covered", "uncovered", "unknown"],
  enrollmentState: [undefined, null, "enrolled", "failed", "retired", "unknown"],
  managementReachable: [undefined, null, true, false],
};
const integrityRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as DeviceManagementHealthReportRaw;
    if (__alias === "present") raw.policy_drift = "drifted";
    return normalizeReport("enum", raw, "enum");
  },
  // The normalized report IS the verdict for this pass; "none" stands for "clean".
  evaluate: (n) => n,
  actionOf: (n) => (n.reportIntegrity === "clean" ? "none" : "malformed"),
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    Object.keys(PARSEABLE_RAW).every((k) => PARSEABLE_RAW[k].includes(c[k])),
});
check(
  `parse fidelity: over all ${integrityRes.combos} raw reports, reportIntegrity is 'clean' for EXACTLY the reports whose every field carries a parseable wire value and which carry no unrecognized key (mismatches=${integrityRes.mismatches}${integrityRes.firstMismatch ? ", first=" + integrityRes.firstMismatch : ""})`,
  integrityRes.mismatches === 0 && integrityRes.combos === productOf(rawDomains),
);
check("parse fidelity: both outcomes occur (the pass is not vacuous)", integrityRes.noneCount > 0 && integrityRes.noneCount < integrityRes.combos);

// Worst-concern-wins: the restrict outranks the drift/check-in step_ups.
const worst = evaluateDeviceManagementHealth(await connector.fetchHealth(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: a retired enrollment (restrict) outranks a detected defect, drift and two dead channels", worst.recommendedAction === "restrict" && worst.criticalFindings.length === 3);

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

// One machine-readable line, derived from the SAME variables the checks above asserted
// on — not restated by hand, which is the mistake this feeds a guard against.
console.log(`figures=normalized=${enumRes.combos},raw=${rawEnumRes.combos},grants=${rawEnumRes.noneCount},contradictory=${contradictoryCount},driftedGeneric=${driftedGeneric},unreachableHeadline=${unreachableHeadline},explicitUnreachable=${explicitUnreachable}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
