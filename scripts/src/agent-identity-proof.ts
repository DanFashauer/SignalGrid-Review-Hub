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
  actorClassification: string;
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
    v.actorClassification === spec.expected.actorClassification &&
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

// ── the human branch, and the two ways its claim is voided ─────────────────────
//
// The human branch grants WITHOUT reading the governance fields, because they have no
// bearing on a person. Its safety therefore rests entirely on whether the "human"
// claim can be trusted. Two things void it — and one thing deliberately does NOT.
const humanSilent = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-actor-explicit-unknowns"].deviceId));
check("a human report that is explicitly 'unknown' on every governance field still grants", humanSilent.posture === "human_actor" && humanSilent.recommendedAction === "none");

// (a) DOES NOT void: the truthful human answers. A bridge emitting one uniform row
// shape per actor populates these columns for people too — `agentRegistered:false`
// (a person holds no NHI registry entry), `approvalState:"none"` (no agent-approval
// workflow governs a person), an unrecorded session, a long-lived or broadly-scoped
// human credential (owned by token-binding / access-governance). Punishing an honest
// bridge for answering accurately would make the dimension unusable in practice.
const humanUniform = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-uniform-schema-bridge"].deviceId));
check("a uniform-schema bridge answering truthfully for a PERSON still grants (honest reports are not punished)", humanUniform.posture === "human_actor" && humanUniform.recommendedAction === "none" && humanUniform.criticalFindings.length === 0);

// (b) VOIDS: governance state no person can hold — membership in the NHI registry, or
// an agent-approval workflow governing this actor.
const humanRegistry = await connector.fetchActor(fixture.actors["human-with-registry-contradiction"].deviceId);
check("a 'human' claimed to be IN the agent registry voids the actor label", humanRegistry.actorType === "unknown");
const humanApproval = await connector.fetchActor(fixture.actors["human-with-agent-approval-contradiction"].deviceId);
check("a 'human' carrying an agent-approval state voids the actor label", humanApproval.actorType === "unknown");
// The exact input that a registry-only guard let through: a "human" with a standing
// credential, no scope, a lapsed approval and no audit trail, agentRegistered OMITTED.
const humanClaimed = await connector.fetchActor(fixture.actors["human-claiming-agent-governance"].deviceId);
check("that claim is voided even with agentRegistered omitted (boolOrNull cannot launder it)", humanClaimed.actorType === "unknown");
const humanClaimedV = evaluateAgentIdentity(humanClaimed);
check("it escalates on its own governance facts instead of granting", humanClaimedV.recommendedAction === "escalate" && humanClaimedV.actorGoverned === false && humanClaimedV.criticalFindings.includes("approval_expired"));
check("but it is NOT reported as a confirmed non-human actor — we never classified it", humanClaimedV.nonHumanActor === false && humanClaimedV.actorClassification === "unclassified");

// (c) VOIDS: a report we could not parse. This is the channel a guard written against
// the NORMALIZED values cannot see — `oneOf` has already turned "lapsed" and
// ["standing"] into "unknown", and `boolOrNull` has turned "true" and 1 into null, so
// an assertion we failed to read becomes indistinguishable from silence. Presence, not
// parsed value, is what makes it an assertion.
const unparseable = await connector.fetchActor(fixture.actors["human-with-unparseable-governance"].deviceId);
check("vendor-variant spellings on every governance field mark the report malformed", unparseable.reportIntegrity === "malformed");
check("...and every one of them still normalizes to the lossy 'unknown' sentinel (which is exactly why integrity is tracked separately)", unparseable.tokenLifetime === "unknown" && unparseable.scopeState === "unknown" && unparseable.approvalState === "unknown" && unparseable.recordingState === "unknown" && unparseable.agentRegistered === null);
const unparseableV = evaluateAgentIdentity(unparseable);
check("a malformed 'human' report NEVER grants", unparseableV.recommendedAction === "step_up" && unparseableV.actorGoverned === false);
check("a malformed report never composes to the 'ok' tier", composeDeviceRisk([fromAgentIdentity(unparseableV)]).riskTier !== "ok");
const stringBool = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-with-stringified-boolean"].deviceId));
check("a string-quoted boolean (agentRegistered:'true') is an assertion, not silence", stringBool.reasonCode === "REPORT_MALFORMED" && stringBool.actorGoverned === false);
const aliased = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-with-aliased-keys"].deviceId));
check("snake_case key aliases are an unrecognized envelope, not silence", aliased.reasonCode === "REPORT_MALFORMED" && aliased.actorGoverned === false);
// Case and whitespace do not open a hole either: oneOf trims + lowercases first, so
// the guard sees the canonical value.
const shouty = normalizeReport("s", { actorType: " HUMAN ", approvalState: " EXPIRED " } as AgentIdentityReportRaw);
check("case/whitespace variants are canonicalized before the claim is judged", shouty.reportIntegrity === "clean" && shouty.actorType === "unknown");
// Defence in depth: the evaluator refuses a malformed report even if the normalizer
// somehow handed it a clean-looking human. The grant must not DEPEND on the voiding.
const forged = evaluateAgentIdentity({
  sourceSystem: "agent-identity", deviceId: "forged", source: "test", actorType: "human",
  agentRegistered: null, tokenLifetime: "unknown", scopeState: "unknown", approvalState: "unknown",
  recordingState: "unknown", bridgeReachable: true, reportIntegrity: "malformed",
});
check("the EVALUATOR independently refuses a malformed report, even a clean-looking human", forged.recommendedAction === "step_up" && forged.actorGoverned === false);

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
const overScoped = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["over-scoped-agent"].deviceId));
check("an OVER-SCOPED agent → restrict + critical", overScoped.recommendedAction === "restrict" && overScoped.criticalFindings.includes("agent_over_scoped"));
const neverApproved = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["never-approved"].deviceId));
check("a NEVER-APPROVED agent → restrict + critical", neverApproved.recommendedAction === "restrict" && neverApproved.criticalFindings.includes("approval_absent"));

// No governance result → gap → step_up (never a governed grant).
const noCov = evaluateAgentIdentity(normalizeReport("ghost", {} as AgentIdentityReportRaw), { covered: false });
check("an uncovered actor is 'unknown'/step_up, never governed", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.actorGoverned === false);
check("an uncovered actor composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromAgentIdentity(noCov)]).riskTier !== "ok");

// We cannot tell WHO is acting — the whole question this dimension answers.
const unknownActor = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["actor-type-reported-unknown"].deviceId));
check("an unreadable actorType → step_up, never governed", unknownActor.reasonCode === "AGENT_STATE_UNKNOWN" && unknownActor.recommendedAction === "step_up" && unknownActor.actorGoverned === false);

// An actor whose label the bridge itself reported as unreadable is still judged on the
// governance facts it DID assert — a shadow agent's standing credential is known-bad
// whether or not we could read the label. But it is never reported as a confirmed
// machine, which is why `actorClassification` exists alongside `nonHumanActor`.
const garbled = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["actor-type-garbled"].deviceId));
check("a garbled actorType is malformed, not merely unknown", garbled.reasonCode === "REPORT_MALFORMED" && garbled.actorClassification === "unclassified");
check("an agent-shaped posture on an unclassified actor is routable via actorClassification", humanClaimedV.posture === "ungoverned_agent" && humanClaimedV.nonHumanActor === false && humanClaimedV.actorClassification !== "human");

// The grant demands POSITIVE verification of liveness — for humans too.
const noReach = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["reachability-unreported"].deviceId));
check("even a HUMAN actor with UNREPORTED bridge reachability → step_up, never granted", noReach.reasonCode === "BRIDGE_UNREACHABLE" && noReach.recommendedAction === "step_up" && noReach.actorGoverned === false);
check("only an explicit bridgeReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromAgentIdentity(noReach)]).riskTier !== "ok");

// Exhaustive, in TWO passes over two DIFFERENT spaces.
//
// Pass 1 quantifies over the NORMALIZED space — every value the normalizer can emit,
// including `reportIntegrity` — against the evaluator alone. It proves the evaluator
// never grants on a value it should not, and that it refuses a malformed report
// independently of whether the normalizer voided the label.
const domains = {
  actorType: ["human", "agent", "service_account", "unknown"],
  agentRegistered: [true, false, null],
  tokenLifetime: ["short_lived", "long_lived", "standing", "unknown"],
  scopeState: ["least_privilege", "over_scoped", "unscoped", "unknown"],
  approvalState: ["approved", "pending", "none", "expired", "unknown"],
  recordingState: ["recorded", "unrecorded", "unknown"],
  bridgeReachable: [true, false, null],
  reportIntegrity: ["clean", "malformed"],
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
    ((v.posture === "human_actor" && v.nonHumanActor === false && v.actorClassification === "human") ||
      (v.posture === "governed_agent" && v.nonHumanActor === true && v.actorClassification === "non_human")),
  positivelyClean: (c) => {
    const { actorType, agentRegistered, tokenLifetime, scopeState, approvalState, recordingState, bridgeReachable, reportIntegrity } = c;
    if (reportIntegrity !== "clean") return false;
    if (bridgeReachable !== true) return false;
    // At the NORMALIZED layer a confirmed human is by design not judged on the
    // governance fields — they do not apply to a person. Note what this branch does
    // NOT prove: that a "human" label is trustworthy. That is the normalizer's job,
    // and pass 2 is where it is quantified over.
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
  `exhaustive (normalized): over all ${enumRes.combos} normalized states, action 'none' is emitted for EXACTLY a confirmed human or a fully-governed non-human identity, and never on a malformed report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 17280,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// Pass 2 quantifies over the RAW WIRE space — and unlike pass 1 it includes the
// MALFORMED values a real bridge emits, which is the whole point. The shared harness
// asks for "every malformed/unknown sentinel the field can hold"; for a raw report
// those are a junk enum spelling, a string-quoted boolean, a number, an array, an
// object, and an omitted key. A pass built only from well-formed values would make
// `normalizeReport` the identity function and prove nothing about the parse layer.
const rawDomains = {
  actorType: ["human", "agent", "service_account", "unknown", "garbled", 7],
  agentRegistered: [true, false, null, undefined, "true", 1],
  tokenLifetime: ["short_lived", "long_lived", "standing", "unknown", undefined, "forever"],
  scopeState: ["least_privilege", "over_scoped", "unscoped", "unknown", undefined, ["unscoped"]],
  approvalState: ["approved", "pending", "none", "expired", "unknown", undefined, "lapsed"],
  recordingState: ["recorded", "unrecorded", "unknown", undefined, {}],
  bridgeReachable: [true, false, null, undefined, "true", 1],
};

// The clean predicate is written as POSITIVE ALLOWLISTS of raw wire values — the
// contract a bridge must satisfy — not as the negation of the normalizer's guard.
// That independence is what lets it catch a guard that loses a condition: drop
// "pending" from the guard and this still says a human report asserting it is not
// clean. These are the raw values a report describing a PERSON may carry.
const HUMAN_TRUTHFUL_RAW: Record<string, readonly unknown[]> = {
  agentRegistered: [undefined, null, false], // a person holds no NHI registry entry
  approvalState: [undefined, "unknown", "none"], // no agent-approval workflow governs a person
  tokenLifetime: [undefined, "unknown", "short_lived", "long_lived", "standing"],
  scopeState: [undefined, "unknown", "least_privilege", "over_scoped", "unscoped"],
  recordingState: [undefined, "unknown", "recorded", "unrecorded"],
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => normalizeReport("enum", c as AgentIdentityReportRaw, "enum"),
  evaluate: evaluateAgentIdentity,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.actorGoverned === true &&
    ((v.posture === "human_actor" && v.nonHumanActor === false && v.actorClassification === "human") ||
      (v.posture === "governed_agent" && v.nonHumanActor === true && v.actorClassification === "non_human")),
  positivelyClean: (c) => {
    // Liveness must be an actual boolean true — "true" and 1 are not confirmations.
    if (c.bridgeReachable !== true) return false;
    if (c.actorType === "human") {
      return Object.keys(HUMAN_TRUTHFUL_RAW).every((k) => HUMAN_TRUTHFUL_RAW[k].includes(c[k]));
    }
    if (c.actorType !== "agent" && c.actorType !== "service_account") return false;
    return (
      c.agentRegistered === true &&
      c.tokenLifetime === "short_lived" &&
      c.scopeState === "least_privilege" &&
      c.approvalState === "approved" &&
      c.recordingState === "recorded"
    );
  },
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — including junk enum spellings, string-quoted booleans, numbers, arrays and objects on every field — normalizeReport + evaluate grant ONLY a trustworthy human claim or a fully-governed non-human identity (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 272160,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
// Malformed input is a real share of that space, so the malformed path is genuinely
// exercised rather than being a corner the domains happen to miss.
let malformedSeen = 0;
for (const v of rawDomains.tokenLifetime) if (v === "forever") malformedSeen += 1;
check("exhaustive (raw wire): the space actually contains unparseable values on every field", malformedSeen === 1 && rawDomains.agentRegistered.includes("true") && rawDomains.recordingState.some((v) => typeof v === "object" && v !== null && !Array.isArray(v)));

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
