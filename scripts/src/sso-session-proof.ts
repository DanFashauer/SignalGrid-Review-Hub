// SSO session-binding proof — fully OFFLINE and deterministic.
//
// Drives the read-only SSO session connector against captured IdP session-bridge
// reports and runs the pure evaluator per device. The shared-device custody model
// is the point: on a badge-checked-out tablet, the decisive question is whether the
// LIVE SSO session is the current holder's, MFA-backed, and fresh. A leftover
// session (subject ≠ badge-holder) is the strongest negative; an active session
// bound to nobody is contained; only a bound + MFA + fresh session grants 'none';
// unknown/unreachable is never a bound-trusted session. No network.
//
// It also proves the fabric fuses this dimension: fromSsoSession → an sso_session
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SsoSessionConnector,
  SsoSessionConnectorError,
  createMockSsoSessionTransport,
  evaluateSsoSession,
  guardReadOnly,
  normalizeReport,
  resolveSsoSessionConnector,
  type SsoSessionReportRaw,
} from "@workspace/integrations/sso-session";
import { composeDeviceRisk, fromSsoSession } from "@workspace/posture-composition";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  subjectBound: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: SsoSessionReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sso-session/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://sso-session-bridge.local/sso-session";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("SSO session-binding proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, SsoSessionReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockSsoSessionTransport({ reports, expectedToken: fixture.accessToken });
const connector = new SsoSessionConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchSession(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "sso-session");
  const v = evaluateSsoSession(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.subjectBound === spec.expected.subjectBound &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── custody-model invariants ──────────────────────────────────────────────────

// The ONLY path to 'none' is a bound, MFA-backed, fresh session — and only then is
// the verdict marked subjectBound.
const strong = evaluateSsoSession(await connector.fetchSession(fixture.devices["bound-strong"].deviceId));
check("a bound + MFA + fresh session → bound_strong/none, subjectBound", strong.posture === "bound_strong" && strong.recommendedAction === "none" && strong.subjectBound === true);

// A LEFTOVER session (subject ≠ the current badge-holder) is the strongest negative
// on a shared device — a live one escalates and is a critical finding.
const leftover = evaluateSsoSession(await connector.fetchSession(fixture.devices["leftover-active"].deviceId));
check("a live leftover session (subject mismatch) → escalate + critical, NOT subjectBound", leftover.recommendedAction === "escalate" && leftover.criticalFindings.includes("session_subject_mismatch") && leftover.subjectBound === false);
const leftoverComposed = composeDeviceRisk([fromSsoSession(leftover)]);
check("a leftover session composes to the 'blocked' tier, NEVER 'ok'", leftoverComposed.riskTier === "blocked" && leftoverComposed.strongestAction === "escalate");

// An expired leftover session still restricts — contain the leftover even when stale.
const leftoverExpired = evaluateSsoSession(await connector.fetchSession(fixture.devices["leftover-expired"].deviceId));
check("an expired leftover session → restrict (still contained), NOT subjectBound", leftoverExpired.posture === "leftover_session" && leftoverExpired.recommendedAction === "restrict" && leftoverExpired.subjectBound === false);

// An ACTIVE session bound to no known holder → contain it.
const unbound = evaluateSsoSession(await connector.fetchSession(fixture.devices["unbound-active"].deviceId));
check("an active unbound session → restrict + critical, never granted", unbound.posture === "unbound_session" && unbound.recommendedAction === "restrict" && unbound.criticalFindings.includes("unbound_active_session"));

// No live session is the BASELINE — authentication is gated by the flow, not
// penalized here. Distinct from an uncovered gap.
const noSession = evaluateSsoSession(await connector.fetchSession(fixture.devices["no-session"].deviceId));
check("no active session → no_session/none (baseline, not penalized)", noSession.posture === "no_session" && noSession.recommendedAction === "none");
const uncovered = evaluateSsoSession(normalizeReport("ghost", {} as SsoSessionReportRaw), { covered: false });
check("an uncovered device is 'unknown'/step_up, never bound-trusted", uncovered.posture === "unknown" && uncovered.reasonCode === "NOT_COVERED" && uncovered.recommendedAction === "step_up" && uncovered.subjectBound === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromSsoSession(uncovered)]).riskTier !== "ok");

// The IdP being unreachable can't grant — a session we cannot verify steps up.
const unreachable = evaluateSsoSession(await connector.fetchSession(fixture.devices["idp-unreachable"].deviceId));
check("an unverifiable session (IdP unreachable) → step_up, never 'none', not subjectBound", unreachable.posture === "unverified" && unreachable.recommendedAction === "step_up" && unreachable.subjectBound === false);

// A bound session with a weak/unreadable factor raises the bar rather than granting.
const noMfa = evaluateSsoSession(await connector.fetchSession(fixture.devices["bound-no-mfa"].deviceId));
check("a bound single-factor session → step_up (re-auth to MFA), still subjectBound", noMfa.posture === "bound_weak" && noMfa.recommendedAction === "step_up" && noMfa.subjectBound === true);

// The grant requires a CONFIRMED-active session — an unknown liveness (a garbage/
// missing bridge `state`) with fresh + MFA must NEVER reach 'none', bound or unbound.
const boundUnknownState = evaluateSsoSession(await connector.fetchSession(fixture.devices["bound-state-unknown"].deviceId));
check("a BOUND session with unknown liveness (fresh+MFA) → step_up, NEVER none/bound_strong", boundUnknownState.recommendedAction === "step_up" && boundUnknownState.posture !== "bound_strong" && boundUnknownState.subjectBound === false);
check("an unknown-liveness bound session never composes to the 'ok' tier", composeDeviceRisk([fromSsoSession(boundUnknownState)]).riskTier !== "ok");
const unboundUnknownState = evaluateSsoSession(await connector.fetchSession(fixture.devices["unbound-state-unknown"].deviceId));
check("an UNBOUND session with unknown liveness (fresh+MFA) → step_up, never granted", unboundUnknownState.recommendedAction === "step_up" && unboundUnknownState.posture !== "bound_strong");
check("no bound_strong verdict is ever emitted without subjectBound", boundUnknownState.posture !== "bound_strong" && (strong.posture !== "bound_strong" || strong.subjectBound === true));
// Exhaustive: the ONLY fixture that reaches 'none'/bound_strong is a confirmed
// active + bound + MFA + fresh session — enumerate every fixture and assert it.
for (const name of names) {
  const v = evaluateSsoSession(await connector.fetchSession(fixture.devices[name].deviceId));
  if (v.recommendedAction === "none" && v.posture === "bound_strong") {
    const r = fixture.devices[name].report;
    check(`only a confirmed active+bound+MFA+fresh session grants (${name})`, r.state === "active" && r.binding === "bound" && (r.assurance === "mfa" || r.assurance === "phishing_resistant") && r.freshness === "fresh" && r.idpReachable !== false);
  }
}

// Unknown ≠ bound: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { state: "totally-live", binding: "sorta", assurance: "vibes", freshness: "recent" } as SsoSessionReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated bound/active)", norm.state === "unknown" && norm.binding === "unknown" && norm.assurance === "unknown" && norm.freshness === "unknown");

// A non-boolean idpReachable must be null, never true/false.
const boolNorm = normalizeReport("b", { idpReachable: "yes" } as unknown as SsoSessionReportRaw);
check("a non-boolean idpReachable is null (not reported), never a fabricated boolean", boolNorm.idpReachable === null);

// Worst-concern-wins: mismatch (escalate) outranks single-factor + expired (step_up).
const worst = evaluateSsoSession(await connector.fetchSession(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: subject mismatch (escalate) outranks the step_ups", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 1);

// Determinism.
const d = await connector.fetchSession(fixture.devices["bound-no-mfa"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateSsoSession(d)) === JSON.stringify(evaluateSsoSession(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromSsoSession(leftover);
check("fromSsoSession emits an sso_session signal", signal.kind === "sso_session");
const composed = composeDeviceRisk([signal]);
check("fabric fuses a leftover session into an escalate verdict", composed.strongestAction === "escalate");
const strongOk = fromSsoSession(strong);
check("a bound-strong session contributes 'none' to the fabric", strongOk.action === "none");
check("no active session contributes 'none' to the fabric (baseline)", fromSsoSession(noSession).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("DELETE"); } catch (err) { readOnly = err instanceof SsoSessionConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new SsoSessionConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["bound-strong"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: SsoSessionConnectorError | null = null;
try { await bad.fetchSession(fixture.devices["bound-strong"].deviceId); } catch (err) { authErr = err instanceof SsoSessionConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: SsoSessionConnectorError | null = null;
try { await connector.fetchSession("no-such-device"); } catch (err) { missingErr = err instanceof SsoSessionConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented session", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveSsoSessionConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveSsoSessionConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveSsoSessionConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveSsoSessionConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", SSO_SESSION_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
