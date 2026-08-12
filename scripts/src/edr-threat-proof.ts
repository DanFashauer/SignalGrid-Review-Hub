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
} from "@workspace/integrations/edr-threat";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

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

// Determinism.
const dc = normalized.find((e) => e.deviceId === "ep-critical")!;
check("evaluator is deterministic", JSON.stringify(evaluateThreatPosture(dc)) === JSON.stringify(evaluateThreatPosture(dc)));

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

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
