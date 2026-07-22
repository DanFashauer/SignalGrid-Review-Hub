// OT / IIoT edge-device posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only ot-posture connector against captured edge-gateway reports
// (the grid_collected path for the plant floor) and runs the pure evaluator per
// device — asserting each resolves to the right posture and action. The fail-safe
// boundary is the whole point: a flat network / exposed OT protocol / unpatchable
// EOL device restricts; a stale gateway or any unreadable control steps up, NEVER
// reads as secure; a device no gateway sees is a blind spot, never secure. No
// network, no plant access.
//
// It also proves the fabric fuses this dimension: fromOtPosture → an ot_posture
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OtPostureConnector,
  OtConnectorError,
  createMockOtTransport,
  evaluateOtPosture,
  guardReadOnly,
  normalizeReport,
  resolveOtPostureConnector,
  type OtDeviceReportRaw,
} from "@workspace/integrations/ot-posture";
import { composeDeviceRisk, fromOtPosture } from "@workspace/posture-composition";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  deviceType: string | null;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: OtDeviceReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/ot-posture/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://gateway.local/ot-posture";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("OT / IIoT edge-device posture proof (grid_collected)");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, OtDeviceReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockOtTransport({ reports, expectedToken: fixture.accessToken });
const connector = new OtPostureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchPosture(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "ot-posture");
  const v = evaluateOtPosture(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.deviceType === spec.expected.deviceType;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ────────────────────────────────────────────────────────

// No gateway reports the device → unknown (blind spot). Fail-safe: step_up (never
// 'monitor', which composes to the "ok"/secure tier — less data must not read safer).
const noCov = evaluateOtPosture(normalizeReport("ghost", {} as OtDeviceReportRaw), { covered: false });
check("an uncovered OT device is 'unknown'/step_up, never secure", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up");
const uncoveredComposed = composeDeviceRisk([fromOtPosture(noCov)]);
check("an uncovered OT device composes to at_risk, NEVER the 'ok' tier", uncoveredComposed.riskTier !== "ok" && uncoveredComposed.strongestAction === "step_up");

// An entirely UNREADABLE report resolves to unverified/step_up, never secure.
const blank = evaluateOtPosture(normalizeReport("blank", {} as OtDeviceReportRaw));
check("a fully-unreadable OT report is 'unverified'/step_up, never 'secure'", blank.posture === "unverified" && blank.recommendedAction === "step_up");
check("unknown firmware/segmentation/protocol/gateway are all counted unknown", blank.unknownSignals.length === 5);

// Unknown ≠ secure: an unrecognized enum value must normalize to the safe unknown.
const norm = normalizeReport("n", { firmware: { status: "brand-new-state" }, network: { segmentation: "sideways" } } as OtDeviceReportRaw);
check("an unrecognized enum normalizes to 'unknown' (not a fabricated value)", norm.firmware === "unknown" && norm.segmentation === "unknown");

// Worst-concern-wins: flat + eol + stale → restrict (not diluted by the step_up).
const worst = evaluateOtPosture(await connector.fetchPosture(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: a critical finding (restrict) outranks a stale gateway (step_up)", worst.recommendedAction === "restrict" && worst.criticalFindings.length === 3);

// Determinism.
const d = await connector.fetchPosture(fixture.devices["flat-network"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateOtPosture(d)) === JSON.stringify(evaluateOtPosture(d)));

// ── fabric fusion ────────────────────────────────────────────────────────────────

const flat = evaluateOtPosture(await connector.fetchPosture(fixture.devices["flat-network"].deviceId));
const signal = fromOtPosture(flat);
check("fromOtPosture emits an ot_posture signal", signal.kind === "ot_posture");
const composed = composeDeviceRisk([signal]);
check("fabric fuses an exposed OT device into a restrict-or-stronger verdict", ["restrict", "escalate"].includes(composed.strongestAction));

// Regression (review minor): an unpatchable device whose firmware is NOT end-of-life
// restricts but is labeled honestly (FIRMWARE_UNPATCHABLE, not FIRMWARE_EOL).
const unpatchable = evaluateOtPosture(normalizeReport("u", { firmware: { status: "current", patchable: false }, network: { segmentation: "segmented", insecure_protocol_exposed: false }, gateway: { liveness: "live" } } as OtDeviceReportRaw));
check("a non-EOL unpatchable device is labeled FIRMWARE_UNPATCHABLE (not FIRMWARE_EOL)", unpatchable.posture === "unpatchable" && unpatchable.recommendedAction === "restrict" && unpatchable.reasonCode === "FIRMWARE_UNPATCHABLE");
const secure = fromOtPosture(evaluateOtPosture(await connector.fetchPosture(fixture.devices["secure-plc"].deviceId)));
check("a secure OT device contributes 'none' to the fabric", secure.action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof OtConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new OtPostureConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["secure-plc"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: OtConnectorError | null = null;
try { await bad.fetchPosture(fixture.devices["secure-plc"].deviceId); } catch (err) { authErr = err instanceof OtConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: OtConnectorError | null = null;
try { await connector.fetchPosture("no-such-device"); } catch (err) { missingErr = err instanceof OtConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented posture", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveOtPostureConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveOtPostureConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveOtPostureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveOtPostureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", OT_POSTURE_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
