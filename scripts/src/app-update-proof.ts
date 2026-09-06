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
  type AppUpdateReportRaw,
  type NormalizedAppUpdate,
} from "@workspace/integrations/app-update";
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
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
