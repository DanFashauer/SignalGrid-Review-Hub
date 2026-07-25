// Agentic / non-human-identity (NHI) proof — fully OFFLINE and deterministic.
//
// Drives the read-only agent-identity connector against captured governance reports
// and runs the pure evaluator per actor. Every other identity dimension assumes a
// PERSON is acting; this one asks who is actually acting, and — when it is an AI
// agent or a service account — whether that identity is governed. An unregistered
// agent, an expired approval, or a standing never-expiring credential is the
// non-human equivalent of a leaver still holding a key: escalate. An over-scoped,
// unscoped, unrecorded, or never-approved agent is contained. Only a fully-governed
// non-human identity contributes 'none'; a confirmed human contributes 'monitor',
// because a label alone is not evidence. No network.
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

// THE allow path — one branch, not two. A fully-governed non-human identity is the only
// state that grants. A confirmed human is reported and monitored, not certified: this
// dimension cannot verify that a "human" label is a person, so it does not claim to.
// The label-only grant is what six consecutive reviews each found a route into.
const human = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-actor"].deviceId));
check("a confirmed human actor → human_actor/MONITOR, never a grant, never flagged non-human", human.posture === "human_actor" && human.recommendedAction === "monitor" && human.actorGoverned === false && human.nonHumanActor === false);
check("a human actor still composes to the healthy 'ok' tier — monitoring is not friction", composeDeviceRisk([fromAgentIdentity(human)]).riskTier === "ok");
const governed = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["governed-agent"].deviceId));
check("a registered + short-lived + least-privilege + approved + recorded agent → governed_agent/none", governed.posture === "governed_agent" && governed.recommendedAction === "none" && governed.actorGoverned === true && governed.nonHumanActor === true);
check("a governed agent composes to the 'ok' tier", composeDeviceRisk([fromAgentIdentity(governed)]).riskTier === "ok");

// ── the human branch, and the two ways its claim is voided ─────────────────────
//
// The claim-voiding logic is retained even though the human branch no longer grants:
// it is what routes a self-contradictory report into the agent branch, where the
// governance facts it asserted are actually judged. Without it such a report would be
// monitored rather than escalated.
const humanSilent = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-actor-explicit-unknowns"].deviceId));
check("a human report explicitly 'unknown' on every governance field is monitored, not granted", humanSilent.posture === "human_actor" && humanSilent.recommendedAction === "monitor");

// (a) DOES NOT void: the truthful human answers. A bridge emitting one uniform row
// shape per actor populates these columns for people too — `agentRegistered:false`
// (a person holds no NHI registry entry), `approvalState:"none"` (no agent-approval
// workflow governs a person), an unrecorded session, a broadly-scoped human privilege
// (which `access-governance` does model). Punishing an honest bridge for answering
// accurately would make the dimension unusable in practice.
const humanUniform = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-uniform-schema-bridge"].deviceId));
check("a uniform-schema bridge answering truthfully for a PERSON is not punished", humanUniform.posture === "human_actor" && humanUniform.recommendedAction === "monitor" && humanUniform.criticalFindings.length === 0);
// JSON null is the wire spelling of "no value", not an unreadable assertion. A bridge
// that emits a fixed row shape with nulls rather than omitting keys is being honest,
// and must behave identically to omission — otherwise the same defect returns in a
// different encoding.
const humanNulls = normalizeReport("n", { actorType: "human", agentRegistered: null, tokenLifetime: null, scopeState: null, approvalState: null, recordingState: null, bridgeReachable: true } as AgentIdentityReportRaw);
check("JSON null on every governance field behaves as ABSENT, not as malformed", humanNulls.reportIntegrity === "clean" && humanNulls.actorType === "human");
check("...and behaves exactly as omitting the keys would", evaluateAgentIdentity(humanNulls).recommendedAction === "monitor");

// (a-bis) BUT credential lifetime is NOT deferred, because nothing else models it.
// `token-binding` carries proof-of-possession (binding, key protection, attestation,
// audience) and no TTL field at all, and `access-governance`'s "standing" is a PAM
// elevation window, not credential expiry. A human with a never-expiring credential
// would otherwise be read and discarded by every dimension in the fabric.
const humanStanding = evaluateAgentIdentity(normalizeReport("h", { actorType: "human", tokenLifetime: "standing", bridgeReachable: true } as AgentIdentityReportRaw));
check("a HUMAN with a standing never-expiring credential escalates — no other dimension models TTL", humanStanding.recommendedAction === "escalate" && humanStanding.criticalFindings.includes("standing_credential"));
check("...and never composes to the 'ok' tier", composeDeviceRisk([fromAgentIdentity(humanStanding)]).riskTier !== "ok");
const humanLongLived = evaluateAgentIdentity(normalizeReport("h2", { actorType: "human", tokenLifetime: "long_lived", bridgeReachable: true } as AgentIdentityReportRaw));
check("a HUMAN with a long-lived credential steps up", humanLongLived.recommendedAction === "step_up" && humanLongLived.actorGoverned === false);

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
// The NORMALIZER voids the human claim on a malformed report, independently of the
// evaluator's own refusal. Both defences exist because neither is redundant: removing
// the evaluator's integrity refusal alone reopens grants on aliased-key reports, and
// this assertion is what keeps the normalizer's half honest — grant-ness alone cannot
// see it, so without this check the condition would be load-bearing and unproven.
check("the normalizer ALSO voids the human claim on a malformed report", unparseable.actorType === "unknown");
check("...and every one of them still normalizes to the lossy 'unknown' sentinel (which is exactly why integrity is tracked separately)", unparseable.tokenLifetime === "unknown" && unparseable.scopeState === "unknown" && unparseable.approvalState === "unknown" && unparseable.recordingState === "unknown" && unparseable.agentRegistered === null);
const unparseableV = evaluateAgentIdentity(unparseable);
check("a malformed 'human' report NEVER grants", unparseableV.recommendedAction === "step_up" && unparseableV.actorGoverned === false);
check("a malformed report never composes to the 'ok' tier", composeDeviceRisk([fromAgentIdentity(unparseableV)]).riskTier !== "ok");
const stringBool = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-with-stringified-boolean"].deviceId));
check("a string-quoted boolean (agentRegistered:'true') is an assertion, not silence", stringBool.reasonCode === "REPORT_MALFORMED" && stringBool.actorGoverned === false);
const aliased = evaluateAgentIdentity(await connector.fetchActor(fixture.actors["human-with-aliased-keys"].deviceId));
check("snake_case key aliases are an unrecognized envelope, not silence", aliased.reasonCode === "REPORT_MALFORMED" && aliased.actorGoverned === false);
// The key scan walks the PROTOTYPE CHAIN with Reflect.ownKeys. The shipped HTTP
// transport hands us a JSON.parse result where every key is own+enumerable+string, but
// the transport is injectable: an in-process adapter returning a class instance or a
// Proxy could otherwise hide a governance assertion where Object.keys cannot see it.
const nonEnumerable = { actorType: "human", bridgeReachable: true } as AgentIdentityReportRaw;
Object.defineProperty(nonEnumerable, "agent_registered", { value: true, enumerable: false });
check("a NON-ENUMERABLE unknown key is caught (Object.keys would miss it)", normalizeReport("ne", nonEnumerable).reportIntegrity === "malformed");
const symbolKeyed = { actorType: "human", bridgeReachable: true } as AgentIdentityReportRaw;
(symbolKeyed as Record<symbol, unknown>)[Symbol.for("agentRegistered")] = true;
check("a SYMBOL-keyed assertion is caught", normalizeReport("sym", symbolKeyed).reportIntegrity === "malformed");
// A plain JSON.parse result is unaffected — the common path stays clean.
check("a plain parsed-JSON report is NOT flagged by the prototype walk", normalizeReport("j", JSON.parse('{"actorType":"human","bridgeReachable":true}') as AgentIdentityReportRaw).reportIntegrity === "clean");
check("a JSON-delivered __proto__ key IS flagged (it is an own key after parse)", normalizeReport("pp", JSON.parse('{"actorType":"human","bridgeReachable":true,"__proto__":{"x":1}}') as AgentIdentityReportRaw).reportIntegrity === "malformed");
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

// Exhaustive, in THREE passes over two DIFFERENT spaces.
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
    v.posture === "governed_agent" &&
    v.nonHumanActor === true &&
    v.actorClassification === "non_human",
  positivelyClean: (c) => {
    const { actorType, agentRegistered, tokenLifetime, scopeState, approvalState, recordingState, bridgeReachable, reportIntegrity } = c;
    if (reportIntegrity !== "clean") return false;
    if (bridgeReachable !== true) return false;
    // ONE branch grants. A confirmed human seeds `monitor`, never `none`, so the actor
    // label alone can no longer produce a grant — which is what six consecutive reviews
    // kept finding a way through.
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
  `exhaustive (normalized): over all ${enumRes.combos} normalized states, action 'none' is emitted for EXACTLY a fully-governed non-human identity — never on an actor label alone, never on a malformed report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 17280,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// Pass 2 quantifies over the RAW WIRE space — and unlike pass 1 it includes the
// MALFORMED values a real bridge emits, which is the whole point. The shared harness
// asks for "every malformed/unknown sentinel the field can hold"; for a raw report
// those are a junk enum spelling, a string-quoted boolean, a number, an array, an
// object, and an omitted key. A pass built only from well-formed values would make
// `normalizeReport` the identity function and prove nothing about the parse layer.
// `null` appears on the enum fields too: it is the standard wire spelling of "no
// value" (the raw type documents every field as able to degrade to it), and a bridge
// emitting a fixed row shape with nulls rather than omitting keys is being honest. It
// must behave as absence, not as an unreadable assertion — otherwise the honest-bridge
// defect just reappears in a different encoding.
//
// `__alias` is a build-time toggle, not a wire field: when set it adds a snake_case
// governance key to the raw report. Without it the unrecognized-key branch of the
// integrity check is structurally unreachable by this enumeration — it would be
// load-bearing and unproven, resting on two hand-written fixtures.
const rawDomains = {
  actorType: ["human", "agent", "service_account", "unknown", "garbled", null],
  agentRegistered: [true, false, null, undefined, "true", 1],
  tokenLifetime: ["short_lived", "long_lived", "standing", "unknown", undefined, "forever", null],
  scopeState: ["least_privilege", "over_scoped", "unscoped", "unknown", undefined, ["unscoped"]],
  approvalState: ["approved", "pending", "none", "expired", "unknown", undefined, "lapsed", null],
  recordingState: ["recorded", "unrecorded", "unknown", undefined, {}, null],
  bridgeReachable: [true, false, null, undefined, "true", 1],
  __alias: ["absent", "present"],
};

// The clean predicate is written as a POSITIVE ALLOWLIST of raw wire values — the
// contract a bridge must satisfy — not as the negation of the normalizer's guards.
// That independence is what lets it catch a guard that silently loses a condition.
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as AgentIdentityReportRaw;
    if (__alias === "present") raw.agent_registered = true;
    return normalizeReport("enum", raw, "enum");
  },
  evaluate: evaluateAgentIdentity,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.actorGoverned === true &&
    v.posture === "governed_agent" &&
    v.nonHumanActor === true &&
    v.actorClassification === "non_human",
  positivelyClean: (c) => {
    // A key we do not understand means the envelope was not understood.
    if (c.__alias === "present") return false;
    // Liveness must be an actual boolean true — "true" and 1 are not confirmations.
    if (c.bridgeReachable !== true) return false;
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
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — including junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects and an aliased extra key — normalizeReport + evaluate grant ONLY a fully-governed non-human identity (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 870912,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
// Malformed input is a real share of that space, so the malformed path is genuinely
// exercised rather than being a corner the domains happen to miss.
let malformedSeen = 0;
for (const v of rawDomains.tokenLifetime) if (v === "forever") malformedSeen += 1;
check("exhaustive (raw wire): the space actually contains unparseable values on every field", malformedSeen === 1 && rawDomains.agentRegistered.includes("true") && rawDomains.recordingState.some((v) => typeof v === "object" && v !== null && !Array.isArray(v)));

// Pass 3 — PARSE FIDELITY, over the same raw space.
//
// Passes 1 and 2 only observe grant-ness, and most malformed values already normalize
// to a denying sentinel — so an individual integrity condition can be deleted without
// either pass noticing. Mutation testing confirmed three conditions were invisible that
// way, including the `malformed ||` term the previous commit existed to add. This pass
// asserts the integrity flag directly, against an independent allowlist of wire values.
const PARSEABLE_RAW: Record<string, readonly unknown[]> = {
  actorType: [undefined, null, "human", "agent", "service_account", "unknown"],
  agentRegistered: [undefined, null, true, false],
  tokenLifetime: [undefined, null, "short_lived", "long_lived", "standing", "unknown"],
  scopeState: [undefined, null, "least_privilege", "over_scoped", "unscoped", "unknown"],
  approvalState: [undefined, null, "approved", "pending", "none", "expired", "unknown"],
  recordingState: [undefined, null, "recorded", "unrecorded", "unknown"],
  bridgeReachable: [undefined, null, true, false],
};
const integrityRes = enumerateGrantSafety({
  domains: rawDomains,
  build: (c) => {
    const { __alias, ...wire } = c;
    const raw = { ...wire } as AgentIdentityReportRaw;
    if (__alias === "present") raw.agent_registered = true;
    return normalizeReport("enum", raw, "enum");
  },
  evaluate: (n) => n,
  actionOf: (n) => (n.reportIntegrity === "clean" ? "none" : "malformed"),
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    Object.keys(PARSEABLE_RAW).every((k) => PARSEABLE_RAW[k].includes(c[k])),
});
check(
  `parse fidelity: over all ${integrityRes.combos} raw reports, reportIntegrity is 'clean' for EXACTLY the reports whose every field carries a parseable wire value and which carry no unrecognized key (mismatches=${integrityRes.mismatches}${integrityRes.firstMismatch ? ", first=" + integrityRes.firstMismatch : ""})`,
  integrityRes.mismatches === 0 && integrityRes.combos === productOf(rawDomains),
);
check("parse fidelity: both outcomes occur (the pass is not vacuous)", integrityRes.noneCount > 0 && integrityRes.noneCount < integrityRes.combos);

// ── own-property discipline ────────────────────────────────────────────────────
// An inherited value is the PROTOTYPE's claim, not this report's. Reading it as a
// confirmation was a real defect: a report with ZERO own keys granted.
const inherited = normalizeReport("inh", Object.create({
  actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived",
  scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded",
  bridgeReachable: true,
}) as AgentIdentityReportRaw);
check("a report with ZERO own keys asserts nothing — every field falls to unknown", inherited.actorType === "unknown" && inherited.agentRegistered === null && inherited.bridgeReachable === null);
check("...and therefore cannot grant", evaluateAgentIdentity(inherited).recommendedAction !== "none");
// Own-only READS and the chain SCAN are deliberately asymmetric. An inherited value
// cannot confirm anything — but an inherited UNRECOGNIZED key is still a governance
// assertion in a spelling we ignore, and the scan is the only thing that sees it.
// Collapsing the two once let a report grant while `report.agent_registered` answered
// `false` on that very object.
const aliasOnProto = Object.assign(
  Object.create({ agent_registered: false }),
  { actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true },
) as AgentIdentityReportRaw;
check("an unrecognized governance key INHERITED from the prototype is still an unrecognized envelope", normalizeReport("ap", aliasOnProto).reportIntegrity === "malformed");
check("...so a report whose own keys all confirm still cannot grant", evaluateAgentIdentity(normalizeReport("ap", aliasOnProto)).recommendedAction !== "none");
const aliasTwoUp = Object.assign(Object.create(Object.create({ token_lifetime: "standing" })), { actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true }) as AgentIdentityReportRaw;
check("...at any depth in the chain, not just one level up", normalizeReport("a2", aliasTwoUp).reportIntegrity === "malformed");
const symbolOnProto = Object.assign(Object.create({ [Symbol.for("agentRegistered")]: true }), { actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true }) as AgentIdentityReportRaw;
check("...including a SYMBOL-keyed assertion on the prototype", normalizeReport("as", symbolOnProto).reportIntegrity === "malformed");
// The sharp edge: a CORRECTLY-SPELLED inherited governance key. It is a stronger
// assertion than a misspelled one, not a weaker one — and because values are read
// own-only, it would otherwise be asserted by the report and read by nobody, so the
// verdict granted while `report.agentRegistered` answered `true` on that same object.
const knownOnProto = Object.assign(
  Object.create({ agentRegistered: true, approvalState: "approved", tokenLifetime: "standing" }),
  { actorType: "human", bridgeReachable: true },
) as AgentIdentityReportRaw;
check("a RECOGNIZED governance key inherited from the prototype is an unrecognized envelope", normalizeReport("kp", knownOnProto).reportIntegrity === "malformed");
check("...so the human fast-path cannot be reached by hiding governance state on the prototype", evaluateAgentIdentity(normalizeReport("kp", knownOnProto)).recommendedAction !== "none");
for (const key of ["agentRegistered", "approvalState", "tokenLifetime", "scopeState", "recordingState"]) {
  const one = Object.assign(Object.create({ [key]: key === "agentRegistered" ? true : "unknown" }), { actorType: "human", bridgeReachable: true }) as AgentIdentityReportRaw;
  check(`...for every governance field individually (${key})`, evaluateAgentIdentity(normalizeReport("k1", one)).recommendedAction !== "none");
}
// The scan's catch is load-bearing: a Proxy that THROWS from ownKeys must fail closed.
const throwingKeys = new Proxy({ actorType: "human", bridgeReachable: true }, {
  ownKeys: () => { throw new Error("hostile"); },
}) as AgentIdentityReportRaw;
check("a Proxy that THROWS from ownKeys fails closed, it does not grant", evaluateAgentIdentity(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
check("a null report body is malformed, not an untyped TypeError", normalizeReport("nb", null as unknown as AgentIdentityReportRaw).reportIntegrity === "malformed");
// The walk is bounded: a Proxy returning a fresh prototype on every call must not hang.
const endlessProto = (): object => new Proxy({}, { getPrototypeOf: () => endlessProto(), ownKeys: () => [] });
check("a Proxy with an endless prototype chain terminates and fails closed", normalizeReport("ep", endlessProto() as AgentIdentityReportRaw).reportIntegrity === "malformed");
check("an ARRAY report is malformed, never a grant", normalizeReport("arr", [] as unknown as AgentIdentityReportRaw).reportIntegrity === "malformed");
// A polluted global prototype is likewise not an assertion this report made.
const proto = Object.prototype as unknown as Record<string, unknown>;
proto.actorType = "human";
try {
  const polluted = normalizeReport("pol", { bridgeReachable: true } as AgentIdentityReportRaw);
  check("a polluted Object.prototype is not read as a confirmation", polluted.actorType === "unknown" && evaluateAgentIdentity(polluted).recommendedAction !== "none");
} finally {
  delete proto.actorType;
}
// A hostile Proxy can always lie about its own keys; the point is that lying now costs
// it the grant. Hiding descriptors makes every field read ABSENT, which denies.
const hidden = new Proxy(
  { actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true, agent_registered: false },
  { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined },
) as AgentIdentityReportRaw;
check("a Proxy that hides its own properties reads as ABSENT and cannot grant", evaluateAgentIdentity(normalizeReport("px", hidden)).recommendedAction !== "none");
// A non-object body must fail closed, not throw an untyped TypeError out of the
// normalizer (the shipped HTTP transport rejects these, but the transport is injectable).
const notAnObject = normalizeReport("s", "ERR: upstream timeout" as unknown as AgentIdentityReportRaw);
check("a non-object report is malformed, not a thrown TypeError", notAnObject.reportIntegrity === "malformed" && evaluateAgentIdentity(notAnObject).recommendedAction !== "none");

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
check("a confirmed human contributes 'monitor' to the fabric, not 'none'", fromAgentIdentity(human).action === "monitor");

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
