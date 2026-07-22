// macOS endpoint-posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only macos-posture connector against captured signalgrid-mcp
// posture reports (the grid_collected path for a Mac) and runs the pure evaluator
// per device — asserting each report resolves to the right endpoint-hardening
// posture and the action it warrants. The whole point is the fail-safe boundary:
// a disabled control restricts; a control whose state could NOT be read raises
// the bar (step_up), NEVER reads as compliant; a Mac with no report is a blind
// spot, never "hardened". No network, no device access.
//
// It also proves the fabric fuses this dimension: fromMacosPosture → a
// device_posture ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MacosPostureConnector,
  MacosPostureConnectorError,
  createMockMacosTransport,
  evaluateMacosPosture,
  guardReadOnly,
  normalizeReport,
  resolveMacosPostureConnector,
  type MacosPostureReportRaw,
} from "@workspace/integrations/macos-posture";
import { composeDeviceRisk, fromMacosPosture } from "@workspace/posture-composition";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  controlsOffCount: number;
  controlsUnknownCount: number;
  mdmEnrolled: boolean | null;
  osVersion: string | null;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: MacosPostureReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/macos-posture/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://bridge.local/macos-posture";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("macOS endpoint-posture proof (grid_collected)");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

// Build a mock bridge serving every fixture report, then pull each through the
// read-only connector (exercises normalization + read-only + auth).
const reports: Record<string, MacosPostureReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockMacosTransport({ reports, expectedToken: fixture.accessToken });
const connector = new MacosPostureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

// Per-device posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchPosture(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "macos-posture");
  const v = evaluateMacosPosture(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.controlsOff.length === spec.expected.controlsOffCount &&
    v.controlsUnknown.length === spec.expected.controlsUnknownCount &&
    v.mdmEnrolled === spec.expected.mdmEnrolled &&
    v.osVersion === spec.expected.osVersion;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// No report at all → unknown (blind spot), never hardened.
const noReport = evaluateMacosPosture(
  normalizeReport("ghost", {} as MacosPostureReportRaw),
  { covered: false },
);
check("an uncovered device is 'unknown', never 'hardened'", noReport.posture === "unknown" && noReport.reasonCode === "NOT_COVERED");
// Regression (review finding): an uncovered Mac must RAISE the bar (step_up), never
// 'monitor' — 'monitor' composes to the "ok" tier, so a Mac we have ZERO data on
// would read as fine. Less information must never yield less concern.
check("an uncovered device raises to step_up (not 'monitor' → 'ok' tier)", noReport.recommendedAction === "step_up");
const uncoveredComposed = composeDeviceRisk([fromMacosPosture(noReport)]);
check("an uncovered Mac composes to at_risk, NEVER the 'ok' tier", uncoveredComposed.riskTier !== "ok" && uncoveredComposed.strongestAction === "step_up");

// The core fail-safe: an entirely UNREADABLE report (every probe unknown) resolves
// to unverified/step_up, never hardened. Unknown ≠ on.
const blank = evaluateMacosPosture(normalizeReport("blank", {} as MacosPostureReportRaw));
check("a fully-unreadable report is 'unverified'/step_up, never 'hardened'", blank.posture === "unverified" && blank.recommendedAction === "step_up");
check("an unreadable report reports every control as unknown (not off, not on)", blank.controlsUnknown.includes("sip") && blank.controlsOff.length === 0);

// unknown ≠ off: a null enabled must normalize to unknown, not off.
const nullCtrl = normalizeReport("n", { security: { sip: { enabled: null } } } as MacosPostureReportRaw);
check("a null control normalizes to 'unknown' (not 'off')", nullCtrl.sip === "unknown");

// Order-proof: a device that is unmanaged (step_up) AND has a control off (restrict)
// AND auto-update off (monitor) → the strongest concern (restrict) wins.
const worst = evaluateMacosPosture(await connector.fetchPosture(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: control-off (restrict) outranks unmanaged + patch-lag", worst.recommendedAction === "restrict");

// A "not found:"/"unavailable" sentinel string is treated as unknown, never a value.
const sentinel = normalizeReport("s", { os: { product_version: "not found: sw_vers" }, xprotect: { xprotect_definitions: "unavailable: defaults" } } as MacosPostureReportRaw);
check("collector sentinel strings normalize to null/unknown", sentinel.osVersion === null && sentinel.malwareDefs === "unknown");
// Regression (review finding): a `defaults`/`stat` format artifact that was never
// substituted ("%Su") is junk, not a value — it must degrade to null/unknown,
// never a fabricated reading that suppresses the fail-safe unknown contributor.
const junk = normalizeReport("j", { os: { product_version: "%Su" }, xprotect: { xprotect_definitions: "%Su" } } as MacosPostureReportRaw);
check("a '%'-format junk string normalizes to null/unknown (not fabricated)", junk.osVersion === null && junk.malwareDefs === "unknown");

// ── system extensions (stranded / conflicting agent) ───────────────────────────
// A hardened Mac EXCEPT a stranded security extension — the residual agent is a
// real hardening gap (it blocks reinstall of protection).
const HARDENED = {
  os: { product_version: "15.5" },
  security: { sip: { enabled: true }, filevault: { enabled: true }, gatekeeper: { enabled: true }, firewall: { enabled: true } },
  mdm: { mdm_enrolled: true },
  updates: { AutomaticCheckEnabled: true },
  xprotect: { xprotect_definitions: "2183" },
} as unknown as MacosPostureReportRaw;
const stranded = evaluateMacosPosture(normalizeReport("mac-strand", {
  ...HARDENED,
  system_extensions: { available: true, reliable: true, residual_count: 1, extensions: [{ category: "com.apple.system_extension.endpoint_security", status: "residual", enabled: false }] },
} as MacosPostureReportRaw));
check("a stranded security extension → weakened/restrict (blocks protection reinstall)", stranded.posture === "weakened" && stranded.recommendedAction === "restrict" && stranded.reasonCode === "SECURITY_EXTENSION_STRANDED");

// Two enabled endpoint-security extensions → conflict.
const conflict = evaluateMacosPosture(normalizeReport("mac-conflict", {
  ...HARDENED,
  system_extensions: { available: true, reliable: true, residual_count: 0, extensions: [
    { category: "com.apple.system_extension.endpoint_security", status: "active", enabled: true },
    { category: "com.apple.system_extension.endpoint_security", status: "active", enabled: true },
  ] },
} as MacosPostureReportRaw));
check("two enabled endpoint-security extensions → conflict/restrict", conflict.reasonCode === "SECURITY_EXTENSION_CONFLICT" && conflict.recommendedAction === "restrict");

// A system_extensions section provided but UNREADABLE raises the bar (fail-safe).
const sxUnreliable = evaluateMacosPosture(normalizeReport("mac-sxbad", {
  ...HARDENED,
  system_extensions: { available: false },
} as MacosPostureReportRaw));
check("an unreadable system_extensions section → unverified/step_up (not a silent pass)", sxUnreliable.controlsUnknown.includes("system_extensions") && sxUnreliable.recommendedAction === "step_up");

// An ABSENT section is NOT a factor — a hardened Mac stays hardened (we do not
// raise the bar for a signal we never claimed to assess).
const noSx = evaluateMacosPosture(normalizeReport("mac-nosx", HARDENED));
check("an absent system_extensions section does not penalize a hardened Mac", noSx.posture === "hardened" && noSx.sysextResidual === null);

// Regression (review MAJOR): a reliable section with an UNREADABLE extension list
// must not silently assert "no conflict" — it raises the bar instead.
const sxNoExts = evaluateMacosPosture(normalizeReport("mac-noexts", {
  ...HARDENED,
  system_extensions: { available: true, reliable: true, residual_count: 0 },
} as MacosPostureReportRaw));
check("a reliable section without a readable extension list → unverified/step_up (no silent 'no conflict')", sxNoExts.controlsUnknown.includes("system_extensions") && sxNoExts.recommendedAction === "step_up" && sxNoExts.sysextConflict === null);

// Regression (review MAJOR): a present-but-non-object section (null / string) is a
// degraded read, NOT "not assessed" — it raises the bar.
const sxNull = evaluateMacosPosture(normalizeReport("mac-sxnull", {
  ...HARDENED,
  system_extensions: null,
} as unknown as MacosPostureReportRaw));
check("a present-but-null system_extensions section → unverified/step_up (not a silent pass)", sxNull.controlsUnknown.includes("system_extensions") && sxNull.recommendedAction === "step_up");

// Regression (review MINOR): a sentinel/negative residual_count is unreadable, not
// zero — it raises the bar rather than reading clean.
const sxBadCount = evaluateMacosPosture(normalizeReport("mac-badcount", {
  ...HARDENED,
  system_extensions: { available: true, reliable: true, residual_count: -1, extensions: [] },
} as MacosPostureReportRaw));
check("a negative/sentinel residual_count → unverified/step_up (not clean)", sxBadCount.controlsUnknown.includes("system_extensions") && sxBadCount.recommendedAction === "step_up");

// Determinism.
const d = await connector.fetchPosture(fixture.devices["filevault-off"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateMacosPosture(d)) === JSON.stringify(evaluateMacosPosture(d)));

// ── fabric fusion ─────────────────────────────────────────────────────────────

// fromMacosPosture yields a device_posture signal on the unified ladder, and the
// fabric fuses it: a weakened Mac drives the composed verdict to at least restrict.
const fvOff = evaluateMacosPosture(await connector.fetchPosture(fixture.devices["filevault-off"].deviceId));
const signal = fromMacosPosture(fvOff);
check("fromMacosPosture emits a device_posture signal", signal.kind === "device_posture");
const composed = composeDeviceRisk([signal]);
check("fabric fuses a weakened Mac into a restrict-or-stronger verdict", ["restrict", "escalate", "deny"].includes(composed.strongestAction));

// A hardened Mac contributes 'none' — it does not by itself raise the verdict.
const hardened = fromMacosPosture(evaluateMacosPosture(await connector.fetchPosture(fixture.devices["hardened-managed"].deviceId)));
check("a hardened Mac contributes 'none' to the fabric", hardened.action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof MacosPostureConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new MacosPostureConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["hardened-managed"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: MacosPostureConnectorError | null = null;
try { await bad.fetchPosture(fixture.devices["hardened-managed"].deviceId); } catch (err) { authErr = err instanceof MacosPostureConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// an unknown device surfaces a typed upstream_error, never an invented posture
let missingErr: MacosPostureConnectorError | null = null;
try { await connector.fetchPosture("no-such-device"); } catch (err) { missingErr = err instanceof MacosPostureConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented posture", missingErr?.code === "upstream_error");

// gating
check("dev tier resolves to fixture mode", resolveMacosPostureConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveMacosPostureConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveMacosPostureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveMacosPostureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", MACOS_POSTURE_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
