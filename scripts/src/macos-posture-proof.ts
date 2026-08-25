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
  makeDefaultMacosTransport,
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
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

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

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. This evaluator was built under the fail-safe
// discipline from day one; the enumeration is the proof that it holds across the
// ENTIRE normalized space, not just the states someone thought of. The granting
// set is pinned by equality.
{
  const domains = {
    covered: [true, false],
    sip: ["on", "off", "unknown"],
    fileVault: ["on", "off", "unknown"],
    gatekeeper: ["on", "off", "unknown"],
    firewall: ["on", "off", "unknown"],
    mdmEnrolled: [true, false, null],
    autoUpdate: ["on", "off", "unknown"],
    malwareDefs: ["present", "unknown"],
    sysextResidual: [0, 2, null],
    sysextConflict: [true, false, null],
    sysextUnreliable: [true, false],
  } as const;

  type Enum = { p: Parameters<typeof evaluateMacosPosture>[0]; covered: boolean };
  const build = (c: Record<string, unknown>): Enum => ({
    p: {
      sourceSystem: "macos-posture",
      deviceId: "dev.enum",
      osVersion: "15.5",
      sip: c.sip, fileVault: c.fileVault, gatekeeper: c.gatekeeper, firewall: c.firewall,
      mdmEnrolled: c.mdmEnrolled, autoUpdate: c.autoUpdate, malwareDefs: c.malwareDefs,
      sysextResidual: c.sysextResidual, sysextConflict: c.sysextConflict,
      sysextUnreliable: c.sysextUnreliable,
      source: "enum",
    } as Parameters<typeof evaluateMacosPosture>[0],
    covered: c.covered as boolean,
  });

  const swept = enumerateGrantSafety<Enum, ReturnType<typeof evaluateMacosPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateMacosPosture(s.p, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    // FULLY_HARDENED requires every core control POSITIVELY on, enrollment
    // POSITIVELY confirmed, auto-update on, malware defs present, no stranded
    // extension, no conflict, and a trustworthy (or honestly absent) sysext
    // section. Two axes are deliberately tolerant, per the documented contract:
    // an ABSENT sysext section (residual/conflict null with unreliable=false)
    // is "not a factor" — absence of the OPTIONAL section, unlike an untrusted
    // one, does not raise the bar.
    positivelyClean: (c) =>
      c.covered === true &&
      c.sip === "on" && c.fileVault === "on" && c.gatekeeper === "on" && c.firewall === "on" &&
      c.mdmEnrolled === true && c.autoUpdate === "on" && c.malwareDefs === "present" &&
      c.sysextResidual !== 2 && c.sysextConflict !== true && c.sysextUnreliable === false,
    confirmedWhenNone: (v) => v.reasonCode === "FULLY_HARDENED" && v.posture === "hardened",
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 2 * 3 * 3 * 3 * 3 * 3 * 3 * 2 * 3 * 3 * 2);
  check("ENUMERATION: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: the granting set is residual{0,null} × conflict{false,null} = 4 states (non-vacuous)",
    swept.noneCount === 4);

  // NEGATIVE CONTROL — the enumeration can fail: declare unknown MDM enrollment
  // clean and the harness must object, because the evaluator (correctly) counts
  // an undetermined enrollment among the unknowns that raise the bar.
  const wrongPredicate = enumerateGrantSafety<Enum, ReturnType<typeof evaluateMacosPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateMacosPosture(s.p, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.covered === true &&
      c.sip === "on" && c.fileVault === "on" && c.gatekeeper === "on" && c.firewall === "on" &&
      c.mdmEnrolled !== false && c.autoUpdate === "on" && c.malwareDefs === "present" &&
      c.sysextResidual !== 2 && c.sysextConflict !== true && c.sysextUnreliable === false,
  });
  check("NEGATIVE CONTROL: declaring undetermined MDM enrollment clean is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");
}

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

// ── cross-repo posture-report CONTRACT (consumer side) ────────────────────────
// The single-source contract with signalgrid-mcp: the connector proves it
// consumes the canonical report `example` to the documented verdict, and that the
// example actually contains every section/control the contract requires the MCP
// server to emit. The MCP side (tests/test_posture_contract.py) proves its live
// signalgrid_posture_report() still emits that shape; `pnpm run verify:all` runs
// both against this one file so neither side can drift silently.
interface PostureContract {
  requiredSections: string[];
  requiredSecurityControls: string[];
  requiredFields: Record<string, string[]>;
  example: MacosPostureReportRaw;
  expected: { posture: string; reasonCode: string; recommendedAction: string };
}
const contractPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json");
const contract = JSON.parse(await readFile(contractPath, "utf8")) as PostureContract;
// Walk a dot-path (e.g. "security.sip") to the parent dict, or undefined if any
// hop is missing / not an object.
const atPath = (root: Record<string, unknown>, path: string): Record<string, unknown> | undefined => {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>) : undefined;
};
const contractVerdict = evaluateMacosPosture(normalizeReport("mac-contract", contract.example));
check("contract: connector consumes the canonical MCP report to the documented verdict", contractVerdict.posture === contract.expected.posture && contractVerdict.reasonCode === contract.expected.reasonCode && contractVerdict.recommendedAction === contract.expected.recommendedAction);
// Give the `os` section consumer-side teeth: the verdict ladder ignores osVersion,
// so without this a connector regression that stopped reading `os` would slip past
// the verdict check. Assert the connector actually extracted it from os.product_version.
const exampleBody = contract.example as Record<string, unknown>;
const exampleOs = (exampleBody.os ?? {}) as Record<string, unknown>;
check("contract: connector extracts osVersion from the os section", contractVerdict.osVersion === (exampleOs.product_version ?? null));
// Fixture self-consistency: the example itself declares every section/control the
// contract requires the MCP server to emit (the producer test enforces the server
// actually emits them; this keeps the example honest with the contract).
check("contract: example is self-consistent — declares every requiredSection", contract.requiredSections.every((s) => s in exampleBody));
const exampleSecurity = (exampleBody.security ?? {}) as Record<string, unknown>;
check("contract: example is self-consistent — declares every requiredSecurityControl", contract.requiredSecurityControls.every((c) => c in exampleSecurity));
// The example must carry every NESTED leaf key the connector reads — so the
// requiredFields spec (which the producer test enforces on the live MCP report)
// stays honest with a report the connector actually consumes to `hardened`.
const fieldsOk = Object.entries(contract.requiredFields).every(([path, leaves]) => {
  const parent = atPath(exampleBody, path);
  return parent !== undefined && leaves.every((k) => k in parent);
});
check("contract: example is self-consistent — carries every requiredFields nested leaf", fieldsOk);

// ── `defaults read` failure text is not a reading ────────────────────────────
// This exact string was MEASURED on the owner's Mac through the live
// signalgrid-mcp server — it is what `defaults read` emits for a key that is not
// set, and the MCP server passes it through as the field's value.
//
// It is non-empty and contains no "%", so it survived every earlier sentinel check
// and `malwareDefs()` graded it "present": a message stating the XProtect version
// key DOES NOT EXIST was read as "definitions are present", and xprotect never
// reached controlsUnknown. Absence graded as good news, in the live path, on real
// hardware.
const defaultsMissing =
  "2026-07-31 19:25:53.687 defaults[79610:19689790] \n" +
  "The domain/default pair of (/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info, Version) does not exist";
const missingKey = normalizeReport("m", {
  os: { product_version: "26.5.2" },
  xprotect: { xprotect_definitions: defaultsMissing },
} as MacosPostureReportRaw);
check("`defaults read` failure text normalizes to unknown, never 'present'", missingKey.malwareDefs === "unknown");
check("…and it does not over-match: a real OS version alongside it still reads", missingKey.osVersion === "26.5.2");
// The guard must not become a wall — a genuine definitions string still counts.
const realDefs = normalizeReport("r", {
  xprotect: { xprotect_definitions: "2170" },
} as MacosPostureReportRaw);
check("a genuine XProtect definitions value is still 'present'", realDefs.malwareDefs === "present");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "macos-posture",
  resolve: (env) => resolveMacosPostureConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    MACOS_POSTURE_ACCESS_TOKEN: "t",
  },
});


// The DEFAULT transport, which injecting one everywhere meant nothing ever executed.
// Its two guards survived every sweep: without `!res.ok` a vendor's 500 body is parsed
// as a report, and without the body-shape check an array or a bare `null` becomes one.
await checkDefaultTransport({
  check,
  family: "macos-posture",
  transport: makeDefaultMacosTransport("https://vendor.invalid/macos-posture") as (a: never) => Promise<unknown>,
  arg: { deviceId: "d-1", token: "t" },
  codeOf: (err) => (err instanceof MacosPostureConnectorError ? err.code : undefined),
});


// SYSTEM-EXTENSION TRUSTWORTHINESS — two branches survived mutation until
// 2026-08-25, and the first is a fail-open in the direction this fabric cares
// about most.
//
// (1) `available !== true || reliable !== true`. A macOS system-extension section
// that reports ITSELF unavailable or unreliable must raise the bar, not be read as
// a trustworthy count. With the guard gone, a source saying "do not trust these
// numbers" has its numbers believed, and a device with unreadable extension state
// grades as a device with clean extension state.
const sysext = (block: unknown) =>
  normalizeReport("d", { system_extensions: block } as never);
for (const [label, blk] of [
  ["available:false", { available: false, reliable: true, residual_count: 0, extensions: [] }],
  ["reliable:false", { available: true, reliable: false, residual_count: 0, extensions: [] }],
  ["both false", { available: false, reliable: false, residual_count: 0, extensions: [] }],
  ["available missing", { reliable: true, residual_count: 0, extensions: [] }],
] as const) {
  const v = sysext(blk);
  check(`macos: a system-extension section reporting ${label} is unreliable, and yields no counts`,
    v.sysextUnreliable === true && v.sysextResidual === null && v.sysextConflict === null);
}
// NON-VACUITY: an affirmatively available AND reliable section must still produce
// real counts, or the four checks above would pass for a normalizer that distrusts
// everything.
const trusted = sysext({ available: true, reliable: true, residual_count: 0, extensions: [] });
check("macos: ...while an available and reliable section does produce counts",
  trusted.sysextUnreliable === false && trusted.sysextResidual === 0 && trusted.sysextConflict === false);

// (2) `typeof x.category === "string"`. Without it, a non-string category reaches
// `.toLowerCase()` and the whole read throws — a malformed extension entry taking
// down the entire posture report rather than being skipped as unrecognisable.
const oddCategories = sysext({
  available: true, reliable: true, residual_count: 0,
  extensions: [
    { category: 42, status: "active", enabled: true },
    { category: null, status: "active", enabled: true },
    { category: { nested: "endpoint_security" }, status: "active", enabled: true },
    { status: "active", enabled: true },
  ],
});
check("macos: a non-string extension category is skipped, not thrown on",
  oddCategories.sysextUnreliable === false && oddCategories.sysextConflict === false);
// NON-VACUITY: two genuine endpoint-security extensions must still register as a conflict.
const twoReal = sysext({
  available: true, reliable: true, residual_count: 0,
  extensions: [
    { category: "endpoint_security", status: "active", enabled: true },
    { category: "ENDPOINT_SECURITY_extra", status: "Active", enabled: true },
  ],
});
check("macos: ...while two active endpoint-security extensions are still a conflict",
  twoReal.sysextConflict === true);


const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
