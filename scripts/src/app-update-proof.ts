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
  evaluateAppUpdate,
  normalizeReport,
  parseVersion,
  compareVersions,
  type AppUpdateReportRaw,
  type NormalizedAppUpdate,
} from "@workspace/integrations/app-update";
import { SIGNAL_KINDS, composeDeviceRisk, fromAppUpdate } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

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
const forcedPending = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: true, channel: "managed" });
check("behind latest with force_update → restrict (the flag's one meaning is 'older versions must not be used')",
  forcedPending.recommendedAction === "restrict" && forcedPending.reasonCode === "FORCED_UPDATE_PENDING");
const advisory = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", force_update: false, channel: "managed" });
check("behind latest, floor satisfied, NOT forced → monitor (a nudge, not fatigue)",
  advisory.recommendedAction === "monitor" && advisory.reasonCode === "UPDATE_AVAILABLE");
const forceUnknown = ev({ installed_version: "2.1.0", latest_version: "2.4.0", min_version: "2.0.0", channel: "managed" });
check("behind latest with the force flag UNREADABLE → step_up (cannot confirm the lag is permitted)",
  forceUnknown.recommendedAction === "step_up" && forceUnknown.reasonCode === "FORCE_POLICY_UNKNOWN");

// ── unknowns raise, never grant ─────────────────────────────────────────────────
const noInstalled = ev({ latest_version: "2.4.0", channel: "managed" });
check("no installed version reported → step_up (VERSION_UNKNOWN), never current",
  noInstalled.recommendedAction === "step_up" && noInstalled.reasonCode === "VERSION_UNKNOWN");
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
  sideload.recommendedAction === "restrict" && sideload.reasonCode === "UNMANAGED_INSTALL");
const noChannel = ev({ installed_version: "2.4.0", latest_version: "2.4.0" });
check("channel unknown → step_up (provenance must be positively managed)",
  noChannel.recommendedAction === "step_up" && noChannel.reasonCode === "CHANNEL_UNKNOWN");

// ── malformed / hostile report shapes ───────────────────────────────────────────
const contradictory = normalizeReport("c", "a", { installed_version: "2.4.0", latest_version: "2.0.0", min_version: "2.2.0", channel: "managed" });
check("a manifest whose floor exceeds its own latest is MALFORMED (self-contradiction), currency unknown",
  contradictory.reportIntegrity === "malformed" && contradictory.currency === "unknown" && evaluateAppUpdate(contradictory).recommendedAction !== "none");
const junkVersion = ev({ installed_version: "latest!", latest_version: "2.4.0", channel: "managed" });
check("an asserted-but-unparseable version marks the report malformed and cannot grant",
  junkVersion.recommendedAction !== "none");
const junkForce = normalizeReport("f", "a", { installed_version: "2.4.0", latest_version: "2.4.0", force_update: "yes", channel: "managed" });
check("a non-boolean force_update is an assertion we could not read → malformed", junkForce.reportIntegrity === "malformed");
const extraKey = normalizeReport("x", "a", { installed_version: "2.4.0", latest_version: "2.4.0", channel: "managed", update_url: "https://x" } as AppUpdateReportRaw);
check("an unrecognized key (e.g. an update_url we would never fetch) marks the report malformed",
  extraKey.reportIntegrity === "malformed" && evaluateAppUpdate(extraKey).recommendedAction !== "none");
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
check("channel case and whitespace are canonicalized, not rejected",
  normalizeReport("cw", "a", { channel: " MANAGED " } as AppUpdateReportRaw).channel === "managed");

// ── exhaustive (normalized): the grant is current + managed + clean ─────────────
const normDomains = {
  currency: ["current", "behind", "below_floor", "unknown"],
  forcePolicy: ["forced", "not_forced", "unknown"],
  channel: ["managed", "unmanaged", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedAppUpdate => ({
  sourceSystem: "app-update", deviceRef: "enum", appRef: "enum", source: "enum",
  currency: c.currency as NormalizedAppUpdate["currency"],
  forcePolicy: c.forcePolicy as NormalizedAppUpdate["forcePolicy"],
  channel: c.channel as NormalizedAppUpdate["channel"],
  reportIntegrity: c.reportIntegrity as NormalizedAppUpdate["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluateAppUpdate,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.currencyConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.currency === "current" && c.channel === "managed" && c.reportIntegrity === "clean",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, currency is confirmed ONLY when current + managed + clean (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 72,
);
check("exhaustive (normalized): exactly the THREE current+managed+clean states grant (one per force-flag value — the pinned doctrine)",
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

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
