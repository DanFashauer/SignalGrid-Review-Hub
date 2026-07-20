// Identity / SSO sign-in-risk proof — fully OFFLINE and deterministic.
//
// Drives the read-only identity-risk connector against a deterministic mock
// (normalization of vendor risk vocabularies, pagination, read-only enforcement,
// auth failure, gating) and runs the pure aggregating evaluator per principal —
// asserting each principal's IdP risk state + detections resolve to the right
// sign-in-risk posture and the action it warrants (confirmed-compromised /
// leaked-creds ⇒ escalate; risky sign-in without MFA ⇒ restrict; no IdP coverage
// ⇒ unknown, never trusted). No network, no real identity data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IdentityRiskConnector,
  IdentityRiskConnectorError,
  createMockIdentityTransport,
  evaluateIdentityRisk,
  guardReadOnly,
  normalizeDetection,
  normalizePrincipal,
  resolveIdentityRiskConnector,
  type PrincipalRiskRaw,
} from "@workspace/integrations/identity-risk";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  riskLevel: string;
  riskState: string;
  detectionCount: number;
  highestDetectionGrade: string | null;
  mfaSatisfied: boolean | null;
}
interface Fixture {
  accessToken: string;
  principals: Record<string, { record: PrincipalRiskRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/identity-risk/principals.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.identity.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Identity / SSO sign-in-risk proof");
const names = Object.keys(fixture.principals);
console.log(`principals=${names.length}`);

// Feed every principal record through the connector to exercise paging/normalize.
const records: PrincipalRiskRaw[] = names.map((n) => fixture.principals[n].record);
const transport = createMockIdentityTransport({ principals: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new IdentityRiskConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchPrincipals();
check(`pagination reassembles all ${records.length} principals`, normalized.length === records.length);
check("every normalized principal carries sourceSystem", normalized.every((p) => p.sourceSystem === "identity-risk"));

// Per-principal posture aggregation against the fixture expectations.
for (const name of names) {
  const spec = fixture.principals[name];
  const p = normalized.find((x) => x.principalId === spec.record.principalId)!;
  const v = evaluateIdentityRisk(p);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.riskLevel === spec.expected.riskLevel &&
    v.riskState === spec.expected.riskState &&
    v.detectionCount === spec.expected.detectionCount &&
    v.highestDetectionGrade === spec.expected.highestDetectionGrade &&
    v.mfaSatisfied === spec.expected.mfaSatisfied;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// No IdP coverage ≠ trusted: a principal the risk engine has no record for is
// unknown (a blind spot), NOT trusted.
const notCovered = evaluateIdentityRisk(normalizePrincipal({ principalId: "ghost" }), { covered: false });
check("a not-covered principal is 'unknown', never 'trusted'", notCovered.posture === "unknown" && notCovered.reasonCode === "NOT_COVERED");

// An UNKNOWN/unmapped detection type is graded 'medium' (never benign) and, when
// the principal is at_risk, drives at least a step-up.
const unknownDet = normalizeDetection({ detectionType: "some-brand-new-signal", riskLevel: "medium" });
check("an unmapped detection type normalizes to 'unknown' and grades 'medium'", unknownDet.detectionType === "unknown" && unknownDet.grade === "medium");
const unknownDetPrincipal = evaluateIdentityRisk(normalizePrincipal({
  principalId: "p-unknown-det",
  riskState: "atRisk",
  detections: [{ detectionType: "some-brand-new-signal" }],
}));
check("an unclassifiable detection still forces at least a step-up (never trusted)", unknownDetPrincipal.recommendedAction === "step_up" && unknownDetPrincipal.posture === "at_risk");

// A risky sign-in that bypassed MFA is treated as restrict, not a (bypassable) step-up.
const noMfa = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-nomfa", riskLevel: "medium", riskState: "atRisk", mfaSatisfied: false }));
check("a medium-risk sign-in WITHOUT mfa escalates to restrict (step-up already bypassed)", noMfa.recommendedAction === "restrict" && noMfa.reasonCode === "HIGH_RISK_NO_MFA");

// confirmed_compromised dominates regardless of everything else.
const compromised = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-cc", riskLevel: "low", riskState: "confirmedCompromised" }));
check("confirmed_compromised → escalate even when riskLevel is low", compromised.recommendedAction === "escalate" && compromised.posture === "compromised");

// Fail-safe (regression): an IdP-flagged at_risk principal with an UNQUANTIFIED
// level (e.g. Entra "hidden" without P2) and no detections must NOT read as
// trusted — it floors to a step-up.
const atRiskHidden = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-hidden", riskState: "atRisk", riskLevel: "hidden", detections: [] }));
check("an at_risk principal with a hidden/unknown level is never 'trusted' (floors to step_up)", atRiskHidden.posture === "at_risk" && atRiskHidden.recommendedAction === "step_up" && atRiskHidden.reasonCode === "RISK_STATE_AT_RISK");

// Severity (regression): MCAS impossible-travel must grade 'high' like genuine
// impossible-travel, not be diluted to 'medium' via the mfa_failed bucket.
const mcas = normalizeDetection({ detectionType: "mcasImpossibleTravel" });
check("mcasImpossibleTravel normalizes to impossible_travel and grades 'high'", mcas.detectionType === "impossible_travel" && mcas.grade === "high");

// confirmed_safe with no residual detections is trusted.
const safe = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-safe", riskState: "confirmedSafe", detections: [] }));
check("confirmed_safe with no detections is trusted/none", safe.posture === "trusted" && safe.recommendedAction === "none");

// leaked credentials (compromise grade) outranks a co-present high risk level.
const leaked = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-l", riskLevel: "high", riskState: "atRisk", detections: [{ detectionType: "leakedCredentials" }] }));
check("leaked-credentials (escalate) outranks a high risk level (restrict)", leaked.recommendedAction === "escalate");

// Determinism.
const pc = normalized.find((p) => p.principalId === "p-leaked")!;
check("evaluator is deterministic", JSON.stringify(evaluateIdentityRisk(pc)) === JSON.stringify(evaluateIdentityRisk(pc)));

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("DELETE"); } catch (err) { readOnly = err instanceof IdentityRiskConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new IdentityRiskConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: IdentityRiskConnectorError | null = null;
try { await bad.listPrincipals(); } catch (err) { authErr = err instanceof IdentityRiskConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveIdentityRiskConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveIdentityRiskConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveIdentityRiskConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveIdentityRiskConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", IDENTITY_RISK_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
