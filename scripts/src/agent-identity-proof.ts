// Agentic / non-human-identity (NHI) proof — fully OFFLINE and deterministic.
//
// Drives the read-only agent-identity connector against captured governance reports
// and runs the pure evaluator per actor. Every other identity dimension assumes a
// PERSON is acting; this one asks who is actually acting, and — when it is an AI
// agent or a service account — whether that identity is governed. An unregistered
// agent, an expired approval, or a standing never-expiring credential is the
// non-human equivalent of a leaver still holding a key: escalate. An over-scoped,
// unscoped, unrecorded, or never-approved agent is contained. Only a confirmed human,
// or a fully-governed non-human identity, contributes 'none'. No network.
//
// It also proves the fabric fuses this dimension: fromAgentIdentity → an
// agent_identity ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentIdentityConnector,
  AgentIdentityConnectorError,
  createMockAgentIdentityTransport,
  evaluateAgentIdentity,
  guardReadOnly,
  normalizeReport,
  resolveAgentIdentityConnector,
  type AgentIdentityReportRaw,
  type NormalizedAgentIdentity,
} from "@workspace/integrations/agent-identity";
import { composeDeviceRisk, fromAgentIdentity } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  actorGoverned: boolean;
  nonHumanActor: boolean;
}
interface Fixture {
  accessToken: string;
  actors: Record<string, { deviceId: string; report: AgentIdentityReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/agent-identity/actors.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://agent-identity-bridge.local/agent-identity";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Agentic / non-human-identity (NHI) proof");
const names = Object.keys(fixture.actors);
console.log(`actors=${names.length}`);

const reports: Record<string, AgentIdentityReportRaw> = {};
for (const n of names) reports[fixture.actors[n].deviceId] = fixture.actors[n].report;
const transport = createMockAgentIdentityTransport({ reports, expectedToken: fixture.accessToken });
const connector = new AgentIdentityConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.actors[name];
  const normalized = await connector.fetchActor(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "agent-identity");
  const v = evaluateAgentIdentity(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.actorGoverned === spec.expected.actorGoverned &&
    v.nonHumanActor === spec.expected.nonHumanActor &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── NHI governance invariants ───────────────────────────────────────────────────

// The two legitimate grants: a confirmed human, and a fully-governed non-human.
const human = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-actor"].deviceId));
check("a confirmed human actor → human_actor/none, governed, NOT flagged non-human", human.posture === "human_actor" && human.recommendedAction === "none" && human.actorGoverned === true && human.nonHumanActor === false);
const governed = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["governed-agent"].deviceId));
check("a registered + short-lived + least-privilege + approved + recorded agent → governed_agent/none", governed.posture === "governed_agent" && governed.recommendedAction === "none" && governed.actorGoverned === true && governed.nonHumanActor === true);
check("a governed agent composes to the 'ok' tier", composeDeviceRisk([fromAgentIdentity(governed)]).riskTier === "ok");

// A human is NOT judged on the agent-governance fields — they do not apply to a
// person. This mirrors access-governance treating session monitoring as moot for a
// non-elevated principal, and is why the grant predicate has two distinct branches.
const humanMoot = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-agent-fields-moot"].deviceId));
check("a human actor is not penalized by agent-only fields (they do not apply)", humanMoot.posture === "human_actor" && humanMoot.recommendedAction === "none");

// The strongest negatives: an identity that should not be acting at all.
const unregistered = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["unregistered-agent"].deviceId));
check("an UNREGISTERED agent (a shadow agent) → escalate + critical", unregistered.recommendedAction === "escalate" && unregistered.criticalFindings.includes("unregistered_agent"));
check("an unregistered agent composes to the 'blocked' tier, NEVER 'ok'", composeDeviceRisk([fromAgentIdentity(unregistered)]).riskTier === "blocked");
const expired = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["approval-expired"].deviceId));
check("an EXPIRED approval with access still live → escalate (the NHI 'leaver')", expired.recommendedAction === "escalate" && expired.criticalFindings.includes("approval_expired"));
const standing = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["standing-credential"].deviceId));
check("a STANDING never-expiring credential → escalate + critical", standing.recommendedAction === "escalate" && standing.criticalFindings.includes("standing_credential"));

// Containment: ungoverned or unauditable agents.
const unrecorded = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["unrecorded-agent"].deviceId));
check("an UNRECORDED agent (no audit trail) → restrict + critical", unrecorded.recommendedAction === "restrict" && unrecorded.criticalFindings.includes("agent_unrecorded"));
const unscoped = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["unscoped-agent"].deviceId));
check("an UNSCOPED agent → restrict + critical", unscoped.recommendedAction === "restrict" && unscoped.criticalFindings.includes("agent_unscoped"));

// No governance result → gap → step_up (never a governed grant).
const noCov = evaluateAgentIdentity(normalizeReport("ghost", {} as AgentIdentityReportRaw), { covered: false });
check("an uncovered actor is 'unknown'/step_up, never governed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.actorGoverned === false);
check("an uncovered actor composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromAgentIdentity(noCov)]).riskTier !== "ok");

// We cannot tell WHO is acting — the whole question this dimension answers.
const unknownActor = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["actor-type-unknown"].deviceId));
check("an unreadable actorType → step_up, never governed", unknownActor.reasonCode === "AGENT_STATE_UNKNOWN" && unknownActor.recommendedAction === "step_up" && unknownActor.actorGoverned === false);

// A self-contradictory report — a HUMAN actor carrying agent-registry state — is
// forced to an unreadable actorType by the normalizer and can never take the human
// fast-path (where the agent-governance fields are deliberately not evaluated).
const contradiction = await connector.fetchActor(fixture.actors["human-with-registry-contradiction"].deviceId);
check("a 'human' actor with agent-registry state normalizes actorType to unknown", contradiction.actorType === "unknown");
check("a contradictory human/agent-registry report → step_up, NEVER the human grant", evaluateAgentIdentity(contradiction).recommendedAction === "step_up");

// The grant demands POSITIVE verification of liveness — for humans too.
const noReach = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["reachability-unreported"].deviceId));
check("even a HUMAN actor with UNREPORTED bridge reachability → step_up, never granted", noReach.reasonCode === "BRIDGE_UNREACHABLE" && noReach.recommendedAction === "step_up" && noReach.actorGoverned === false);
check("only an explicit bridgeReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromAgentIdentity(noReach)]).riskTier !== "ok");

// Exhaustive: brute-force the ENTIRE normalized input space (not fixture-bound), so
// the proof genuinely CONSTRAINS the allow path. Action "none" is emitted for EXACTLY
// two states — a confirmed HUMAN actor, or a fully-governed non-human identity — and
// for nothing else. Any unknown/missing value on a decisive field falls out.
const domains = {
  actorType: ["human", "agent", "service_account", "unknown"],
  agentRegistered: [true, false, null],
  tokenLifetime: ["short_lived", "long_lived", "standing", "unknown"],
  scopeState: ["least_privilege", "over_scoped", "unscoped", "unknown"],
  approvalState: ["approved", "pending", "none", "expired", "unknown"],
  recordingState: ["recorded", "unrecorded", "unknown"],
  bridgeReachable: [true, false, null],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) =>
    ({ sourceSystem: "agent-identity", deviceId: "enum", source: "enum", ...c }) as NormalizedAgentIdentity,
  evaluate: evaluateAgentIdentity,
  actionOf: (v) => v.recommendedAction,
  // Every grant is EITHER a human actor OR a governed non-human — no other posture
  // may contribute 'none', and both must be marked actorGoverned.
  confirmedWhenNone: (v) =>
    v.actorGoverned === true &&
    ((v.posture === "human_actor" && v.nonHumanActor === false) ||
      (v.posture === "governed_agent" && v.nonHumanActor === true)),
  positivelyClean: (c) => {
    const { actorType, agentRegistered, tokenLifetime, scopeState, approvalState, recordingState, bridgeReachable } = c;
    if (bridgeReachable !== true) return false;
    // A human is not judged on the agent-governance fields — they do not apply.
    if (actorType === "human") return true;
    if (actorType !== "agent" && actorType !== "service_account") return false;
    return (
      agentRegistered === true &&
      tokenLifetime === "short_lived" &&
      scopeState === "least_privilege" &&
      approvalState === "approved" &&
      recordingState === "recorded"
    );
  },
});
check(
  `exhaustive: over all ${enumRes.combos} input combinations, action 'none' is emitted for EXACTLY a confirmed human or a fully-governed non-human identity (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 8640,
);
check("exhaustive: some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// Unknown ≠ governed: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { actorType: "robot", tokenLifetime: "forever", approvalState: "maybe" } as AgentIdentityReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated human/approved)", norm.actorType === "unknown" && norm.tokenLifetime === "unknown" && norm.approvalState === "unknown");
const boolNorm = normalizeReport("b", { agentRegistered: "yes", bridgeReachable: 1 } as unknown as AgentIdentityReportRaw);
check("a non-boolean agentRegistered / bridgeReachable is null, never fabricated", boolNorm.agentRegistered === null && boolNorm.bridgeReachable === null);

// Worst-concern-wins: the unregistered escalate outranks the restricts and step_ups.
const worst = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["worst-of-several"].deviceId));
check("worst-concern-wins: an unregistered agent (escalate) outranks the restricts", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 5);

// Determinism.
const d = await connector.fetchActor(fixture.actors["long-lived-credential"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateAgentIdentity(d)) === JSON.stringify(evaluateAgentIdentity(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromAgentIdentity(unregistered);
check("fromAgentIdentity emits an agent_identity signal", signal.kind === "agent_identity");
check("fabric fuses an unregistered agent into an escalate verdict", composeDeviceRisk([signal]).strongestAction === "escalate");
check("a confirmed human contributes 'none' to the fabric", fromAgentIdentity(human).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof AgentIdentityConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new AgentIdentityConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.actors["human-actor"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: AgentIdentityConnectorError | null = null;
try { await bad.fetchActor(fixture.actors["human-actor"].deviceId); } catch (err) { authErr = err instanceof AgentIdentityConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: AgentIdentityConnectorError | null = null;
try { await connector.fetchActor("no-such-device"); } catch (err) { missingErr = err instanceof AgentIdentityConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented governed actor", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveAgentIdentityConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveAgentIdentityConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveAgentIdentityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveAgentIdentityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", AGENT_IDENTITY_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
