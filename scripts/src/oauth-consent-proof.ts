// OAuth-consent / workload-identity proof — fully OFFLINE and deterministic.
//
// Drives the read-only OAuth-consent connector against captured consent-bridge
// reports and runs the pure evaluator per principal. The model: what third-party
// apps can do ON BEHALF OF the session's principal via a delegated OAuth grant is a
// session-relevant risk on a shared, badge-checked-out device. An illicit consent
// grant (consent-phishing) is the strongest negative; a full-access grant not
// admin-governed is contained; over-scoped / unverified-publisher / unmanaged-
// workload-secret raises the bar; only a positively-confirmed governed (or no-)
// grant, with the IdP confirmed reachable, contributes 'none'. No network.
//
// It also proves the fabric fuses this dimension: fromOAuthConsent → an oauth_consent
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OAuthConsentConnector,
  OAuthConsentConnectorError,
  createMockOAuthConsentTransport,
  evaluateOAuthConsent,
  guardReadOnly,
  normalizeReport,
  resolveOAuthConsentConnector,
  type OAuthConsentReportRaw,
} from "@workspace/integrations/oauth-consent";
import { composeDeviceRisk, fromOAuthConsent } from "@workspace/posture-composition";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  governanceConfirmed: boolean;
}
interface Fixture {
  accessToken: string;
  principals: Record<string, { principalId: string; report: OAuthConsentReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/oauth-consent/principals.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://oauth-consent-bridge.local/oauth-consent";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("OAuth-consent / workload-identity proof");
const names = Object.keys(fixture.principals);
console.log(`principals=${names.length}`);

const reports: Record<string, OAuthConsentReportRaw> = {};
for (const n of names) reports[fixture.principals[n].principalId] = fixture.principals[n].report;
const transport = createMockOAuthConsentTransport({ reports, expectedToken: fixture.accessToken });
const connector = new OAuthConsentConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.principals[name];
  const normalized = await connector.fetchConsent(spec.principalId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "oauth-consent");
  const v = evaluateOAuthConsent(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.governanceConfirmed === spec.expected.governanceConfirmed &&
    v.principalId === spec.principalId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── governance-model invariants ────────────────────────────────────────────────

// An illicit consent grant (user-consented, unverified publisher, broad/full scope
// — the consent-phishing signature) is the strongest negative.
const illicit = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["illicit-consent"].principalId));
check("an illicit consent grant → escalate + critical, never governed", illicit.posture === "illicit_grant" && illicit.recommendedAction === "escalate" && illicit.criticalFindings.includes("illicit_consent_grant"));
check("an illicit grant composes to the 'blocked' tier, NEVER 'ok'", composeDeviceRisk([fromOAuthConsent(illicit)]).riskTier === "blocked");

// A full-access grant not admin-governed is contained; an admin-consented one steps up.
const fullUser = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["full-access-user"].principalId));
check("a full-access grant not admin-governed → restrict + critical", fullUser.recommendedAction === "restrict" && fullUser.criticalFindings.includes("full_access_grant"));
const fullAdmin = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["full-access-admin"].principalId));
check("an admin-consented full-access grant → step_up (governed but broad)", fullAdmin.recommendedAction === "step_up" && fullAdmin.reasonCode === "FULL_ACCESS_ADMIN_CONSENTED");

// No consent record → gap → step_up (never governed).
const noCov = evaluateOAuthConsent(normalizeReport("ghost", {} as OAuthConsentReportRaw), { covered: false });
check("an uncovered principal is 'unknown'/step_up, never governed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.governanceConfirmed === false);
check("an uncovered principal composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromOAuthConsent(noCov)]).riskTier !== "ok");

// The grant demands POSITIVE verification: a clean state without idpReachable===true
// (unreachable OR unreported) must NOT grant.
const unreach = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["idp-unreachable"].principalId));
check("a clean state with the IdP unreachable → step_up, never governed", unreach.reasonCode === "IDP_UNREACHABLE" && unreach.recommendedAction === "step_up" && unreach.governanceConfirmed === false);
const noReach = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["reachability-unreported"].principalId));
check("no grants but reachability UNREPORTED → step_up (positive verification required)", noReach.reasonCode === "IDP_UNREACHABLE" && noReach.recommendedAction === "step_up" && noReach.governanceConfirmed === false);

// Exhaustive: brute-force the ENTIRE normalized input space (not fixture-bound), so
// the proof genuinely CONSTRAINS the grant path. The evaluator must emit action
// "none" for EXACTLY the positively-confirmed clean states — a known consent type
// (admin OR user) + verified publisher + least scope + managed/no workload with the
// IdP reachable, OR no grants with the IdP reachable — and for nothing else. Any
// unknown/missing value on ANY field must fall out of the grant.
const GRANTS = ["present", "none", "unknown"] as const;
const CONSENT = ["admin", "user", "unknown"] as const;
const PUB = ["verified", "unverified", "unknown"] as const;
const SCOPE = ["least", "broad", "full_access", "unknown"] as const;
const WL = ["managed", "unmanaged_secret", "none", "unknown"] as const;
const REACH = [true, false, null] as const;
const COUNT = [null, 0, 2] as const;
let combos = 0;
let noneCount = 0;
let mismatches = 0;
for (const grants of GRANTS)
  for (const consentType of CONSENT)
    for (const publisher of PUB)
      for (const scope of SCOPE)
        for (const workloadCredential of WL)
          for (const idpReachable of REACH)
            for (const riskyGrantCount of COUNT) {
              combos += 1;
              const v = evaluateOAuthConsent({
                sourceSystem: "oauth-consent",
                principalId: "enum",
                grants,
                consentType,
                publisher,
                scope,
                workloadCredential,
                idpReachable,
                riskyGrantCount,
                source: "enum",
              });
              const positiveCount = riskyGrantCount !== null && riskyGrantCount > 0;
              const expectedNone =
                !positiveCount &&
                idpReachable === true &&
                (grants === "none" ||
                  (grants === "present" &&
                    (consentType === "admin" || consentType === "user") &&
                    publisher === "verified" &&
                    scope === "least" &&
                    (workloadCredential === "managed" || workloadCredential === "none")));
              const isNone = v.recommendedAction === "none";
              if (isNone) noneCount += 1;
              if (isNone !== expectedNone) mismatches += 1;
              if (isNone && v.governanceConfirmed !== true) mismatches += 1;
            }
check(`exhaustive: over all ${combos} input combinations, action 'none' is emitted for EXACTLY the positively-confirmed clean states (mismatches=${mismatches})`, mismatches === 0 && combos === 3888);
check("exhaustive: some clean states DO grant (the enumeration is not vacuous)", noneCount > 0);

// Unknown ≠ governed: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { grants: "totally", consentType: "sorta", publisher: "vibes", scope: "wide", workloadCredential: "maybe" } as OAuthConsentReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated present/verified/admin)", norm.grants === "unknown" && norm.consentType === "unknown" && norm.publisher === "unknown" && norm.scope === "unknown" && norm.workloadCredential === "unknown");
const boolNorm = normalizeReport("b", { idpReachable: "yes", riskyGrantCount: "lots" } as unknown as OAuthConsentReportRaw);
check("a non-boolean idpReachable / non-number count is null, never fabricated", boolNorm.idpReachable === null && boolNorm.riskyGrantCount === null);

// Worst-concern-wins: illicit (escalate) outranks full-access + unverified + workload.
const worst = evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["worst-of-several"].principalId));
check("worst-concern-wins: illicit consent (escalate) outranks the restricts/step_ups", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 2);

// Determinism.
const d = await connector.fetchConsent(fixture.principals["unverified-publisher"].principalId);
check("evaluator is deterministic", JSON.stringify(evaluateOAuthConsent(d)) === JSON.stringify(evaluateOAuthConsent(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromOAuthConsent(illicit);
check("fromOAuthConsent emits an oauth_consent signal", signal.kind === "oauth_consent");
check("fabric fuses an illicit grant into an escalate verdict", composeDeviceRisk([signal]).strongestAction === "escalate");
const governed = fromOAuthConsent(evaluateOAuthConsent(await connector.fetchConsent(fixture.principals["governed-clean"].principalId)));
check("a governed principal contributes 'none' to the fabric", governed.action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof OAuthConsentConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new OAuthConsentConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.principals["governed-clean"].principalId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: OAuthConsentConnectorError | null = null;
try { await bad.fetchConsent(fixture.principals["governed-clean"].principalId); } catch (err) { authErr = err instanceof OAuthConsentConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: OAuthConsentConnectorError | null = null;
try { await connector.fetchConsent("no-such-principal"); } catch (err) { missingErr = err instanceof OAuthConsentConnectorError ? err : null; }
check("an unknown principal surfaces upstream_error, never an invented governed grant", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveOAuthConsentConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveOAuthConsentConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveOAuthConsentConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveOAuthConsentConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", OAUTH_CONSENT_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
