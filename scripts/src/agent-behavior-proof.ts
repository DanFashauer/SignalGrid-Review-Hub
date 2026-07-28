// Proof: @workspace/integrations/agent-behavior — the action-JUDGMENT dimension.
//
// The market is solving agent ACCESS (who the agent is, what it can reach). This is
// the layer that questions the ACTION: a fully-credentialed agent can still do
// something no human would — a one-line prompt that becomes 40,000 updates, an
// identity reaching into an app it has never opened, an action with no authorizing
// process behind it, one write fanning across a whole tenant, a superhuman cadence.
//
// The proof's spine is a full brute-force of the evaluator's normalized input space
// (enumerateGrantSafety): 1,944 combinations, and EXACTLY the one positively-in-pattern
// + reachable + clean combination may grant. Everything else — every anomaly, every
// unknown, every malformed report — must NOT. The targeted checks below name the
// individual ladder rungs; the enumeration guarantees there is no unnamed hole.

import {
  evaluateAgentBehavior,
  guardReadOnly,
  normalizeReport,
  createMockAgentBehaviorTransport,
  AgentBehaviorConnector,
  AgentBehaviorConnectorError,
  resolveAgentBehaviorConnector,
  type NormalizedAgentBehavior,
  type BlastRadius,
  type Cadence,
  type Provenance,
  type TargetFamiliarity,
  type VolumeState,
} from "@workspace/integrations/agent-behavior";
import { composeDeviceRisk, fromAgentBehavior } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) passed += 1;
  else failures.push(name);
}

/** Build a normalized behavior directly (bypassing the wire normalizer) to test the
 *  EVALUATOR over a known posture. */
function norm(p: Partial<NormalizedAgentBehavior>): NormalizedAgentBehavior {
  return {
    sourceSystem: "agent-behavior",
    deviceId: "dev-1",
    volumeState: "within_expected",
    targetFamiliarity: "familiar",
    provenance: "authorized",
    blastRadius: "scoped",
    cadence: "human_plausible",
    bridgeReachable: true,
    reportIntegrity: "clean",
    source: "test",
    ...p,
  };
}

// ── The single grant + the ladder ──────────────────────────────────────────────
const inPattern = evaluateAgentBehavior(norm({}));
check("a fully in-pattern + reachable + clean action → in_pattern/none, actionJudgedSafe", inPattern.posture === "in_pattern" && inPattern.recommendedAction === "none" && inPattern.actionJudgedSafe === true);
check("an in-pattern action composes to the healthy 'ok' tier", composeDeviceRisk([fromAgentBehavior(inPattern)]).riskTier === "ok");

const burst = evaluateAgentBehavior(norm({ volumeState: "burst" }));
check("a BURST volume (prompt→40k updates) → volume_burst/escalate", burst.posture === "volume_burst" && burst.recommendedAction === "escalate" && burst.criticalFindings.includes("volume_burst"));
check("a burst never grants and never judged safe", burst.actionJudgedSafe === false);

const noProv = evaluateAgentBehavior(norm({ provenance: "absent" }));
check("no authorizing provenance → no_provenance/restrict", noProv.posture === "no_provenance" && noProv.recommendedAction === "restrict" && noProv.criticalFindings.includes("no_provenance"));

const broad = evaluateAgentBehavior(norm({ blastRadius: "broad" }));
check("a broad blast radius → broad_blast/restrict", broad.posture === "broad_blast" && broad.recommendedAction === "restrict" && broad.criticalFindings.includes("broad_blast"));

const elevated = evaluateAgentBehavior(norm({ volumeState: "elevated" }));
check("an elevated volume → volume_elevated/step_up", elevated.posture === "volume_elevated" && elevated.recommendedAction === "step_up");

const firstSeen = evaluateAgentBehavior(norm({ targetFamiliarity: "first_seen" }));
check("a first-seen target (never opened this app) → unfamiliar_target/step_up", firstSeen.posture === "unfamiliar_target" && firstSeen.recommendedAction === "step_up");

const superhuman = evaluateAgentBehavior(norm({ cadence: "superhuman" }));
check("a superhuman cadence → superhuman_cadence/step_up", superhuman.posture === "superhuman_cadence" && superhuman.recommendedAction === "step_up");

// ── worst-concern-wins ─────────────────────────────────────────────────────────
const burstAndFirstSeen = evaluateAgentBehavior(norm({ volumeState: "burst", targetFamiliarity: "first_seen" }));
check("burst + first-seen → escalate wins over step_up (worst-concern-wins)", burstAndFirstSeen.recommendedAction === "escalate");
const noProvAndBroad = evaluateAgentBehavior(norm({ provenance: "absent", blastRadius: "broad" }));
check("no-provenance + broad-blast both restrict → restrict, both findings recorded", noProvAndBroad.recommendedAction === "restrict" && noProvAndBroad.criticalFindings.length === 2);

// ── fail-closed on unknown / unreachable / malformed ───────────────────────────
for (const field of ["volumeState", "targetFamiliarity", "provenance", "blastRadius", "cadence"] as const) {
  const v = evaluateAgentBehavior(norm({ [field]: "unknown" } as Partial<NormalizedAgentBehavior>));
  check(`unknown ${field} → step_up, never a grant`, v.recommendedAction === "step_up" && v.actionJudgedSafe === false);
}
const unreachable = evaluateAgentBehavior(norm({ bridgeReachable: false }));
check("an unreachable bridge never grants — the read may be stale", unreachable.recommendedAction === "step_up" && unreachable.actionJudgedSafe === false);
const unreachableNull = evaluateAgentBehavior(norm({ bridgeReachable: null }));
check("unreported reachability (null) also never grants", unreachableNull.recommendedAction === "step_up");
const malformed = evaluateAgentBehavior(norm({ reportIntegrity: "malformed" }));
check("a malformed report never grants even if every field looks in-pattern", malformed.recommendedAction === "step_up" && malformed.actionJudgedSafe === false);
const notCovered = evaluateAgentBehavior(norm({}), { covered: false });
check("no behavioral result for the action (covered=false) → unknown/step_up", notCovered.posture === "unknown" && notCovered.recommendedAction === "step_up");

// ── normalizer fail-closed (the wire is hostile) ───────────────────────────────
check("an empty report normalizes every signal to unknown (nothing fabricated)", (() => {
  const n = normalizeReport("dev-x", {});
  return n.volumeState === "unknown" && n.provenance === "unknown" && n.bridgeReachable === null && n.reportIntegrity === "clean";
})());
check("a garbage enum value is unknown AND marks the report malformed", (() => {
  const n = normalizeReport("dev-x", { volumeState: "ERR: timeout" });
  return n.volumeState === "unknown" && n.reportIntegrity === "malformed";
})());
check("an unrecognized key marks the report malformed (assertion in a spelling we ignore)", normalizeReport("dev-x", { somethingElse: "burst" } as never).reportIntegrity === "malformed");
check("a non-boolean bridgeReachable is null AND malformed", (() => {
  const n = normalizeReport("dev-x", { bridgeReachable: "true" });
  return n.bridgeReachable === null && n.reportIntegrity === "malformed";
})());
check("an inherited (prototype) value is NOT read as a confirmation", (() => {
  const hostile = Object.create({ volumeState: "within_expected", provenance: "authorized", bridgeReachable: true });
  const n = normalizeReport("dev-x", hostile);
  // own-only read → every field falls to unknown; the inherited keys also mark malformed
  return n.volumeState === "unknown" && n.provenance === "unknown" && n.reportIntegrity === "malformed";
})());
check("a normalized-clean, fully in-pattern wire report DOES grant (the path is reachable)", (() => {
  const n = normalizeReport("dev-x", { volumeState: "within_expected", targetFamiliarity: "familiar", provenance: "authorized", blastRadius: "scoped", cadence: "human_plausible", bridgeReachable: true });
  return evaluateAgentBehavior(n).recommendedAction === "none";
})());

// ── the brute-force allow-path enumeration (the spine) ─────────────────────────
const domains = {
  volumeState: ["within_expected", "elevated", "burst", "unknown"] as VolumeState[],
  targetFamiliarity: ["familiar", "first_seen", "unknown"] as TargetFamiliarity[],
  provenance: ["authorized", "absent", "unknown"] as Provenance[],
  blastRadius: ["scoped", "broad", "unknown"] as BlastRadius[],
  cadence: ["human_plausible", "superhuman", "unknown"] as Cadence[],
  bridgeReachable: [true, false, null],
  reportIntegrity: ["clean", "malformed"],
};
const combosExpected = productOf(domains);
const enumResult = enumerateGrantSafety({
  domains,
  build: (c) => norm({
    volumeState: c.volumeState as VolumeState,
    targetFamiliarity: c.targetFamiliarity as TargetFamiliarity,
    provenance: c.provenance as Provenance,
    blastRadius: c.blastRadius as BlastRadius,
    cadence: c.cadence as Cadence,
    bridgeReachable: c.bridgeReachable as boolean | null,
    reportIntegrity: c.reportIntegrity as "clean" | "malformed",
  }),
  evaluate: (n) => evaluateAgentBehavior(n),
  actionOf: (v) => v.recommendedAction,
  positivelyClean: (c) =>
    c.volumeState === "within_expected" &&
    c.targetFamiliarity === "familiar" &&
    c.provenance === "authorized" &&
    c.blastRadius === "scoped" &&
    c.cadence === "human_plausible" &&
    c.bridgeReachable === true &&
    c.reportIntegrity === "clean",
  confirmedWhenNone: (v) => v.actionJudgedSafe === true,
});
check("enumeration covered the full input product (no domain silently shrank)", enumResult.combos === combosExpected);
check("across the ENTIRE input space, exactly ONE combination grants", enumResult.noneCount === 1);
check("no grant disagreed with the positively-clean predicate, and every grant was judged-safe", enumResult.mismatches === 0);

// ── connector: read-only, gated, honest failures ───────────────────────────────
const TOKEN = "sgk_demo_behavior";
const transport = createMockAgentBehaviorTransport({
  expectedToken: TOKEN,
  reports: { "dev-ok": { volumeState: "within_expected", targetFamiliarity: "familiar", provenance: "authorized", blastRadius: "scoped", cadence: "human_plausible", bridgeReachable: true } },
});
const connector = new AgentBehaviorConnector({ accessToken: TOKEN, baseUrl: "https://bridge.local" }, transport);
const okNorm = await connector.fetchNormalized("dev-ok");
check("connector fetch normalizes a clean report", okNorm.reportIntegrity === "clean" && evaluateAgentBehavior(okNorm).recommendedAction === "none");
let authErr: AgentBehaviorConnectorError | null = null;
const badConn = new AgentBehaviorConnector({ accessToken: "wrong", baseUrl: "https://bridge.local" }, transport);
try { await badConn.fetchNormalized("dev-ok"); } catch (e) { authErr = e instanceof AgentBehaviorConnectorError ? e : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");
let missErr: AgentBehaviorConnectorError | null = null;
try { await connector.fetchNormalized("no-such"); } catch (e) { missErr = e instanceof AgentBehaviorConnectorError ? e : null; }
check("an unknown device surfaces upstream_error, never an invented in-pattern action", missErr?.code === "upstream_error");
check("dev tier resolves to fixture mode", resolveAgentBehaviorConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveAgentBehaviorConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveAgentBehaviorConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveAgentBehaviorConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", AGENT_BEHAVIOR_ACCESS_TOKEN: "t" }).mode === "live");

// ── connector surface (mutation-guard coverage: every guard falsifiable) ────────
let abReadOnly = false;
try { guardReadOnly("POST"); } catch (err) { abReadOnly = err instanceof AgentBehaviorConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", abReadOnly);
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", Object.prototype as never).reportIntegrity === "malformed");
let abDeepProto: object = {};
for (let i = 0; i < 100; i += 1) abDeepProto = Object.create(abDeepProto);
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", Object.create(abDeepProto) as never).reportIntegrity === "malformed");

// ── report ─────────────────────────────────────────────────────────────────────
console.log(`figures=combos=${combosExpected},grantingCombos=${enumResult.noneCount},signals=5,ladderRungs=5`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
