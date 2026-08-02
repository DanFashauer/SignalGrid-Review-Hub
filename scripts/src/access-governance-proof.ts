// IAM / access-governance runtime posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only access-governance connector against captured IGA/PAM-bridge
// reports and runs the pure evaluator per principal — asserting each resolves to
// the right posture and action for the identity bound to a badge-checked-out
// shared session. The fail-safe boundary is the whole point: a leaver/disabled
// account still transacting escalates; an orphaned account / out-of-scope or
// decertified entitlement / SoD conflict / expired or unmonitored privilege
// restricts; standing (not JIT) privilege or a stale certification steps up; any
// unreadable governance signal steps up, NEVER reads as authorized; a principal no
// IGA source observes is a blind spot, never authorized. No network, no directory.
//
// It also proves the fabric fuses this dimension: fromAccessGovernance → an
// access_governance ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccessGovernanceConnector,
  AccessGovernanceConnectorError,
  createMockAccessGovernanceTransport,
  deriveGovernanceReadFreshness,
  evaluateAccessGovernancePosture,
  guardReadOnly,
  normalizeReport,
  resolveAccessGovernanceConnector,
  type AccessGovernanceReportRaw,
  type NormalizedAccessGovernancePosture,
} from "@workspace/integrations/access-governance";
import { composeDeviceRisk, fromAccessGovernance } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
}
interface Fixture {
  accessToken: string;
  principals: Record<string, { principalId: string; report: AccessGovernanceReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/access-governance/principals.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://iga-bridge.local/access-governance";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("IAM / access-governance runtime posture proof (grid_collected)");
const names = Object.keys(fixture.principals);
console.log(`principals=${names.length}`);

const reports: Record<string, AccessGovernanceReportRaw> = {};
for (const n of names) reports[fixture.principals[n].principalId] = fixture.principals[n].report;
const transport = createMockAccessGovernanceTransport({ reports, expectedToken: fixture.accessToken });
const connector = new AccessGovernanceConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.principals[name];
  const normalized = await connector.fetchPosture(spec.principalId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "access-governance");
  const v = evaluateAccessGovernancePosture(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.principalId === spec.principalId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ────────────────────────────────────────────────────────

// No IGA source observes the principal → unknown (blind spot). Fail-safe: step_up
// (never 'monitor'/'none', which compose to the "ok" tier — less data must not read
// safer). An uncovered principal is never "authorized".
const noCov = evaluateAccessGovernancePosture(normalizeReport("ghost", {} as AccessGovernanceReportRaw), { covered: false });
check("an uncovered principal is 'unknown'/step_up, never authorized", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up");
const uncoveredComposed = composeDeviceRisk([fromAccessGovernance(noCov)]);
check("an uncovered principal composes to at_risk, NEVER the 'ok' tier", uncoveredComposed.riskTier !== "ok" && uncoveredComposed.strongestAction === "step_up");

// An entirely UNREADABLE report resolves to unverified/step_up, never authorized.
const blank = evaluateAccessGovernancePosture(normalizeReport("blank", {} as AccessGovernanceReportRaw));
check("a fully-unreadable governance report is 'unverified'/step_up, never 'authorized'", blank.posture === "unverified" && blank.recommendedAction === "step_up");
check("account/entitlement/certification/sod/privilege are all counted unknown", blank.unknownSignals.length === 5);

// Unknown ≠ authorized: an unrecognized enum value must normalize to the safe unknown.
const norm = normalizeReport("n", { account: { status: "retired-ish" }, entitlement: { scope: "godmode" }, privilege: { mode: "forever" } } as AccessGovernanceReportRaw);
check("an unrecognized enum normalizes to 'unknown' (not a fabricated value)", norm.accountStatus === "unknown" && norm.entitlementScope === "unknown" && norm.privilege === "unknown");

// A non-elevated session with an unknown monitored flag does NOT count session
// monitoring as unknown (nothing to monitor when there is no elevation).
const nonElevatedUnknownMon = evaluateAccessGovernancePosture(
  normalizeReport("q", { account: { status: "active" }, entitlement: { scope: "in_scope" }, certification: { state: "certified" }, sod: { conflict: false }, privilege: { mode: "none", sessionMonitored: null } } as AccessGovernanceReportRaw),
);
check("session-monitoring is not an unknown for a non-privileged session", nonElevatedUnknownMon.unknownSignals.length === 0 && nonElevatedUnknownMon.posture === "authorized");

// …but an ELEVATED session whose monitoring state is unreadable DOES count session
// monitoring as unknown → step_up (fail-safe: never assume an unrecorded elevated
// session is monitored). Pins evaluate.ts's isElevated+null-monitoring branch.
const elevatedUnknownMon = evaluateAccessGovernancePosture(
  normalizeReport("em", { account: { status: "active" }, entitlement: { scope: "in_scope" }, certification: { state: "certified" }, sod: { conflict: false }, privilege: { mode: "standing", sessionMonitored: null } } as AccessGovernanceReportRaw),
);
check("session-monitoring IS an unknown for an elevated session with an unreadable monitored flag", elevatedUnknownMon.unknownSignals.includes("session_monitoring") && elevatedUnknownMon.unknownSignals.length === 1 && elevatedUnknownMon.posture === "standing_privilege" && elevatedUnknownMon.recommendedAction === "step_up");

// Worst-concern-wins: leaver + out-of-scope + decertified + sod + unmonitored →
// escalate (the leaver), never diluted by the restricts/step_ups below it.
const worst = evaluateAccessGovernancePosture(await connector.fetchPosture(fixture.principals["worst-of-several"].principalId));
check("worst-concern-wins: an escalate (leaver) outranks stacked restricts/step_ups", worst.recommendedAction === "escalate" && worst.reasonCode === "LEAVER_STILL_ACTIVE" && worst.criticalFindings.length === 5);

// restrict outranks step_up within one facet: standing (step_up) + unmonitored
// (restrict) on the same privileged session → restrict.
const unmon = evaluateAccessGovernancePosture(await connector.fetchPosture(fixture.principals["unmonitored-privilege"].principalId));
check("restrict (unmonitored) outranks step_up (standing) on one privileged session", unmon.recommendedAction === "restrict" && unmon.reasonCode === "UNMONITORED_PRIVILEGED_SESSION");

// Determinism (PURE_LIB invariant — no clock/no randomness).
const d = await connector.fetchPosture(fixture.principals["sod-conflict"].principalId);
check("evaluator is deterministic", JSON.stringify(evaluateAccessGovernancePosture(d)) === JSON.stringify(evaluateAccessGovernancePosture(d)));

// ── fabric fusion ────────────────────────────────────────────────────────────────

const leaver = evaluateAccessGovernancePosture(await connector.fetchPosture(fixture.principals["leaver-active"].principalId));
const signal = fromAccessGovernance(leaver);
check("fromAccessGovernance emits an access_governance signal", signal.kind === "access_governance");
const composed = composeDeviceRisk([signal]);
check("fabric fuses a leaver-still-active principal into an escalate verdict", composed.strongestAction === "escalate");

const authorized = fromAccessGovernance(evaluateAccessGovernancePosture(await connector.fetchPosture(fixture.principals["authorized"].principalId)));
check("a fully-authorized principal contributes 'none' to the fabric", authorized.action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof AccessGovernanceConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new AccessGovernanceConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.principals["authorized"].principalId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: AccessGovernanceConnectorError | null = null;
try { await bad.fetchPosture(fixture.principals["authorized"].principalId); } catch (err) { authErr = err instanceof AccessGovernanceConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: AccessGovernanceConnectorError | null = null;
try { await connector.fetchPosture("no-such-principal"); } catch (err) { missingErr = err instanceof AccessGovernanceConnectorError ? err : null; }
check("an unknown principal surfaces upstream_error, never an invented posture", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveAccessGovernanceConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveAccessGovernanceConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveAccessGovernanceConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveAccessGovernanceConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", ACCESS_GOVERNANCE_ACCESS_TOKEN: "t" }).mode === "live");

// ── the J and M of JML (intake ledger row 27) ───────────────────────────────────
// The leaver slice was modeled from birth; the audit of the owner's canonical
// endpoint signal set found joiner/mover context modeled NOWHERE. The axis is
// affirmative-only, and its teeth are the composition with an entitlement symptom.

const lifecycleBase = {
  account: { status: "active" }, entitlement: { scope: "in_scope" },
  certification: { state: "certified" }, sod: { conflict: false }, privilege: { mode: "none" },
} as AccessGovernanceReportRaw;
const lc = (extra: Record<string, unknown>) => normalizeReport("p-1", { ...lifecycleBase, ...extra });

const moverStale = evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "recent_transfer" }, entitlement: { scope: "over_privileged" } }));
check("a RECENT TRANSFER with over-privileged entitlements → mover_stale_entitlement/ALERT (the WHY behind the symptom, its own queue-readable reason)", moverStale.posture === "mover_stale_entitlement" && moverStale.reasonCode === "MOVER_STALE_ENTITLEMENT" && moverStale.recommendedAction === "alert" && moverStale.criticalFindings.includes("mover_stale_entitlement"));
const moverRecert = evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "recent_transfer" }, certification: { state: "recert_due" } }));
check("a recent transfer with a recert-due entitlement is the same mover defect → alert", moverRecert.reasonCode === "MOVER_STALE_ENTITLEMENT" && moverRecert.recommendedAction === "alert");
const joinerStanding = evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "new_hire" }, privilege: { mode: "standing", sessionMonitored: true } }));
check("a NEW HIRE already holding STANDING privilege → joiner_over_provisioned/ALERT (over-provisioned at birth)", joinerStanding.posture === "joiner_over_provisioned" && joinerStanding.reasonCode === "NEW_HIRE_OVER_PROVISIONED" && joinerStanding.recommendedAction === "alert");
const cleanJoiner = evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "new_hire" } }));
check("a clean new hire is a visible MONITOR, never a grant and never a nag — a transition is normal life", cleanJoiner.posture === "lifecycle_transition" && cleanJoiner.reasonCode === "LIFECYCLE_TRANSITION" && cleanJoiner.recommendedAction === "monitor");
check("a clean recent transfer is the same visible monitor", evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "recent_transfer" } })).recommendedAction === "monitor");
check("an UNREPORTED lifecycle stage forecloses nothing — the pre-axis clean grant stands (affirmative-only)", evaluateAccessGovernancePosture(lc({})).recommendedAction === "none");
check("a garbled lifecycle stage normalizes to unknown, never a fabricated stage", lc({ lifecycle: { stage: "probably new??" } }).lifecycleStage === "unknown");
const leaverMover = evaluateAccessGovernancePosture(lc({ lifecycle: { stage: "recent_transfer" }, entitlement: { scope: "over_privileged" }, account: { status: "leaver_pending" } }));
check("worst-concern-wins: a leaver still outranks the mover finding", leaverMover.recommendedAction === "escalate" && leaverMover.reasonCode === "LEAVER_STILL_ACTIVE");

// ── the governance-read recency axis (intake ledger row 42) ─────────────────────
// The IGA plane is cadence-based ("quarterly / on change"), so a bridge whose
// upstream HR/SCIM sync silently broke keeps truthfully relaying its LAST
// evaluation: affirmative values, aged. Before this axis the concrete audit
// scenario — transfer three weeks ago, sync broken four weeks, bridge relays
// established/in_scope/certified — reached FULLY_AUTHORIZED/none. The axis is
// the row-26 caller-posed shape (source-reported instant + caller age bound +
// caller reference instant, no clock in any decision path), capped at step_up,
// with worst-concern-wins keeping stale bad news outranking.
const REF = "2026-08-02T12:00:00Z";
const DAY_SECONDS = 86400;
const readOpts = { maxGovernanceReadAgeSeconds: DAY_SECONDS, referenceTime: REF };
const cleanAt = (observedAt: unknown) => normalizeReport("p-2", { ...lifecycleBase, observedAt } as AccessGovernanceReportRaw);

check(
  "freshness derivation: unposed → unassessed; garbled pose → unknown; future-dated → unknown; exactly at the bound → fresh (inclusive); past it → stale",
  deriveGovernanceReadFreshness("2026-08-02T11:00:00Z", undefined, REF) === "unassessed" &&
    deriveGovernanceReadFreshness("2026-08-02T11:00:00Z", 0, REF) === "unknown" &&
    deriveGovernanceReadFreshness("2026-08-03T00:00:00Z", DAY_SECONDS, REF) === "unknown" &&
    deriveGovernanceReadFreshness("2026-08-01T12:00:00Z", DAY_SECONDS, REF) === "fresh" &&
    deriveGovernanceReadFreshness("2026-08-01T11:59:59Z", DAY_SECONDS, REF) === "stale",
);
// Loosely-typed callers exist (the pose crosses an API boundary): a NON-NUMBER
// bound must be an unreadable question, and a NON-FINITE one must never grade —
// an Infinity bound would otherwise answer "fresh" for ANY aged read, the exact
// optimistic default the axis exists to forbid.
check(
  "a malformed pose never grades: a string bound → unknown; Infinity → unknown (never an always-fresh answer); NaN → unknown (never a fabricated stale)",
  deriveGovernanceReadFreshness("2026-08-02T11:00:00Z", "3600" as unknown as number, REF) === "unknown" &&
    deriveGovernanceReadFreshness("2020-01-01T00:00:00Z", Number.POSITIVE_INFINITY, REF) === "unknown" &&
    deriveGovernanceReadFreshness("2026-08-02T11:00:00Z", Number.NaN, REF) === "unknown",
);

const freshClean = evaluateAccessGovernancePosture(cleanAt("2026-08-02T11:00:00Z"), readOpts);
check("a FRESH read on a clean principal still grants — the axis challenges staleness, never governance itself", freshClean.posture === "authorized" && freshClean.recommendedAction === "none");

const staleClean = evaluateAccessGovernancePosture(cleanAt("2026-07-01T00:00:00Z"), readOpts);
check("the audit scenario: an affirmative clean state relayed from a STALE sync → stale_governance_read/STEP_UP, no longer FULLY_AUTHORIZED/none", staleClean.posture === "stale_governance_read" && staleClean.reasonCode === "GOVERNANCE_READ_STALE" && staleClean.recommendedAction === "step_up");

const staleLeaver = evaluateAccessGovernancePosture(
  normalizeReport("p-3", { ...lifecycleBase, account: { status: "leaver_pending" }, observedAt: "2026-07-01T00:00:00Z" } as AccessGovernanceReportRaw),
  readOpts,
);
check("stale BAD news keeps outranking: a leaver_pending relayed from the same stale sync still ESCALATES — staleness never launders a known concern down to a challenge", staleLeaver.recommendedAction === "escalate" && staleLeaver.reasonCode === "LEAVER_STILL_ACTIVE");

const posedUnanswerable = evaluateAccessGovernancePosture(cleanAt(undefined), readOpts);
check("posed-but-unanswerable: a posed bound with no reported instant → unknown raises (step_up), never authorized", posedUnanswerable.recommendedAction === "step_up" && posedUnanswerable.reasonCode === "GOVERNANCE_READ_TIME_UNKNOWN" && posedUnanswerable.unknownSignals.includes("governance_read_time"));

const unposedOldRead = evaluateAccessGovernancePosture(cleanAt("2020-01-01T00:00:00Z"));
check("AFFIRMATIVE-ONLY: an unposed axis forecloses nothing — every caller and bridge deployed before it keeps its behavior", unposedOldRead.posture === "authorized" && unposedOldRead.recommendedAction === "none");

check("a garbled bridge timestamp normalizes to null (unknown), never an invented recency", cleanAt("last tuesday-ish").observedAt === null && cleanAt("2026-08-02T11:00:00+02:00").observedAt === null && cleanAt("2026-08-02T11:00:00Z").observedAt === "2026-08-02T11:00:00Z");

// ── exhaustive allow-path safety ────────────────────────────────────────────────
//
// Brute-force the ENTIRE normalized input space (not fixture-bound), so the proof
// genuinely CONSTRAINS the grant path. The evaluator may emit action "none" (the
// `authorized` posture) for EXACTLY a positively-confirmed clean state — an active
// account, an in-scope entitlement, a current certification, no SoD conflict, and
// either no active elevation OR a JIT-active elevation whose session is CONFIRMED
// monitored — and for nothing else. Any unknown/malformed value on any decisive
// field (an unknown status/scope/certification, a null SoD, a standing or expired
// privilege, an unmonitored/unknown-monitoring elevation) must fall out of the grant.
const domains = {
  accountStatus: ["active", "disabled", "orphaned", "leaver_pending", "unknown"],
  entitlementScope: ["in_scope", "over_privileged", "out_of_scope", "unknown"],
  certification: ["certified", "recert_due", "decertified", "never_certified", "unknown"],
  sodConflict: [true, false, null],
  privilege: ["none", "jit_active", "jit_expired", "standing", "unknown"],
  privilegedSessionMonitored: [true, false, null],
  lifecycleStage: ["new_hire", "established", "recent_transfer", "unknown"],
};
const positivelyCleanBase = (c: Record<string, unknown>): boolean => {
  const { accountStatus, entitlementScope, certification, sodConflict, privilege, privilegedSessionMonitored, lifecycleStage } = c;
  // Session monitoring is only meaningful for an ACTIVE elevation; a JIT-active
  // session must be confirmed monitored, and a non-elevated principal has nothing
  // to monitor. A standing/expired/unknown privilege never grants.
  const privilegeClean =
    privilege === "none" || (privilege === "jit_active" && privilegedSessionMonitored === true);
  return (
    accountStatus === "active" &&
    entitlementScope === "in_scope" &&
    certification === "certified" &&
    sodConflict === false &&
    privilegeClean &&
    // The lifecycle axis is affirmative-only: an asserted transition is a
    // visible monitor (never a grant), while established/unreported stages
    // leave the pre-axis grant untouched.
    (lifecycleStage === "established" || lifecycleStage === "unknown")
  );
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) =>
    ({ sourceSystem: "access-governance", principalId: "enum", source: "enum", ...c }) as NormalizedAccessGovernancePosture,
  evaluate: evaluateAccessGovernancePosture,
  actionOf: (v) => v.recommendedAction,
  // Only the `authorized` posture may ever contribute 'none'.
  confirmedWhenNone: (v) => v.posture === "authorized" && v.reasonCode === "FULLY_AUTHORIZED",
  positivelyClean: positivelyCleanBase,
});
check(
  `exhaustive: over all ${enumRes.combos} input combinations, action 'none' is emitted for EXACTLY the positively-confirmed authorized states (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 18000,
);
check("exhaustive: some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// The recency axis brute-forced (intake ledger row 42): with the currency
// question POSED, a grant additionally requires a FRESH read — over the whole
// extended input space (a stale or unreadable instant can never reach 'none').
// The UNPOSED enumeration above stays byte-identical: the axis never
// forecloses for callers that did not pose it.
const FRESH_AT = "2026-08-02T11:00:00Z";
const posedDomains = { ...domains, observedAt: [FRESH_AT, "2026-07-01T00:00:00Z", null] };
const posedEnum = enumerateGrantSafety({
  domains: posedDomains,
  build: (c) =>
    ({ sourceSystem: "access-governance", principalId: "enum", source: "enum", ...c }) as NormalizedAccessGovernancePosture,
  evaluate: (p) => evaluateAccessGovernancePosture(p, readOpts),
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) => v.posture === "authorized" && v.reasonCode === "FULLY_AUTHORIZED",
  positivelyClean: (c) => positivelyCleanBase(c) && c.observedAt === FRESH_AT,
});
check(
  `exhaustive (recency axis POSED): over all ${posedEnum.combos} combinations, 'none' additionally requires a fresh governance read (mismatches=${posedEnum.mismatches}${posedEnum.firstMismatch ? ", first=" + posedEnum.firstMismatch : ""})`,
  posedEnum.mismatches === 0 && posedEnum.combos === productOf(posedDomains) && posedEnum.combos === 54000,
);
check("exhaustive (posed): fresh clean states DO grant (the posed enumeration is not vacuous)", posedEnum.noneCount > 0);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
