// EDR/EPP endpoint threat-state proof — fully OFFLINE and deterministic.
//
// Drives the read-only EDR/EPP connector against a deterministic mock
// (normalization, pagination, read-only enforcement, auth failure, gating) and
// runs the pure aggregating evaluator per endpoint — asserting each endpoint's
// agent health + detections resolve to the right threat posture and the action
// it warrants (active critical ⇒ escalate; absent agent ⇒ alert; unscanned/not-
// reporting ⇒ unknown, never protected). No network, no real endpoint data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EdrConnectorError,
  EdrThreatConnector,
  createMockEdrTransport,
  evaluateThreatPosture,
  guardReadOnly,
  normalizeDetection,
  normalizeEndpoint,
  resolveEdrThreatConnector,
  type EndpointThreatRaw,
  type EdrTransport,
} from "@workspace/integrations/edr-threat";
import { checkLiveGateIsolated, checkCollectionRefusals } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  highestThreatSeverity: string;
  threatCount: number;
  activeThreatCount: number;
  protectionHealthy: boolean;
}
interface Fixture {
  accessToken: string;
  endpoints: Record<string, { record: EndpointThreatRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/edr-threat/endpoints.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.edr.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("EDR/EPP endpoint threat-state proof");
const names = Object.keys(fixture.endpoints);
console.log(`endpoints=${names.length}`);

// Feed every endpoint record through the connector to exercise paging/normalize.
const records: EndpointThreatRaw[] = names.map((n) => fixture.endpoints[n].record);
const transport = createMockEdrTransport({ endpoints: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new EdrThreatConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchEndpoints();
check(`pagination reassembles all ${records.length} endpoints`, normalized.length === records.length);
check("every normalized endpoint carries sourceSystem", normalized.every((e) => e.sourceSystem === "edr-epp"));

// Per-endpoint posture aggregation against the fixture expectations.
for (const name of names) {
  const spec = fixture.endpoints[name];
  const ep = normalized.find((e) => e.deviceId === spec.record.deviceId)!;
  const v = evaluateThreatPosture(ep);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.highestThreatSeverity === spec.expected.highestThreatSeverity &&
    v.threatCount === spec.expected.threatCount &&
    v.activeThreatCount === spec.expected.activeThreatCount &&
    v.protectionHealthy === spec.expected.protectionHealthy;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// Not reporting ≠ protected: a device with no EDR record is unknown (a blind
// spot to investigate), NOT clean.
const notReporting = evaluateThreatPosture(
  normalizeEndpoint({ deviceId: "ghost" }),
  { reporting: false },
);
check("a not-reporting endpoint is 'unknown', never 'protected'", notReporting.posture === "unknown" && notReporting.reasonCode === "NOT_REPORTING");

// An UNKNOWN remediation state is treated as active (never assumed handled).
const unknownRemediation = normalizeDetection({ threatId: "x", severity: "high", remediationState: "something-weird" });
check("an unmapped remediation state normalizes to 'unknown' and counts as active", unknownRemediation.remediationState === "unknown" && unknownRemediation.active === true);
const unknownEp = normalizeEndpoint({
  deviceId: "ep-unknown-rem",
  agentInstalled: true,
  agentRunning: true,
  realtimeProtection: true,
  signatureAgeHours: 1,
  threats: [{ threatId: "x", severity: "high", remediationState: "something-weird" }],
});
check("an unclassifiable high-sev detection drives a critical_compromise (fail-safe)", evaluateThreatPosture(unknownEp).posture === "critical_compromise");

// Neutralized states are inert.
check("quarantined/removed/blocked detections are not active", ["quarantined", "removed", "blocked"].every((s) => normalizeDetection({ remediationState: s }).active === false));
check("an allowed (suppressed) detection is still active", normalizeDetection({ remediationState: "allowed" }).active === true);

// The worst active concern drives the verdict even when a calmer factor co-exists
// (order-proof): a stale-sig degraded agent WITH an active critical threat still
// escalates, not step_up.
const degradedAndCompromised = normalizeEndpoint({
  deviceId: "ep-both",
  agentInstalled: true,
  agentRunning: true,
  realtimeProtection: true,
  signatureAgeHours: 200,
  threats: [{ threatId: "c", severity: "critical", remediationState: "active" }],
});
check("an active critical threat outranks degraded protection (escalate, not step_up)", evaluateThreatPosture(degradedAndCompromised).recommendedAction === "escalate");

// Stale-signature threshold is honored (default 72h).
const freshSigs = evaluateThreatPosture(normalizeEndpoint({ deviceId: "f", agentInstalled: true, agentRunning: true, realtimeProtection: true, signatureAgeHours: 71, threats: [] }));
check("signatures under the 72h threshold stay protected", freshSigs.posture === "protected" && freshSigs.protectionHealthy === true);

// Fail-safe (regression): an UNREPORTED signature age must NOT read as fresh —
// unverifiable freshness degrades protection, it never passes as protected.
const unknownSigAge = evaluateThreatPosture(normalizeEndpoint({ deviceId: "u", agentInstalled: true, agentRunning: true, realtimeProtection: true, threats: [] }));
check("an unreported signature age degrades protection, never 'protected'", unknownSigAge.posture === "degraded_protection" && unknownSigAge.protectionHealthy === false);

// Fail-safe (wedge #5, caught by the shift-1 sweep): a NEGATIVE signature age
// claims signatures newer than now — a contradictory reading. `typeof ===
// "number"` alone let -1 through the normalizer, and `-1 >= 72` is false, so the
// endpoint minted a full protected/none grant. Contradiction must resolve to
// "unverifiable", exactly like an unreported age.
const negativeSigAge = evaluateThreatPosture(normalizeEndpoint({ deviceId: "n", agentInstalled: true, agentRunning: true, realtimeProtection: true, signatureAgeHours: -1, threats: [] }));
check("a NEGATIVE signature age degrades protection, never 'protected' (wedge #5)", negativeSigAge.posture === "degraded_protection" && negativeSigAge.protectionHealthy === false);

// Determinism.
const dc = normalized.find((e) => e.deviceId === "ep-critical")!;
check("evaluator is deterministic", JSON.stringify(evaluateThreatPosture(dc)) === JSON.stringify(evaluateThreatPosture(dc)));

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. This family's negative-signature-age wedge
// (wedge #5, above) was exactly the kind fixtures never catch — fixtures
// exercise the states someone thought of. Every combination of every axis is
// executed through the REAL normalizer + evaluator, and the granting set is
// pinned by equality, so the next such defect fails the proof instead of
// shipping.
{
  const REMEDIATED = [{ threatId: "r", severity: "medium", remediationState: "quarantined" }];
  const ACTIVE_HIGH = [{ threatId: "h", severity: "high", remediationState: "active" }];
  const ACTIVE_LOW = [{ threatId: "l", severity: "low", remediationState: "active" }];
  // An unmapped remediation state is an UNPROVEN neutralization — must count active.
  const UNPROVEN = [{ threatId: "u", severity: "high", remediationState: "something-weird" }];
  const domains = {
    reporting: [true, false],
    agentInstalled: [true, false],
    agentRunning: [true, false],
    realtimeProtection: [true, false],
    // fresh, at-threshold stale, negative (contradictory), unreported.
    sigAge: [1, 72, -1, null],
    // unobserved feed, observed-empty, and the three live shapes.
    threats: [null, [], REMEDIATED, ACTIVE_HIGH, ACTIVE_LOW, UNPROVEN],
  } as const;

  type Enum = { ep: ReturnType<typeof normalizeEndpoint>; reporting: boolean };
  const build = (c: Record<string, unknown>): Enum => ({
    ep: normalizeEndpoint({
      deviceId: "ep.enum",
      agentInstalled: c.agentInstalled as boolean,
      agentRunning: c.agentRunning as boolean,
      realtimeProtection: c.realtimeProtection as boolean,
      signatureAgeHours: c.sigAge === null ? undefined : (c.sigAge as number),
      threats: c.threats === null ? undefined : (c.threats as EndpointThreatRaw["threats"]),
    }),
    reporting: c.reporting as boolean,
  });

  const swept = enumerateGrantSafety<Enum, ReturnType<typeof evaluateThreatPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateThreatPosture(s.ep, { reporting: s.reporting }),
    actionOf: (v) => v.recommendedAction,
    // The ONLY clean state: reporting, feed observed and empty, agent installed
    // AND running, RTP on, signature age reported, non-negative, and fresh.
    positivelyClean: (c) =>
      c.reporting === true && c.threats === domains.threats[1] &&
      c.agentInstalled === true && c.agentRunning === true &&
      c.realtimeProtection === true && c.sigAge === 1,
    // The grant must be the EARNED reason, with protection positively confirmed.
    confirmedWhenNone: (v) =>
      v.reasonCode === "NO_THREATS_HEALTHY" && v.posture === "protected" && v.protectionHealthy === true,
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 2 * 2 * 2 * 2 * 4 * 6);
  check("ENUMERATION: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: exactly ONE granting state (non-vacuous)", swept.noneCount === 1);

  // NEGATIVE CONTROL — the enumeration can fail: declare signature freshness
  // irrelevant to cleanliness and the harness must object, because the evaluator
  // (correctly) refuses to grant stale, negative, or unreported ages. A harness
  // that cannot fail proves nothing.
  const wrongPredicate = enumerateGrantSafety<Enum, ReturnType<typeof evaluateThreatPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateThreatPosture(s.ep, { reporting: s.reporting }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.reporting === true && c.threats === domains.threats[1] &&
      c.agentInstalled === true && c.agentRunning === true && c.realtimeProtection === true,
  });
  check("NEGATIVE CONTROL: declaring signature age irrelevant is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");

  // The contradictory (negative) age grades identically to an unreported one,
  // on every other axis combination — pinned so a future normalizer change
  // cannot quietly turn "newer than now" back into "fresh".
  check("a negative signature age grades identically to an unreported one, on every axis combination",
    domains.reporting.every((rep) => domains.agentInstalled.every((ai) => domains.agentRunning.every((ar) =>
      domains.realtimeProtection.every((rtp) => domains.threats.every((th) => {
        const va = evaluateThreatPosture(build({ reporting: rep, agentInstalled: ai, agentRunning: ar, realtimeProtection: rtp, sigAge: -1, threats: th }).ep, { reporting: rep });
        const vb = evaluateThreatPosture(build({ reporting: rep, agentInstalled: ai, agentRunning: ar, realtimeProtection: rtp, sigAge: null, threats: th }).ep, { reporting: rep });
        return va.reasonCode === vb.reasonCode && va.recommendedAction === vb.recommendedAction && va.posture === vb.posture;
      }))))));
}

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof EdrConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new EdrThreatConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: EdrConnectorError | null = null;
try { await bad.listEndpoints(); } catch (err) { authErr = err instanceof EdrConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveEdrThreatConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveEdrThreatConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveEdrThreatConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveEdrThreatConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", EDR_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "edr-threat",
  resolve: (env) => resolveEdrThreatConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    EDR_ACCESS_TOKEN: "t",
  },
});


// COLLECTION SHAPE and PAGE-CAP REFUSAL — both survived mutation until 2026-08-25.
// Shared helper, one statement of a rule nine families implement identically.
await checkCollectionRefusals({
  check,
  family: "edr-threat",
  listWith: (t, pageLimit) => () =>
    new EdrThreatConnector({ accessToken: "t", baseUrl: BASE_URL, pageLimit }, t as unknown as EdrTransport).listEndpoints(),
  codeOf: (e) => (e instanceof EdrConnectorError ? e.code : undefined),
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
