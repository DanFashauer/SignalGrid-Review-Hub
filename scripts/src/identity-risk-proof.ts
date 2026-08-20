// Identity / SSO sign-in-risk proof — fully OFFLINE and deterministic.
//
// Drives the read-only identity-risk connector against a deterministic mock
// (normalization of vendor risk vocabularies, pagination, read-only enforcement,
// auth failure, gating) and runs the pure aggregating evaluator per principal —
// asserting each principal's IdP risk state + detections resolve to the right
// sign-in-risk posture and the action it warrants (confirmed-compromised /
// leaked-creds ⇒ escalate; risky sign-in without MFA ⇒ restrict; no IdP coverage
// ⇒ unknown, never trusted). No network, no real identity data.
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";
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
import { checkLiveGateIsolated } from "./lib/live-gate.js";

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
// riskLevel "none" is REPORTED here deliberately: Entra zeroes the level on
// confirmedSafe, and since the 2026-08-20 tightening the terminal grant requires
// every axis positively clean — an omitted level is an unverified one.
const safe = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-safe", riskState: "confirmedSafe", riskLevel: "none", detections: [] }));
check("confirmed_safe with an affirmatively-clean level and observed-empty detections is trusted/none", safe.posture === "trusted" && safe.recommendedAction === "none");
const safeUnread = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-safe2", riskState: "confirmedSafe", riskLevel: "none" }));
check("confirmed_safe with the detection feed NEVER OBSERVED is monitor, not a grant — the terminal state does not bypass the feed floor",
  safeUnread.recommendedAction === "monitor" && safeUnread.reasonCode === "RISK_FEED_UNOBSERVED");
const safeContradicted = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-safe3", riskState: "confirmedSafe", riskLevel: "high", detections: [] }));
check("confirmed_safe CONTRADICTED by a residual high level resolves to the worse reading — restrict, never trusted",
  safeContradicted.recommendedAction === "restrict" && safeContradicted.reasonCode === "HIGH_RISK_SIGNIN");
const levelUnparseable = evaluateIdentityRisk(normalizePrincipal({ principalId: "p-lvl", riskState: "none", riskLevel: "ultraviolet", detections: [] }));
check("an unparseable riskLevel is a blind spot: monitor / RISK_LEVEL_UNVERIFIED — the third field under the same law",
  levelUnparseable.recommendedAction === "monitor" && levelUnparseable.reasonCode === "RISK_LEVEL_UNVERIFIED");

// ── riskState "none" vs "unknown": a reading vs a blind spot ──────────────────
//
// THE DEFECT THIS REPLACES. normalizeRiskState had no arm for the vendor value
// "none" — Entra's value for a clean principal, the most common value in a
// healthy tenant — so it fell to the default and became "unknown". And the
// evaluator graded unknown-state/unknown-level/no-detections as trusted/NO_RISK/
// none. Two failures fused: every clean principal earned trust via a PARSE
// FALL-THROUGH rather than a reading, and a vendor renaming one enum value would
// silently convert parse failure into trust. Executed counterexample 2026-08-20.
check("vendor 'none' normalizes to riskState 'none' — a reading, not a blind spot",
  normalizePrincipal({ principalId: "p-n", riskState: "none", detections: [] }).riskState === "none");
check("an unmapped vendor state still normalizes to 'unknown'",
  normalizePrincipal({ principalId: "p-x", riskState: "riskFreeUltra2000", detections: [] }).riskState === "unknown");

const stateUnknown = evaluateIdentityRisk(
  normalizePrincipal({ principalId: "p-blind", detections: [] }), { covered: true });
check("riskState 'unknown' is a blind spot: monitor / RISK_STATE_UNVERIFIED — the case that used to grade trusted",
  stateUnknown.posture === "unknown" && stateUnknown.recommendedAction === "monitor" &&
  stateUnknown.reasonCode === "RISK_STATE_UNVERIFIED");

const stateNone = evaluateIdentityRisk(
  normalizePrincipal({ principalId: "p-clean", riskState: "none", riskLevel: "none", mfaSatisfied: true, detections: [] }), { covered: true });
check("NON-VACUITY: an affirmatively clean principal still earns trusted/none — the grant exists, it is just earned now",
  stateNone.posture === "trusted" && stateNone.recommendedAction === "none" && stateNone.reasonCode === "NO_RISK");

const unknownPlusDetection = evaluateIdentityRisk(
  normalizePrincipal({ principalId: "p-blind-det", detections: [ { detectionType: "impossibleTravel", riskLevel: "high" } ] }), { covered: true });
check("a real detection still OUTRANKS the unknown-state floor — strongest wins is preserved",
  unknownPlusDetection.recommendedAction !== "monitor" && unknownPlusDetection.recommendedAction !== "none");

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


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "identity-risk",
  resolve: (env) => resolveIdentityRiskConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    IDENTITY_RISK_ACCESS_TOKEN: "t",
  },
});

// ── GRANT SAFETY, QUANTIFIED — the whole input lattice, 840 combinations ──────
//
// Owner-sequenced shift 1: a grant must be unreachable by any unknown, missing,
// stale, or contradictory input. THREE executed counterexamples predate this
// block (2026-08-20): remediated + detections:null graded trusted (the terminal
// state bypassed the unobserved-feed floor); confirmed_safe + level high graded
// trusted (a contradiction resolving to the friendlier reading); state none +
// level unparseable graded trusted (parse failure as a clean bill). The
// enumeration pins the granting set by predicate so the next wedge of this
// class fails the proof instead of shipping.
{
  const MED_DET = [{ detectionType: "unfamiliarFeatures", riskLevel: "medium" }];
  const COMP_DET = [{ detectionType: "leakedCredentials", riskLevel: "high" }];
  const domains: Record<string, readonly unknown[]> = {
    riskState: ["none", "atRisk", "confirmedCompromised", "remediated", "dismissed", "confirmedSafe", "someFutureState"],
    riskLevel: ["none", "low", "medium", "high", "someFutureLevel"],
    detections: [null, [], MED_DET, COMP_DET],
    mfaSatisfied: [true, false, null],
    covered: [true, false],
  };
  const evalCombo = (c: Record<string, unknown>) =>
    evaluateIdentityRisk(
      normalizePrincipal({
        principalId: "p-enum",
        riskState: c.riskState,
        riskLevel: c.riskLevel,
        detections: c.detections,
        mfaSatisfied: c.mfaSatisfied,
        source: "entra",
      } as never),
      { covered: c.covered as boolean },
    );
  const grid = enumerateGrantSafety({
    domains,
    build: (c) => c,
    evaluate: evalCombo,
    actionOf: (v) => v.recommendedAction,
    // The ONLY granting states: covered, the feed observed and empty, the level
    // affirmatively "none", and a state the IdP or an admin affirmatively
    // cleared. mfaSatisfied is deliberately unconstrained: it is an AGGRAVATOR
    // for risky sign-ins by design (session assurance belongs to sso-session),
    // and absence of MFA on a no-risk principal is not a risk signal here.
    positivelyClean: (c) =>
      c.covered === true &&
      Array.isArray(c.detections) && (c.detections as unknown[]).length === 0 &&
      c.riskLevel === "none" &&
      ["none", "remediated", "dismissed", "confirmedSafe"].includes(c.riskState as string),
    confirmedWhenNone: (v) => v.reasonCode === "NO_RISK" && v.posture === "trusted",
  });
  check(`ENUMERATION: all ${grid.combos} combinations swept (7 states x 5 levels x 4 feeds x 3 mfa x covered/not)`,
    grid.combos === productOf(domains) && grid.combos === 840);
  check("ENUMERATION: zero mismatches — no unknown/missing/contradictory input reaches a grant",
    grid.mismatches === 0);
  check("ENUMERATION: the granting set is exactly 4 states x 3 mfa values = 12 (non-vacuous)",
    grid.noneCount === 12);

  // NEGATIVE CONTROL — declare the never-observed feed clean; the harness must
  // object, because the evaluator (correctly) refuses to grant it.
  const wrong = enumerateGrantSafety({
    domains,
    build: (c) => c,
    evaluate: evalCombo,
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.covered === true &&
      (c.detections === null || (Array.isArray(c.detections) && (c.detections as unknown[]).length === 0)) &&
      c.riskLevel === "none" &&
      ["none", "remediated", "dismissed", "confirmedSafe"].includes(c.riskState as string),
  });
  check("NEGATIVE CONTROL: declaring the never-observed feed clean is CAUGHT (mismatches > 0)",
    wrong.mismatches > 0 && typeof wrong.firstMismatch === "string");
}

console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
