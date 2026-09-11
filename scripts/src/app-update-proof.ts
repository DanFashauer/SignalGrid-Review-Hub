// App-update currency decision proof — fully OFFLINE and deterministic.
//
// This dimension is the HONEST half of the "custom OTA updates" idea: on iOS an app
// cannot install or replace itself, so distribution stays with the platform
// (itms-services / MDM InstallApplication / ABM) — but the min_version floor and
// force_update flag those update manifests carry are POSTURE, and the fabric grades
// them: below-floor restricts like an OS below floor does, a forced update pending is
// a block not a nudge, an unmanaged install is untrusted provenance, and an unknown
// version raises rather than grants. The grant requires POSITIVE CONFIRMATION:
// current + managed channel + clean parse (the force flag is deliberately moot when
// current — a forced update to a version already running is satisfied by
// construction; the enumeration pins exactly that set of granting states).
import {
  resolveAppUpdateConnector,
  makeDefaultAppUpdateTransport,
  AppUpdateConnector,
  AppUpdateConnectorError,
  createMockAppUpdateTransport,
  evaluateAppUpdate,
  guardReadOnly,
  normalizeReport,
  parseVersion,
  compareVersions,
  DEVICE_PREP_FIXTURES,
  evaluateDevicePrep,
  evaluateDevicePrepFixture,
  normalizeDevicePrep,
  PREP_ENROLLMENT_DOMAIN,
  PREP_PROFILES_DOMAIN,
  PREP_REQUIRED_APPS_DOMAIN,
  OS_UPDATE_DOMAIN,
  PREP_STAGE_DOMAIN,
  PREP_INTEGRITY_DOMAIN,
  DEVICE_PREP_REPORT_KEYS,
  type DevicePrepReportRaw,
  type AppUpdateReportRaw,
  type DevicePrepVerdict,
  type NormalizedAppUpdate,
  type NormalizedDevicePrep,
  type OsUpdateState,
  type PrepEnrollment,
  type PrepProfiles,
  type PrepReportIntegrity,
  type PrepRequiredApps,
  type PrepStage,
} from "@workspace/integrations/app-update";
import * as appUpdateModule from "@workspace/integrations/app-update";
import { SIGNAL_KINDS, composeDeviceRisk, fromAppUpdate } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("App-update currency decision proof");

const ev = (r: AppUpdateReportRaw, id = "dev-1") => evaluateAppUpdate(normalizeReport(id, "host-app", r));

// ── version comparison is numeric and strict ────────────────────────────────────
check("versions compare numerically, not lexically (2.10.0 > 2.9.0)",
  compareVersions(parseVersion("2.10.0")!, parseVersion("2.9.0")!) > 0);
check("short versions pad with zeros (2.4 == 2.4.0)",
  compareVersions(parseVersion("2.4")!, parseVersion("2.4.0")!) === 0);
check("a leading v is tolerated (v2.4.0)", parseVersion("v2.4.0") !== null);
check("a non-numeric segment does not parse (2.4.0-beta → null)", parseVersion("2.4.0-beta") === null);
check("a segment beyond Number.MAX_SAFE_INTEGER does not parse (precision loss must not derive 'current')",
  parseVersion("2.9007199254740993") === null);
const hugeSegment = ev({ installed_version: "2.9007199254740992", latest_version: "2.9007199254740993", channel: "managed" });
check("unsafely-huge version segments → malformed, never a grant from a comparison that lost information",
  hugeSegment.recommendedAction !== "none" && normalizeReport("h", "a", { installed_version: "2.9007199254740992", latest_version: "2.9007199254740993", channel: "managed" }).reportIntegrity === "malformed");
check("a non-string does not parse", parseVersion(7) === null && parseVersion(null) === null);

// ── the grant, and its one reasoned exception ───────────────────────────────────
const current = ev({ installed_version: "2.4.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: false, channel: "managed" });
check("current + managed + clean → currency confirmed (the grant)",
  current.recommendedAction === "none" && current.reasonCode === "CURRENT_MANAGED" && current.currencyConfirmed === true);
check("...with no critical findings and no unknowns", current.criticalFindings.length === 0 && current.unknownSignals.length === 0);
const currentForced = ev({ installed_version: "2.4.0", latest_version: "2.4.0", force_update: true, channel: "managed" });
check("current under a FORCED policy still grants (a forced update already applied is satisfied)",
  currentForced.recommendedAction === "none");
const ahead = ev({ installed_version: "2.5.0", latest_version: "2.4.0", channel: "managed" });
check("ahead of latest counts as current (never punished for being newer)", ahead.recommendedAction === "none");

// ── currency ladder ─────────────────────────────────────────────────────────────
const belowFloor = ev({ installed_version: "1.9.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: false, channel: "managed" });
check("below the enforced floor → restrict (the affirmative bad fact)",
  belowFloor.recommendedAction === "restrict" && belowFloor.reasonCode === "BELOW_MIN_VERSION" && belowFloor.criticalFindings.includes("below_min_version"));
// A missing latest must not MASK a floor violation (review finding): the known-bad
// fact needs only installed+min; an unrelated unknown never downgrades it.
const floorNoLatest = ev({ installed_version: "1.0.0", min_version: "2.0.0", channel: "managed" });
check("below the floor with latest_version MISSING → still restrict (a known-bad fact is never masked by an unrelated unknown)",
  floorNoLatest.recommendedAction === "restrict" && floorNoLatest.reasonCode === "BELOW_MIN_VERSION");
const forcedPending = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: true, channel: "managed" });
check("behind latest with force_update → restrict (the flag's one meaning is 'older versions must not be used')",
  forcedPending.recommendedAction === "restrict" && forcedPending.reasonCode === "FORCED_UPDATE_PENDING" && forcedPending.criticalFindings.includes("forced_update_pending"));
const advisory = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: false, channel: "managed" });
check("behind latest, floor satisfied, NOT forced → monitor (a nudge, not fatigue)",
  advisory.recommendedAction === "monitor" && advisory.reasonCode === "UPDATE_AVAILABLE");
const forceUnknown = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", channel: "managed" });
check("behind latest with the force flag UNREADABLE → step_up (cannot confirm the lag is permitted)",
  forceUnknown.recommendedAction === "step_up" && forceUnknown.reasonCode === "FORCE_POLICY_UNKNOWN" && forceUnknown.unknownSignals.includes("force_policy"));

// ── unknowns raise, never grant ─────────────────────────────────────────────────
const noInstalled = ev({ latest_version: "2.4.0", channel: "managed" });
check("no installed version reported → step_up (VERSION_UNKNOWN), never current",
  noInstalled.recommendedAction === "step_up" && noInstalled.reasonCode === "VERSION_UNKNOWN" && noInstalled.unknownSignals.includes("currency"));
// With currency AND channel both unknown, the currency reason still leads (pins
// the currency branch as load-bearing — the backstop alone would surface the
// channel's reason instead).
const bothUnknown = ev({ latest_version: "2.4.0" });
check("currency unknown + channel unknown → the VERSION_UNKNOWN reason leads",
  bothUnknown.recommendedAction === "step_up" && bothUnknown.reasonCode === "VERSION_UNKNOWN");
const noLatest = ev({ installed_version: "2.4.0", channel: "managed" });
check("no manifest latest → step_up ('current' is only meaningful against a release)",
  noLatest.recommendedAction === "step_up" && noLatest.currencyConfirmed === false);
const uncovered = evaluateAppUpdate(
  normalizeReport("d", "host-app", { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" }),
  { covered: false });
check("no inventory row returned (covered=false) → step_up, never a confirmation",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── provenance ──────────────────────────────────────────────────────────────────
const sideload = ev({ installed_version: "2.4.0", latest_version: "2.4.0", channel: "unmanaged" });
check("an UNMANAGED install → restrict even when fully current (untrusted provenance)",
  sideload.recommendedAction === "restrict" && sideload.reasonCode === "UNMANAGED_INSTALL" && sideload.criticalFindings.includes("unmanaged_install"));
const noChannel = ev({ installed_version: "2.4.0", latest_version: "2.4.0" });
check("channel unknown → step_up with posture UNVERIFIED, never the affirmative-sounding 'unmanaged_install'",
  noChannel.recommendedAction === "step_up" && noChannel.reasonCode === "CHANNEL_UNKNOWN" && noChannel.posture === "unverified" && noChannel.unknownSignals.includes("channel"));

// ── malformed / hostile report shapes ───────────────────────────────────────────
const contradictory = normalizeReport("c", "a", { installed_version: "2.4.0", latest_version: "2.0.0", min_version: "2.2.0", channel: "managed" });
check("a manifest whose floor exceeds its own latest is MALFORMED (self-contradiction), currency unknown",
  contradictory.reportIntegrity === "malformed" && contradictory.currency === "unknown" && evaluateAppUpdate(contradictory).recommendedAction !== "none");
// Per-field integrity: each asserted-but-unparseable field must mark the report
// MALFORMED on its own (one junk field per report, everything else valid — a report
// with several junk fields would let one integrity term hide behind another, which
// is exactly the unfalsifiability the mutation guard exists to catch).
check("junk installed_version alone → malformed, cannot grant",
  normalizeReport("j1", "a", { installed_version: "latest!", latest_version: "2.4.0", channel: "managed" }).reportIntegrity === "malformed" &&
  ev({ installed_version: "latest!", latest_version: "2.4.0", channel: "managed" }).recommendedAction !== "none");
check("junk latest_version alone → malformed",
  normalizeReport("j2", "a", { installed_version: "2.4.0", latest_version: "soon™", channel: "managed" }).reportIntegrity === "malformed");
check("junk min_version alone → malformed",
  normalizeReport("j3", "a", { installed_version: "2.4.0", latest_version: "2.4.0", min_version: "junk", channel: "managed" }).reportIntegrity === "malformed");
check("junk channel alone → malformed",
  normalizeReport("j4", "a", { installed_version: "2.4.0", latest_version: "2.4.0", channel: "sideload?" }).reportIntegrity === "malformed");
const junkForce = normalizeReport("f", "a", { installed_version: "2.4.0", latest_version: "2.4.0", force_update: "yes", channel: "managed" });
check("a non-boolean force_update is an assertion we could not read → malformed", junkForce.reportIntegrity === "malformed");
const extraKey = normalizeReport("x", "a", { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed", update_url: "https://x" } as AppUpdateReportRaw);
// The refusal must come from the INTEGRITY branch itself (REPORT_MALFORMED), not
// merely from the grant backstop — a malformed report whose fields all parse valid
// is exactly the state only the integrity branch can name.
check("an unrecognized key (e.g. an update_url we would never fetch) refuses AS malformed (not via the backstop)",
  extraKey.reportIntegrity === "malformed" && evaluateAppUpdate(extraKey).reasonCode === "REPORT_MALFORMED" && evaluateAppUpdate(extraKey).recommendedAction !== "none");
const inherited = evaluateAppUpdate(normalizeReport("i", "a", Object.create({ installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" }) as AppUpdateReportRaw));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy({ installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as AppUpdateReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluateAppUpdate(normalizeReport("px", "a", hidden)).recommendedAction !== "none");
const throwingKeys = new Proxy({ installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" }, { ownKeys: () => { throw new Error("hostile"); } }) as AppUpdateReportRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluateAppUpdate(normalizeReport("tk", "a", throwingKeys)).recommendedAction !== "none");
const throwingAccessor = { latest_version: "2.4.0", channel: "managed" } as AppUpdateReportRaw;
Object.defineProperty(throwingAccessor, "installed_version", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    normalizeReport("ta", "a", throwingAccessor).reportIntegrity === "malformed" && evaluateAppUpdate(normalizeReport("ta2", "a", throwingAccessor)).recommendedAction !== "none");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeReport("s", "a", "boom" as unknown as AppUpdateReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeReport("n", "a", null as unknown as AppUpdateReportRaw).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", "a", Object.prototype as AppUpdateReportRaw).reportIntegrity === "malformed");
check("channel case and whitespace are canonicalized, not rejected",
  normalizeReport("cw", "a", { channel: " MANAGED " } as AppUpdateReportRaw).channel === "managed");

// ── the stability axis (intake ledger row 19) ───────────────────────────────────
// The analytics plane reports the figures; the caller poses the bound.
const stable = (over: AppUpdateReportRaw = {}): AppUpdateReportRaw => ({
  installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed", force_update: false,
  crash_count: 0, stability_window_hours: 24, ...over,
});
const evStab = (r: AppUpdateReportRaw, maxCrashesInWindow?: number) =>
  evaluateAppUpdate(normalizeReport("d", "a", r), maxCrashesInWindow === undefined ? {} : { maxCrashesInWindow });
check("STABILITY HEADLINE: more crashes than the caller's bound → step_up APP_UNSTABLE — a crashing host app is operational risk, and the fix is a challenge and a device swap, never a block",
  evStab(stable({ crash_count: 4 }), 1).recommendedAction === "step_up" &&
  evStab(stable({ crash_count: 4 }), 1).reasonCode === "APP_UNSTABLE" &&
  evStab(stable({ crash_count: 4 }), 1).criticalFindings.includes("app_unstable"));
check("the bound is INCLUSIVE: exactly at the bound is stable, and a stable current managed app still grants",
  evStab(stable({ crash_count: 1 }), 1).stability === "stable" &&
  evStab(stable({ crash_count: 1 }), 1).recommendedAction === "none");
check("UNPOSED is unassessed — carried visibly, never foreclosing the grant even with crashy figures on the wire",
  evStab(stable({ crash_count: 9 })).stability === "unassessed" &&
  evStab(stable({ crash_count: 9 })).recommendedAction === "none");
check("POSED but unanswerable raises: figures absent → STABILITY_UNKNOWN; a nonsense bound (negative) → unknown too",
  evStab(stable({ crash_count: undefined, stability_window_hours: undefined }), 1).reasonCode === "STABILITY_UNKNOWN" &&
  evStab(stable(), -1).stability === "unknown");
check("a count WITHOUT its window is uninterpretable (unknown when posed); a garbled count, a garbled window, and a ZERO-hour window are all malformed",
  evStab(stable({ stability_window_hours: undefined }), 1).reasonCode === "STABILITY_UNKNOWN" &&
  normalizeReport("d", "a", stable({ crash_count: "many" })).reportIntegrity === "malformed" &&
  normalizeReport("d", "a", stable({ stability_window_hours: -2 })).reportIntegrity === "malformed" &&
  normalizeReport("d", "a", stable({ stability_window_hours: 0 })).reportIntegrity === "malformed");
// Regression, 2026-09-06: an UNREADABLE crash count (NaN) with a posed bound is
// UNKNOWN, not "unstable" — until then only null took the unknown arm and NaN
// reached `<= bound`, landing on the right verdict for the wrong reason (the
// check-nan-fail-open rule 5 shape). Mutation record: with the Number.isFinite
// arm reverted to `=== null`, this assertion fails by name.
const nanCrashes = evaluateAppUpdate({ ...normalizeReport("d", "a", stable()), crashCount: Number.NaN }, { maxCrashesInWindow: 1 });
check("an UNREADABLE crash count (NaN) under a posed bound is STABILITY_UNKNOWN, never stable and never merely unstable",
  nanCrashes.stability === "unknown" && nanCrashes.reasonCode === "STABILITY_UNKNOWN" && nanCrashes.recommendedAction !== "none");

// ── exhaustive (normalized): the grant is current + managed + clean + stable ────
const normDomains = {
  currency: ["current", "behind", "below_floor", "unknown"],
  forcePolicy: ["forced", "not_forced", "unknown"],
  channel: ["managed", "unmanaged", "unknown"],
  reportIntegrity: ["clean", "malformed"],
  figures: ["ok", "crashy", "absent"],
};
const FIGURES: Record<string, { c: number | null; w: number | null }> = {
  ok: { c: 0, w: 24 }, crashy: { c: 5, w: 24 }, absent: { c: null, w: null },
};
const buildNorm = (c: Record<string, unknown>): NormalizedAppUpdate => ({
  sourceSystem: "app-update", deviceRef: "enum", appRef: "enum", source: "enum",
  currency: c.currency as NormalizedAppUpdate["currency"],
  forcePolicy: c.forcePolicy as NormalizedAppUpdate["forcePolicy"],
  channel: c.channel as NormalizedAppUpdate["channel"],
  reportIntegrity: c.reportIntegrity as NormalizedAppUpdate["reportIntegrity"],
  crashCount: FIGURES[c.figures as string].c,
  stabilityWindowHours: FIGURES[c.figures as string].w,
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateAppUpdate(r, { maxCrashesInWindow: 1 }),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.currencyConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.currency === "current" && c.channel === "managed" && c.reportIntegrity === "clean" && c.figures === "ok",
});
check(
  `exhaustive (normalized, stability bound POSED): over all ${normRes.combos} states, currency is confirmed ONLY when current + managed + clean + stable (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 216,
);
check("exhaustive (normalized): exactly the THREE current+managed+clean+stable states grant (one per force-flag value — the pinned doctrine); crashy and absent figures never grant under a posed bound",
  normRes.noneCount === 3);

// ── exhaustive (raw wire): the normalizer + evaluator on hostile input ───────────
const rawDomains = {
  installed_version: ["2.4.0", "2.1.0", "1.0.0", undefined, "garbage", 7],
  latest_version: ["2.4.0", undefined],
  min_version: ["2.0.0", undefined, "junk"],
  force_update: [true, false, undefined, "yes"],
  channel: ["managed", "unmanaged", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedAppUpdate => {
  const { __alias, ...wire } = c;
  const raw: AppUpdateReportRaw = {};
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.update_url = "https://x";
  return normalizeReport("enum", "enum", raw, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluateAppUpdate,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.currencyConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.installed_version === "2.4.0" &&
    c.latest_version === "2.4.0" &&
    (c.min_version === "2.0.0" || c.min_version === undefined) &&
    (c.force_update === true || c.force_update === false || c.force_update === undefined) &&
    c.channel === "managed",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — junk versions, numbers, a non-boolean flag, an aliased update_url key — currency is confirmed only on fully-clean current+managed reports (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 864,
);
check("exhaustive (raw wire): exactly SIX raw reports grant (2 floor states × 3 force-flag values, all current+managed)",
  rawRes.noneCount === 6);

// ── connector surface (mutation-guard coverage: every guard falsifiable) ────────
let auReadOnly = false;
try { guardReadOnly("POST"); } catch (err) { auReadOnly = err instanceof AppUpdateConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", auReadOnly);
const auConn = new AppUpdateConnector(
  { accessToken: "t", baseUrl: "https://manifest.example" },
  createMockAppUpdateTransport({ reports: { "dev-9/host-app": { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" } } }),
);
check("the connector round-trip normalizes a clean report end to end (grantable)",
  evaluateAppUpdate(await auConn.fetchNormalized("dev-9", "host-app")).recommendedAction === "none");
check("an unknown device/app pair yields an all-unknown report that cannot grant",
  evaluateAppUpdate(await auConn.fetchNormalized("dev-9", "other-app")).recommendedAction !== "none");
// The prototype walk must be BOUNDED, not trusted: >64 empty prototypes under an
// otherwise-clean report must read malformed — without the bound the walk ends
// quietly at Object.prototype and the report reads clean.
let auDeepProto: object = {};
for (let i = 0; i < 100; i += 1) auDeepProto = Object.create(auDeepProto);
const auDeepReport = Object.assign(Object.create(auDeepProto), { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" });
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", "a", auDeepReport as AppUpdateReportRaw).reportIntegrity === "malformed");
// An inherited key with a RECOGNIZED name is still an assertion this report did not
// make itself — the prototype-chain scan, not the own-value read, is what notices it.
const auProtoAlias = Object.assign(Object.create({ installed_version: "9.9.9" }), { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed" });
check("a recognized key inherited from the prototype marks the report malformed",
  normalizeReport("pa", "a", auProtoAlias as AppUpdateReportRaw).reportIntegrity === "malformed");

// ── fusion into the fabric (posture-composition + incident routing) ─────────────
check("app_update is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("app_update"));
const fusedBelowFloor = fromAppUpdate(ev({ installed_version: "1.9.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: false, channel: "managed" }));
check("fromAppUpdate maps a below-floor verdict onto the unified ladder as restrict",
  fusedBelowFloor.kind === "app_update" && fusedBelowFloor.action === "restrict" && fusedBelowFloor.reason === "BELOW_MIN_VERSION");
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fusedBelowFloor,
]);
check("composition is worst-concern-wins: one below-floor app drags an otherwise-healthy device to restrict, with app_update as the top driver",
  fused.strongestAction === "restrict" && fused.drivers[0]?.kind === "app_update");
const fusedCurrent = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromAppUpdate(ev({ installed_version: "2.4.0", latest_version: "2.4.0", force_update: false, channel: "managed" })),
]);
check("...and a confirmed-current app contributes none — the dimension never lowers, only raises",
  fusedCurrent.strongestAction === "none");

// Determinism.
const d1 = normalizeReport("det", "a", { installed_version: "2.1.0", latest_version: "2.4.0", force_update: true, channel: "managed" });
check("evaluator is deterministic", JSON.stringify(evaluateAppUpdate(d1)) === JSON.stringify(evaluateAppUpdate(d1)));


// ── the iOS update / device-prep WORKFLOW (device-prep.ts) ───────────────────────
//
// A DISTINCT surface from host-app currency above: not which VERSION of the app is
// installed, but whether the device finished being PROVISIONED (enrolled, profiles,
// required apps, prep declared complete) and where its OS UPDATE stands (required,
// in progress, failed). It is the runbooks' "iOS update / device-prep workflows" row
// this family had only partially modeled — the seated, lit, never-provisioned
// "phantom device". Fail-closed: every unknown tightens; the one grant is pinned by
// equality over the whole workflow state space.

// named outcomes — every workflow state reaches its verdict, each by name
const P = (n: string): DevicePrepVerdict => evaluateDevicePrepFixture(n)!;
const prepCases: Array<[string, string, string]> = [
  ["ready", "none", "DEVICE_PREP_READY"],
  ["prep-failed", "restrict", "DEVICE_PREP_FAILED"],
  ["prep-in-progress", "step_up", "DEVICE_PREP_IN_PROGRESS"],
  ["prep-stage-unknown", "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["not-enrolled", "restrict", "DEVICE_NOT_ENROLLED"],
  ["enrollment-pending", "step_up", "DEVICE_ENROLLMENT_PENDING"],
  ["enrollment-unknown", "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["profiles-missing", "restrict", "DEVICE_PROFILES_MISSING"],
  ["profiles-partial", "step_up", "DEVICE_PROFILES_PARTIAL"],
  ["profiles-unknown", "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["apps-missing", "restrict", "DEVICE_REQUIRED_APPS_MISSING"],
  ["apps-partial", "step_up", "DEVICE_REQUIRED_APPS_PARTIAL"],
  ["apps-unknown", "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["update-required", "restrict", "OS_UPDATE_REQUIRED"],
  ["update-failed", "restrict", "OS_UPDATE_FAILED"],
  ["update-in-progress", "step_up", "OS_UPDATE_IN_PROGRESS"],
  ["update-available", "monitor", "OS_UPDATE_AVAILABLE"],
  ["os-update-unknown", "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["report-malformed", "step_up", "DEVICE_PREP_REPORT_MALFORMED"],
  ["worst-of-several", "restrict", "DEVICE_PREP_FAILED"],
];
for (const [name, action, reason] of prepCases) {
  const v = P(name);
  check(
    `device-prep fixture \`${name}\` → ${action} / ${reason} (${v.recommendedAction} / ${v.reasonCode})`,
    v.recommendedAction === action && v.reasonCode === reason,
  );
}
check("device-prep: every fixture is asserted above (fixture count = cases named)",
  Object.keys(DEVICE_PREP_FIXTURES).length === prepCases.length);
const prepReached = new Set(prepCases.map(([n]) => P(n).recommendedAction));
check(`device-prep NON-VACUITY: none, monitor, step_up and restrict are all reachable (${[...prepReached].sort().join(", ")})`,
  prepReached.has("none") && prepReached.has("monitor") && prepReached.has("step_up") && prepReached.has("restrict"));
check("device-prep: an unknown fixture name yields undefined — never a fabricated verdict",
  evaluateDevicePrepFixture("no-such-fixture") === undefined);
const prepWorst = P("worst-of-several");
check("device-prep worst-of-several records all three critical findings and names the failed prep first (precedence)",
  prepWorst.criticalFindings.length === 3 && prepWorst.reasonCode === "DEVICE_PREP_FAILED");
check("device-prep: readyForCheckout is exactly 'not held, not contained' — true for the grant and the one advisory, false for every step_up/restrict fixture",
  prepCases.every(([n, action]) => P(n).readyForCheckout === (action === "none" || action === "monitor")));
check("device-prep: the one advisory state (an optional update offered) is monitor, not a hold — and the device IS ready for check-out (an advisory never withholds a ready device)",
  P("update-available").recommendedAction === "monitor" && P("update-available").readyForCheckout === true);
check("device-prep: a step_up is NOT ready (the advisory-ready rule does not leak upward — prep in progress stays held)",
  P("prep-in-progress").recommendedAction === "step_up" && P("prep-in-progress").readyForCheckout === false);

// fail-closed controls — corrupt the sole grant ONE stage at a time
const prepBase = DEVICE_PREP_FIXTURES["ready"];
const prepBaseline = evaluateDevicePrep(prepBase);
check("device-prep CONTROL baseline: the untouched grant does grant, ready, with no findings",
  prepBaseline.recommendedAction === "none" && prepBaseline.readyForCheckout === true &&
  prepBaseline.criticalFindings.length === 0 && prepBaseline.unknownSignals.length === 0);
const prepFlips: Array<[string, Partial<NormalizedDevicePrep>, string, string]> = [
  ["prep stage → failed", { prepStage: "failed" }, "restrict", "DEVICE_PREP_FAILED"],
  ["prep stage → in progress", { prepStage: "in_progress" }, "step_up", "DEVICE_PREP_IN_PROGRESS"],
  ["prep stage → unknown", { prepStage: "unknown" }, "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["enrollment → not enrolled", { enrollment: "not_enrolled" }, "restrict", "DEVICE_NOT_ENROLLED"],
  ["enrollment → pending", { enrollment: "pending" }, "step_up", "DEVICE_ENROLLMENT_PENDING"],
  ["enrollment → unknown", { enrollment: "unknown" }, "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["profiles → missing", { profiles: "missing" }, "restrict", "DEVICE_PROFILES_MISSING"],
  ["profiles → partial", { profiles: "partial" }, "step_up", "DEVICE_PROFILES_PARTIAL"],
  ["profiles → unknown", { profiles: "unknown" }, "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["required apps → missing", { requiredApps: "missing" }, "restrict", "DEVICE_REQUIRED_APPS_MISSING"],
  ["required apps → partial", { requiredApps: "partial" }, "step_up", "DEVICE_REQUIRED_APPS_PARTIAL"],
  ["required apps → unknown", { requiredApps: "unknown" }, "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["OS update → required", { osUpdate: "update_required" }, "restrict", "OS_UPDATE_REQUIRED"],
  ["OS update → failed", { osUpdate: "update_failed" }, "restrict", "OS_UPDATE_FAILED"],
  ["OS update → in progress", { osUpdate: "update_in_progress" }, "step_up", "OS_UPDATE_IN_PROGRESS"],
  ["OS update → available (optional)", { osUpdate: "update_available" }, "monitor", "OS_UPDATE_AVAILABLE"],
  ["OS update → unknown", { osUpdate: "unknown" }, "step_up", "DEVICE_PREP_STATE_UNKNOWN"],
  ["report → malformed", { reportIntegrity: "malformed" }, "step_up", "DEVICE_PREP_REPORT_MALFORMED"],
];
for (const [label, patch, action, reason] of prepFlips) {
  const v = evaluateDevicePrep({ ...prepBase, ...patch });
  check(
    `device-prep FAIL-CLOSED: ${label} flips the grant to ${action} / ${reason} (${v.recommendedAction} / ${v.reasonCode})`,
    // Every flip leaves the grant; only the one advisory flip (an optional update) stays ready.
    v.recommendedAction === action && v.reasonCode === reason && v.readyForCheckout === (action === "monitor"),
  );
}

// the grant set, pinned by equality over the whole workflow state space
// The sweep walks the MODULE's exported domains, not a hand-typed copy (in-house review
// finding: a member added to a domain with no evaluator branch would be in-domain, fire
// nothing, and grant — and a retyped list here could not see it). The 3,072 below is the
// documented figure and stays literal on purpose: if a domain grows, this line and the
// figures= line move together and the docs↔proof figure guard catches the stale 3,072.
const prepDomains = {
  enrollment: PREP_ENROLLMENT_DOMAIN,
  profiles: PREP_PROFILES_DOMAIN,
  requiredApps: PREP_REQUIRED_APPS_DOMAIN,
  osUpdate: OS_UPDATE_DOMAIN,
  prepStage: PREP_STAGE_DOMAIN,
  reportIntegrity: PREP_INTEGRITY_DOMAIN,
} as const;
const buildPrep = (c: Record<string, unknown>): NormalizedDevicePrep => ({
  sourceSystem: "app-update",
  deviceRef: "enum",
  enrollment: c.enrollment as PrepEnrollment,
  profiles: c.profiles as PrepProfiles,
  requiredApps: c.requiredApps as PrepRequiredApps,
  osUpdate: c.osUpdate as OsUpdateState,
  prepStage: c.prepStage as PrepStage,
  reportIntegrity: c.reportIntegrity as PrepReportIntegrity,
});
const isPrepReady = (c: Record<string, unknown>): boolean =>
  c.enrollment === "enrolled" &&
  c.profiles === "applied" &&
  c.requiredApps === "installed" &&
  c.osUpdate === "current" &&
  c.prepStage === "complete" &&
  c.reportIntegrity === "clean";
const prepRes = enumerateGrantSafety<NormalizedDevicePrep, DevicePrepVerdict>({
  domains: prepDomains,
  build: buildPrep,
  evaluate: evaluateDevicePrep,
  actionOf: (v) => v.recommendedAction,
  positivelyClean: isPrepReady,
  confirmedWhenNone: (v) =>
    v.readyForCheckout === true && v.reasonCode === "DEVICE_PREP_READY" &&
    v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
});
check(`device-prep ENUMERATION: all ${prepRes.combos} workflow states swept (= product of domains)`,
  prepRes.combos === productOf(prepDomains) && prepRes.combos === 4 * 4 * 4 * 6 * 4 * 2);
check("device-prep ENUMERATION: ready is EXACTLY the one positively-confirmed state — zero mismatches",
  prepRes.mismatches === 0);
check("device-prep ENUMERATION: exactly one state grants (non-vacuous)", prepRes.noneCount === 1);
// NEGATIVE CONTROL — declare every prep-complete state clean (ignoring the other stages)
// and the harness must object.
const prepWrong = enumerateGrantSafety<NormalizedDevicePrep, DevicePrepVerdict>({
  domains: prepDomains,
  build: buildPrep,
  evaluate: evaluateDevicePrep,
  actionOf: (v) => v.recommendedAction,
  positivelyClean: (c) => c.prepStage === "complete",
});
check("device-prep NEGATIVE CONTROL: declaring every prep-complete state clean is CAUGHT (mismatches > 0)",
  prepWrong.mismatches > 0 && typeof prepWrong.firstMismatch === "string");
// monitor is reserved for the one advisory fact: an OPTIONAL update offered on an
// otherwise-ready device. Every other non-grant is a hold (step_up) or a containment.
let prepMonitorOffAxis = 0;
let prepOffLadder = 0;
let prepReadyCount = 0;
let prepReadyMismatch = 0;
for (const enrollment of prepDomains.enrollment)
  for (const profiles of prepDomains.profiles)
    for (const requiredApps of prepDomains.requiredApps)
      for (const osUpdate of prepDomains.osUpdate)
        for (const prepStage of prepDomains.prepStage)
          for (const reportIntegrity of prepDomains.reportIntegrity) {
            const v = evaluateDevicePrep(buildPrep({ enrollment, profiles, requiredApps, osUpdate, prepStage, reportIntegrity }));
            const a = v.recommendedAction;
            if (a === "monitor" && osUpdate !== "update_available") prepMonitorOffAxis += 1;
            if (a !== "none" && a !== "monitor" && a !== "step_up" && a !== "restrict") prepOffLadder += 1;
            // readyForCheckout is exactly "not held, not contained": the grant and the advisory.
            if (v.readyForCheckout) prepReadyCount += 1;
            if (v.readyForCheckout !== (a === "none" || a === "monitor")) prepReadyMismatch += 1;
          }
check("device-prep: monitor is reachable ONLY through an optional update offered — never for a prep or enrollment state", prepMonitorOffAxis === 0);
check("device-prep: over all workflow states readyForCheckout ⇔ (none | monitor), with no state disagreeing", prepReadyMismatch === 0);
check(`device-prep: exactly TWO states are ready for check-out — the grant and the one optional-update advisory (${prepReadyCount})`,
  prepReadyCount === prepRes.noneCount + 1 && prepReadyCount === 2);
check("device-prep: no workflow state resolves to alert/escalate — the surface holds, contains, or advises", prepOffLadder === 0);

// the normalizer on hostile wire input — the asymmetry that makes it safe
const prepWireOk = normalizeDevicePrep("w-1", { enrollment: "enrolled", profiles: "applied", required_apps: "installed", os_update: "current", prep_stage: "complete" });
check("device-prep: a fully-confirmed wire report normalizes clean and evaluates to the grant",
  prepWireOk.reportIntegrity === "clean" && evaluateDevicePrep(prepWireOk).readyForCheckout === true);
const prepWireVocab = normalizeDevicePrep("w-2", { enrollment: "sorta", profiles: "mostly", required_apps: "some", os_update: "soon", prep_stage: "done-ish" });
check("device-prep: out-of-vocabulary strings normalize to unknown on every stage (never a fabricated confirmed state), report clean",
  prepWireVocab.enrollment === "unknown" && prepWireVocab.profiles === "unknown" && prepWireVocab.requiredApps === "unknown" &&
  prepWireVocab.osUpdate === "unknown" && prepWireVocab.prepStage === "unknown" && prepWireVocab.reportIntegrity === "clean");
const prepWireMalformed = normalizeDevicePrep("w-3", { enrollment: 1, profiles: ["applied"], required_apps: "installed", os_update: "current", prep_stage: "complete" });
check("device-prep: a present-but-non-string slot marks the report MALFORMED — step_up for that reason",
  prepWireMalformed.reportIntegrity === "malformed" && evaluateDevicePrep(prepWireMalformed).reasonCode === "DEVICE_PREP_REPORT_MALFORMED");
const prepWireSilent = normalizeDevicePrep("w-4", null);
check("device-prep: an absent report (silence) is all-unknown and CLEAN — silence is not malformed — and still steps up",
  prepWireSilent.enrollment === "unknown" && prepWireSilent.prepStage === "unknown" && prepWireSilent.reportIntegrity === "clean" &&
  evaluateDevicePrep(prepWireSilent).recommendedAction === "step_up");
// Own-property reads (review finding): a report that INHERITS the recognized fields —
// Object.create({...}), or a polluted prototype — asserted nothing itself, yet the first
// cut read the inherited values as evidence and normalized an EMPTY report to the grant.
// Every shape below must be malformed, all-unknown, and never ready for check-out.
const prepGrantRaw = { enrollment: "enrolled", profiles: "applied", required_apps: "installed", os_update: "current", prep_stage: "complete" };
const prepInherited = normalizeDevicePrep("w-5", Object.create(prepGrantRaw) as DevicePrepReportRaw);
check("device-prep: a report that only INHERITS the confirmed stages is malformed, all-unknown, and never ready (the prototype's claim is not this report's)",
  prepInherited.reportIntegrity === "malformed" && prepInherited.enrollment === "unknown" && prepInherited.profiles === "unknown" &&
  prepInherited.requiredApps === "unknown" && prepInherited.osUpdate === "unknown" && prepInherited.prepStage === "unknown" &&
  evaluateDevicePrep(prepInherited).readyForCheckout === false);
const prepAlias = normalizeDevicePrep("w-6", Object.assign(Object.create({ os_update: "update_failed" }), prepGrantRaw) as DevicePrepReportRaw);
check("device-prep: a recognized key inherited BEHIND a clean own set still marks the report malformed (the chain scan notices it)",
  prepAlias.reportIntegrity === "malformed" && evaluateDevicePrep(prepAlias).readyForCheckout === false);
check("device-prep: Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeDevicePrep("w-7", Object.prototype as DevicePrepReportRaw).reportIntegrity === "malformed");
check("device-prep: an array or a string where the report should be is malformed, never a thrown TypeError",
  normalizeDevicePrep("w-8", [] as unknown as DevicePrepReportRaw).reportIntegrity === "malformed" &&
  normalizeDevicePrep("w-9", "complete" as unknown as DevicePrepReportRaw).reportIntegrity === "malformed");
const prepExtra = normalizeDevicePrep("w-10", { ...prepGrantRaw, prep_status: "complete" } as DevicePrepReportRaw);
check("device-prep: an unrecognized OWN key is an assertion in a spelling we ignore — malformed, and the clean-looking rest is not ready",
  prepExtra.reportIntegrity === "malformed" && evaluateDevicePrep(prepExtra).readyForCheckout === false);
check("device-prep: a symbol-keyed report is malformed",
  normalizeDevicePrep("w-11", { ...prepGrantRaw, [Symbol("x")]: 1 } as DevicePrepReportRaw).reportIntegrity === "malformed");
let prepDeepProto: object = {};
for (let i = 0; i < 100; i += 1) prepDeepProto = Object.create(prepDeepProto);
check("device-prep: a report behind a 100-deep prototype chain is malformed (the walk is bounded, not trusted)",
  normalizeDevicePrep("w-12", Object.assign(Object.create(prepDeepProto), prepGrantRaw) as DevicePrepReportRaw).reportIntegrity === "malformed");
const prepThrowing = new Proxy(prepGrantRaw, { ownKeys: () => { throw new Error("hostile"); } }) as DevicePrepReportRaw;
check("device-prep: a Proxy whose key enumeration throws is malformed, never an exception out of the normalizer",
  normalizeDevicePrep("w-13", prepThrowing).reportIntegrity === "malformed");
check("device-prep: a plain own-property report still reaches the grant after the own-read change (the fix did not foreclose the honest path)",
  evaluateDevicePrep(normalizeDevicePrep("w-14", { ...prepGrantRaw })).readyForCheckout === true);
// A recognized OWN key whose read throws — an accessor, or a Proxy `get` trap — passes the
// key scan; the read itself must be caught and the report marked malformed (review finding).
const prepGetter = Object.defineProperty({ profiles: "applied", required_apps: "installed", os_update: "current", prep_stage: "complete" },
  "enrollment", { get() { throw new Error("hostile getter"); }, enumerable: true });
const prepGetterOut = normalizeDevicePrep("w-15", prepGetter as DevicePrepReportRaw);
check("device-prep: an own accessor whose getter throws is malformed and all-unknown, never an exception out of the normalizer",
  prepGetterOut.reportIntegrity === "malformed" && prepGetterOut.enrollment === "unknown" && prepGetterOut.prepStage === "unknown");
const prepGetTrap = new Proxy(prepGrantRaw, { get: () => { throw new Error("hostile get"); } }) as DevicePrepReportRaw;
check("device-prep: a Proxy whose `get` trap throws is malformed, never an exception (the key scan alone does not see it)",
  normalizeDevicePrep("w-16", prepGetTrap).reportIntegrity === "malformed");
// The grant is a POSITIVE predicate: a NORMALIZED value outside the declared union — a
// JavaScript caller, a cast — matches no branch and must be HELD, not ready (review
// finding: the exhaustive sweep walks only union members, so it could not see this).
// (report integrity is the one stage an existing branch already catches — anything not
// "clean" is malformed — so its expected reason is that branch's, not the predicate's.)
const prepOodAxes: Array<[string, Partial<NormalizedDevicePrep>, DevicePrepVerdict["reasonCode"], string]> = [
  ["prep stage", { prepStage: "garbage" as PrepStage }, "DEVICE_PREP_STATE_UNKNOWN", "state_out_of_domain"],
  ["enrollment", { enrollment: "garbage" as PrepEnrollment }, "DEVICE_PREP_STATE_UNKNOWN", "state_out_of_domain"],
  ["profiles", { profiles: "garbage" as PrepProfiles }, "DEVICE_PREP_STATE_UNKNOWN", "state_out_of_domain"],
  ["required apps", { requiredApps: "garbage" as PrepRequiredApps }, "DEVICE_PREP_STATE_UNKNOWN", "state_out_of_domain"],
  ["OS update", { osUpdate: "garbage" as OsUpdateState }, "DEVICE_PREP_STATE_UNKNOWN", "state_out_of_domain"],
  ["report integrity", { reportIntegrity: "garbage" as PrepReportIntegrity }, "DEVICE_PREP_REPORT_MALFORMED", "report_integrity"],
];
for (const [label, patch, reason, signal] of prepOodAxes) {
  const v = evaluateDevicePrep({ ...prepBase, ...patch });
  check(`device-prep: an out-of-domain runtime value on ${label} is held (step_up / ${reason}), never ready`,
    v.recommendedAction === "step_up" && v.reasonCode === reason && v.readyForCheckout === false &&
    v.unknownSignals.includes(signal));
}
check("device-prep: the positive predicate does not disturb a real concern's reason (prep in progress keeps its own reason)",
  evaluateDevicePrep({ ...prepBase, prepStage: "in_progress" }).reasonCode === "DEVICE_PREP_IN_PROGRESS");
// Two axes (review finding on the first cut of the guard): an optional-update advisory —
// monitor, and still ready — beside an out-of-domain stage. A guard gated on an empty
// candidate list skipped this and the device read as ready. The hold must fire whatever
// else fired, and outrank the advisory.
const prepAdvisoryPlusGarbage = evaluateDevicePrep({ ...prepBase, osUpdate: "update_available", enrollment: "garbage" as PrepEnrollment });
check("device-prep: an optional-update advisory beside an out-of-domain stage is HELD (step_up, not ready), never the advisory's ready verdict",
  prepAdvisoryPlusGarbage.recommendedAction === "step_up" && prepAdvisoryPlusGarbage.readyForCheckout === false &&
  prepAdvisoryPlusGarbage.reasonCode === "DEVICE_PREP_STATE_UNKNOWN" && prepAdvisoryPlusGarbage.unknownSignals.includes("state_out_of_domain"));
const prepContainedPlusGarbage = evaluateDevicePrep({ ...prepBase, prepStage: "failed", enrollment: "garbage" as PrepEnrollment });
check("device-prep: a containment beside an out-of-domain stage stays a containment with its own reason (the hold never weakens a restrict)",
  prepContainedPlusGarbage.recommendedAction === "restrict" && prepContainedPlusGarbage.reasonCode === "DEVICE_PREP_FAILED" &&
  prepContainedPlusGarbage.readyForCheckout === false && prepContainedPlusGarbage.unknownSignals.includes("state_out_of_domain"));
// The per-stage `unknown` branches must stay LIVE now that the positive predicate also
// holds those states under the same reason: each names ITS stage in unknownSignals, and
// the backstop's "state_out_of_domain" must not appear — otherwise a deleted branch is
// invisible to the proof (the os_update mutant survived the sweep before this check).
const prepUnknownStageSignals: Array<[string, string]> = [
  ["prep-stage-unknown", "prep_stage"],
  ["enrollment-unknown", "enrollment"],
  ["profiles-unknown", "profiles"],
  ["apps-unknown", "required_apps"],
  ["os-update-unknown", "os_update"],
];
for (const [fixture, signal] of prepUnknownStageSignals) {
  const v = P(fixture);
  check(`device-prep: the '${fixture}' hold names its own stage ('${signal}') and is NOT the out-of-domain backstop`,
    v.unknownSignals.includes(signal) && !v.unknownSignals.includes("state_out_of_domain"));
}
// The domain lists are the guard's allowlist. `readonly` is compile-time only: a JavaScript
// caller that pushed "garbage" onto an exported list would make it in-domain and reopen the
// grant (review finding). They are frozen at runtime, and a mutation attempt must leave the
// hold in place.
const prepDomainLists = [PREP_ENROLLMENT_DOMAIN, PREP_PROFILES_DOMAIN, PREP_REQUIRED_APPS_DOMAIN, OS_UPDATE_DOMAIN, PREP_STAGE_DOMAIN, PREP_INTEGRITY_DOMAIN];
check("device-prep: every exported domain list is frozen at runtime", prepDomainLists.every((d) => Object.isFrozen(d)));
let prepPushThrew = false;
try { (PREP_ENROLLMENT_DOMAIN as unknown as string[]).push("garbage"); } catch { prepPushThrew = true; }
check("device-prep: pushing onto a domain list throws (strict mode) and does not widen it — the out-of-domain hold survives the attempt",
  prepPushThrew && PREP_ENROLLMENT_DOMAIN.length === 4 &&
  evaluateDevicePrep({ ...prepBase, enrollment: "garbage" as PrepEnrollment }).readyForCheckout === false);
// Every exported array in the module namespace is frozen — not a hand-enumerated list of
// them (in-house review finding: round five froze the six domain lists by hand and left
// DEVICE_PREP_REPORT_KEYS, the unrecognized-key allowlist, open; one push made an extra key
// read clean). A future exported array that is genuinely mutable would need a named exemption.
const prepUnfrozenExports = Object.entries(appUpdateModule).filter(([, v]) => Array.isArray(v) && !Object.isFrozen(v)).map(([k]) => k);
check(`device-prep: every exported array in the app-update namespace is frozen (unfrozen: ${prepUnfrozenExports.join(", ") || "none"})`,
  prepUnfrozenExports.length === 0);
let prepKeysPushThrew = false;
try { (DEVICE_PREP_REPORT_KEYS as unknown as string[]).push("vendor_note"); } catch { prepKeysPushThrew = true; }
const prepExtraAfter = normalizeDevicePrep("w-17", { ...prepGrantRaw, vendor_note: "anything" } as DevicePrepReportRaw);
check("device-prep: pushing onto the REPORT_KEYS allowlist throws and an unrecognized key still reads malformed",
  prepKeysPushThrew && DEVICE_PREP_REPORT_KEYS.length === 5 && prepExtraAfter.reportIntegrity === "malformed");
// The own-property read is the ONLY thing between a polluted Object.prototype and a full
// grant: the chain scan stops at Object.prototype by design, so a recognized key planted
// there is invisible to it, and an EMPTY or ABSENT report would read as fully confirmed.
// (In-house review finding: every earlier hostile case used Object.create, which the scan
// catches first, so deleting hasOwnProperty left 157/157 green.) Pollute, normalize {}
// and undefined, assert all-unknown and not ready, restore in finally.
{
  const planted = { enrollment: "enrolled", profiles: "applied", required_apps: "installed", os_update: "current", prep_stage: "complete" };
  const proto = Object.prototype as unknown as Record<string, unknown>;
  try {
    for (const [k, v] of Object.entries(planted)) Object.defineProperty(proto, k, { value: v, configurable: true, enumerable: false, writable: true });
    const pollutedEmpty = normalizeDevicePrep("w-18", {} as DevicePrepReportRaw);
    const pollutedAbsent = normalizeDevicePrep("w-19", undefined);
    check("device-prep: with Object.prototype polluted with every recognized key, an EMPTY report is all-unknown and never ready (own-property read is load-bearing)",
      pollutedEmpty.enrollment === "unknown" && pollutedEmpty.prepStage === "unknown" && pollutedEmpty.osUpdate === "unknown" &&
      evaluateDevicePrep(pollutedEmpty).readyForCheckout === false);
    check("device-prep: with Object.prototype polluted, an ABSENT report is all-unknown and never ready",
      pollutedAbsent.enrollment === "unknown" && pollutedAbsent.prepStage === "unknown" && evaluateDevicePrep(pollutedAbsent).readyForCheckout === false);
  } finally {
    for (const k of Object.keys(planted)) delete proto[k];
  }
}
check("device-prep evaluator is deterministic",
  JSON.stringify(evaluateDevicePrep(prepBase)) === JSON.stringify(evaluateDevicePrep(prepBase)));


// ── The live-call gate and the default transport, each condition ISOLATED ────
//
// See `lib/live-gate.ts` for why this replaced what was here (or filled the hole where
// nothing was). Short version: the gate was tested as a cumulative ladder, so only its
// last condition was falsifiable, and the mutation guard could delete the tier check —
// the control behind "dev and alpha never make live vendor calls" — with every proof
// green. The default fetch transport was never executed by anything at all.
checkLiveGateIsolated({
  check,
  family: "app-update",
  resolve: (env) => resolveAppUpdateConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    APP_UPDATE_ACCESS_TOKEN: "t",
  },
});

await checkDefaultTransport({
  check,
  family: "app-update",
  transport: makeDefaultAppUpdateTransport("https://vendor.invalid/app-update") as (a: never) => Promise<unknown>,
  arg: { deviceRef: "deviceRef-1", appRef: "appRef-1", token: "t" },
  codeOf: (err) => (err instanceof AppUpdateConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6,devicePrepCombos=${prepRes.combos},devicePrepGrants=${prepRes.noneCount}`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
