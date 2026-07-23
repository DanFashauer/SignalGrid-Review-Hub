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
  evaluateAccessGovernancePosture,
  guardReadOnly,
  normalizeReport,
  resolveAccessGovernanceConnector,
  type AccessGovernanceReportRaw,
} from "@workspace/integrations/access-governance";
import { composeDeviceRisk, fromAccessGovernance } from "@workspace/posture-composition";

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

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
