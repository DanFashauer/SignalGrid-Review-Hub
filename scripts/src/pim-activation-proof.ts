// PIM activation decision proof — fully OFFLINE and deterministic.
//
// This is the one surface where SignalGrid does not observe a decision but MAKES one
// that another system enforces: Entra PIM's custom extension calls a REST API at role
// activation and obeys the outcome it gets back — Denied, Approved (route to the
// approver group), or AutoApproved (activate immediately, time-bound).
//
// The allow path is therefore `AutoApproved`, and it carries the same discipline the
// connectors apply to `none`: POSITIVE CONFIRMATION OF EVERY INPUT. `Approved` is not a
// middle severity — it is a human being asked — so every unknown lands there rather
// than denying a responder on a guess or waving them through.
import {
  evaluatePimActivation,
  normalizeActivationRequest,
  type NormalizedPimActivation,
  type PimActivationRequestRaw,
} from "@workspace/pim-activation";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("PIM activation decision proof");

const CONFIRMED: PimActivationRequestRaw = {
  ticketState: "valid", changeClass: "emergency", requesterOnCall: true,
  deviceRiskTier: "ok", actorConfirmedHuman: true, signalsFresh: true,
};
const ev = (r: PimActivationRequestRaw, id = "req-1") => evaluatePimActivation(normalizeActivationRequest(id, r));

// ── the three outcomes PIM enforces ────────────────────────────────────────────

const auto = ev(CONFIRMED);
check("a verified on-call engineer, valid P1 ticket, healthy device, fresh signals → AutoApproved", auto.outcome === "AutoApproved" && auto.reasonCode === "AUTO_APPROVED_VERIFIED_ONCALL" && auto.autoApprovalConfirmed === true);
check("...with no blocking findings and no unknowns", auto.blockingFindings.length === 0 && auto.unknownSignals.length === 0);
check("...and an explanation an Entra audit reader can act on", auto.explanation.length > 40 && auto.explanation.includes("time-bound"));

const noTicket = ev({ ...CONFIRMED, ticketState: "absent" });
check("no change ticket → Denied", noTicket.outcome === "Denied" && noTicket.reasonCode === "NO_VALID_TICKET" && noTicket.blockingFindings.includes("ticket_absent"));
const badTicket = ev({ ...CONFIRMED, ticketState: "invalid" });
check("an invalid ticket → Denied", badTicket.outcome === "Denied" && badTicket.blockingFindings.includes("ticket_invalid"));

const routine = ev({ ...CONFIRMED, changeClass: "routine" });
check("a ROUTINE change with a valid ticket → Approved (the approver group reviews)", routine.outcome === "Approved" && routine.reasonCode === "APPROVER_REVIEW_REQUIRED");

// ── what SignalGrid adds that a ticket check cannot ────────────────────────────
//
// This is the whole commercial claim, and it is one case: everything ServiceNow can
// see is green, and the elevation is still refused on grounds only the grid holds.
const blockedDevice = ev({ ...CONFIRMED, deviceRiskTier: "blocked" });
check("a verified on-call engineer with a VALID P1 ticket is DENIED on a BLOCKED device", blockedDevice.outcome === "Denied" && blockedDevice.reasonCode === "DEVICE_BLOCKED");
check("...and the explanation says why, so the engineer knows what to fix", blockedDevice.explanation.includes("BLOCKED") && blockedDevice.explanation.includes("device"));
const nonHuman = ev({ ...CONFIRMED, actorConfirmedHuman: false });
check("an activation not confirmed to come from a person → Denied", nonHuman.outcome === "Denied" && nonHuman.reasonCode === "NON_HUMAN_ACTOR");
// Degraded tiers do not deny — they withhold the automatic approval.
for (const tier of ["watch", "at_risk"]) {
  const v = ev({ ...CONFIRMED, deviceRiskTier: tier });
  check(`a '${tier}' device does not deny, it routes to the approver group`, v.outcome === "Approved");
}

// ── unknowns route to a human; they neither deny nor grant ────────────────────
for (const [field, label] of [["requesterOnCall", "on-call roster"], ["signalsFresh", "signal freshness"], ["actorConfirmedHuman", "actor is a person"]] as const) {
  const v = ev({ ...CONFIRMED, [field]: undefined });
  check(`an unreported '${label}' routes to the approver group, never Denied, never AutoApproved`, v.outcome === "Approved" && v.autoApprovalConfirmed === false);
}
const stale = ev({ ...CONFIRMED, signalsFresh: false });
check("signals explicitly NOT fresh → Approved with SIGNALS_STALE, not a silent auto-approval", stale.outcome === "Approved" && stale.reasonCode === "SIGNALS_STALE");
const malformed = ev({ ...CONFIRMED, deviceRiskTier: "green" });
check("an unparseable field marks the request malformed and routes to review", malformed.outcome === "Approved" && malformed.reasonCode === "REQUEST_MALFORMED");

// ── hostile request shapes (the caller is external) ───────────────────────────
const inherited = normalizeActivationRequest("inh", Object.create(CONFIRMED) as PimActivationRequestRaw);
check("a request with ZERO own keys asserts nothing and cannot AutoApprove", evaluatePimActivation(inherited).outcome !== "AutoApproved");
const aliased = normalizeActivationRequest("al", { ...CONFIRMED, ticket_state: "valid" } as PimActivationRequestRaw);
check("an unrecognized key means the envelope was not understood", aliased.requestIntegrity === "malformed" && evaluatePimActivation(aliased).outcome !== "AutoApproved");
const protoAlias = normalizeActivationRequest("pa", Object.assign(Object.create({ ticket_state: "valid" }), CONFIRMED) as PimActivationRequestRaw);
check("an unrecognized key INHERITED from the prototype is caught too", protoAlias.requestIntegrity === "malformed");
const hidden = new Proxy({ ...CONFIRMED }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as PimActivationRequestRaw;
check("a Proxy hiding its own descriptors reads as ABSENT and cannot AutoApprove", evaluatePimActivation(normalizeActivationRequest("px", hidden)).outcome !== "AutoApproved");
const throwing = new Proxy({ ...CONFIRMED }, { ownKeys: () => { throw new Error("hostile"); } }) as PimActivationRequestRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluatePimActivation(normalizeActivationRequest("tk", throwing)).outcome !== "AutoApproved");
check("a non-object request body is malformed, not a thrown TypeError", normalizeActivationRequest("s", "boom" as unknown as PimActivationRequestRaw).requestIntegrity === "malformed");
check("a null request body is malformed, not a thrown TypeError", normalizeActivationRequest("n", null as unknown as PimActivationRequestRaw).requestIntegrity === "malformed");
const stringBool = normalizeActivationRequest("sb", { ...CONFIRMED, requesterOnCall: "true" } as PimActivationRequestRaw);
check("a string-quoted boolean is an assertion we could not read, not a confirmation", stringBool.requesterOnCall === null && stringBool.requestIntegrity === "malformed");
check("case and whitespace are canonicalized, not rejected", normalizeActivationRequest("cw", { ...CONFIRMED, ticketState: " VALID " }).ticketState === "valid");

// ── exhaustive: AutoApproved is the grant ─────────────────────────────────────

const domains = {
  ticketState: ["valid", "invalid", "absent", "unknown"],
  changeClass: ["routine", "emergency", "unknown"],
  requesterOnCall: [true, false, null],
  deviceRiskTier: ["ok", "watch", "at_risk", "blocked", "unknown"],
  actorConfirmedHuman: [true, false, null],
  signalsFresh: [true, false, null],
  requestIntegrity: ["clean", "malformed"],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) => ({ sourceSystem: "pim-activation", requestId: "enum", source: "enum", ...c }) as NormalizedPimActivation,
  evaluate: evaluatePimActivation,
  actionOf: (v) => (v.outcome === "AutoApproved" ? "none" : v.outcome),
  confirmedWhenNone: (v) => v.autoApprovalConfirmed === true && v.blockingFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.requestIntegrity === "clean" && c.ticketState === "valid" && c.changeClass === "emergency" &&
    c.requesterOnCall === true && c.deviceRiskTier === "ok" && c.actorConfirmedHuman === true && c.signalsFresh === true,
});
check(
  `exhaustive (normalized): over all ${enumRes.combos} states, AutoApproved requires ALL SEVEN inputs positively confirmed (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 3240,
);
check("exhaustive (normalized): exactly ONE state auto-approves", enumRes.noneCount === 1);

// Denied must never be reachable from an absence — only from an affirmative bad fact.
let deniedWithoutBlocker = 0;
for (const t of domains.ticketState) for (const d of domains.deviceRiskTier) for (const a of domains.actorConfirmedHuman) {
  const v = evaluatePimActivation({ sourceSystem: "pim-activation", requestId: "d", source: "d", ticketState: t, changeClass: "unknown", requesterOnCall: null, deviceRiskTier: d, actorConfirmedHuman: a, signalsFresh: null, requestIntegrity: "malformed" } as NormalizedPimActivation);
  if (v.outcome === "Denied" && v.blockingFindings.length === 0) deniedWithoutBlocker += 1;
}
check("Denied is NEVER reached without an affirmative blocking finding — an unknown never blocks a responder", deniedWithoutBlocker === 0);

const rawDomains = {
  ticketState: ["valid", "invalid", "absent", "unknown", undefined, null, "approved"],
  changeClass: ["routine", "emergency", "unknown", undefined, null, ["emergency"]],
  requesterOnCall: [true, false, null, undefined, "true", 1],
  deviceRiskTier: ["ok", "watch", "at_risk", "blocked", "unknown", undefined, null, "green"],
  actorConfirmedHuman: [true, false, null, undefined, {}],
  signalsFresh: [true, false, null, undefined, "yes"],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedPimActivation => {
  const { __alias, ...wire } = c;
  const raw = { ...wire } as PimActivationRequestRaw;
  if (__alias === "present") raw.ticket_state = "valid";
  return normalizeActivationRequest("enum", raw, "enum");
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluatePimActivation,
  actionOf: (v) => (v.outcome === "AutoApproved" ? "none" : v.outcome),
  confirmedWhenNone: (v) => v.autoApprovalConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" && c.ticketState === "valid" && c.changeClass === "emergency" &&
    c.requesterOnCall === true && c.deviceRiskTier === "ok" && c.actorConfirmedHuman === true && c.signalsFresh === true,
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw requests — junk enums, JSON nulls, string-quoted booleans, numbers, arrays, objects, absent keys, an aliased extra key — AutoApproved requires the full seven-way confirmation (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 100800,
);
check("exhaustive (raw wire): exactly ONE raw request auto-approves", rawEnumRes.noneCount === 1);

// Parse fidelity — the integrity flag itself, against an independent wire allowlist.
const PARSEABLE: Record<string, readonly unknown[]> = {
  ticketState: [undefined, null, "valid", "invalid", "absent", "unknown"],
  changeClass: [undefined, null, "routine", "emergency", "unknown"],
  requesterOnCall: [undefined, null, true, false],
  deviceRiskTier: [undefined, null, "ok", "watch", "at_risk", "blocked", "unknown"],
  actorConfirmedHuman: [undefined, null, true, false],
  signalsFresh: [undefined, null, true, false],
};
const integrityRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (n) => n,
  actionOf: (n) => (n.requestIntegrity === "clean" ? "none" : "malformed"),
  positivelyClean: (c) => c.__alias !== "present" && Object.keys(PARSEABLE).every((k) => PARSEABLE[k].includes(c[k])),
});
check(
  `parse fidelity: over all ${integrityRes.combos} raw requests, requestIntegrity is 'clean' for EXACTLY the parseable, unaliased ones (mismatches=${integrityRes.mismatches})`,
  integrityRes.mismatches === 0 && integrityRes.combos === productOf(rawDomains),
);
check("parse fidelity: both outcomes occur (not vacuous)", integrityRes.noneCount > 0 && integrityRes.noneCount < integrityRes.combos);

// Determinism.
const d1 = normalizeActivationRequest("det", CONFIRMED);
check("evaluator is deterministic", JSON.stringify(evaluatePimActivation(d1)) === JSON.stringify(evaluatePimActivation(d1)));


// ── end-to-end: the grid's own verdict drives the PIM decision ─────────────────
//
// Everything above takes `deviceRiskTier` as a given. That is exactly the weak point:
// a field is only as trustworthy as whatever sets it, and the product claim rests on
// this tier being the FUSED verdict of real connectors rather than something a caller
// typed. These checks close that gap by running actual connector verdicts through
// composeDeviceRisk and into the activation decision.
const e2eMod = await import("@workspace/posture-composition");
const { composeDeviceRisk, fromAgentIdentity, fromDeviceManagementHealth } = e2eMod;
const { deviceRiskTierFromPosture } = await import("@workspace/pim-activation");
const ai = await import("@workspace/integrations/agent-identity");
const dmh = await import("@workspace/integrations/device-management-health");

const activationFor = (tier: string) => ev({ ...CONFIRMED, deviceRiskTier: tier });

// A retired enrollment restricts → blocked tier → elevation refused, from real verdicts.
const retiredDevice = dmh.evaluateDeviceManagementHealth(
  dmh.normalizeReport("d", { mdmCheckInFreshness: "fresh", agentCheckInFreshness: "not_applicable", remediationHealth: "not_applicable", policyDrift: "on_baseline", complianceCoverage: "covered", enrollmentState: "retired", managementReachable: true }),
);
const retiredTier = deviceRiskTierFromPosture(composeDeviceRisk([fromDeviceManagementHealth(retiredDevice)]));
check("a RETIRED enrollment fuses to the 'blocked' tier", retiredTier === "blocked");
check("...and that tier alone refuses the elevation of a verified on-call engineer", activationFor(retiredTier).outcome === "Denied");

// A shadow agent escalates → blocked → refused.
const shadowAgent = ai.evaluateAgentIdentity(
  ai.normalizeReport("a", { actorType: "agent", agentRegistered: false, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true }),
);
const shadowTier = deviceRiskTierFromPosture(composeDeviceRisk([fromAgentIdentity(shadowAgent)]));
check("an UNREGISTERED agent acting on the device fuses to 'blocked'", shadowTier === "blocked");
check("...and refuses the elevation too", activationFor(shadowTier).outcome === "Denied");

// A fully-governed agent + healthy device fuses to ok, and DOES auto-approve.
const governedAgent = ai.evaluateAgentIdentity(
  ai.normalizeReport("a", { actorType: "agent", agentRegistered: true, tokenLifetime: "short_lived", scopeState: "least_privilege", approvalState: "approved", recordingState: "recorded", bridgeReachable: true }),
);
const healthyDevice = dmh.evaluateDeviceManagementHealth(
  dmh.normalizeReport("d", { mdmCheckInFreshness: "fresh", agentCheckInFreshness: "not_applicable", remediationHealth: "not_applicable", policyDrift: "on_baseline", complianceCoverage: "covered", enrollmentState: "enrolled", managementReachable: true }),
);
const healthyTier = deviceRiskTierFromPosture(composeDeviceRisk([fromAgentIdentity(governedAgent), fromDeviceManagementHealth(healthyDevice)]));
check("a governed agent on a healthy device fuses to 'ok'", healthyTier === "ok");
check("...and the elevation auto-approves — the happy path is genuinely reachable end to end", activationFor(healthyTier).outcome === "AutoApproved");

// The trap: an EMPTY grid reports riskTier 'ok' with zero signals. "Nothing is known to
// be wrong" is not "confirmed healthy", and an automatic privileged elevation must rest
// on the second. A device not yet onboarded, every connector unreachable, or a misrouted
// device id would otherwise be indistinguishable from a device that reported clean.
const emptyPosture = composeDeviceRisk([]);
check("an EMPTY grid still reports riskTier 'ok' (composeDeviceRisk is right to)", emptyPosture.riskTier === "ok" && emptyPosture.signalCount === 0);
check("...but maps to 'unknown', because no signals is not a clean bill of health", deviceRiskTierFromPosture(emptyPosture) === "unknown");
check("...so an unonboarded or unreachable device routes to the approver group, never auto-approved", activationFor(deviceRiskTierFromPosture(emptyPosture)).outcome === "Approved");

// A count that could not be READ is not a count of confirmations. `count <= 0` read
// undefined and NaN as "some signals" and fell through to the tier — the trusting side.
for (const bad of [undefined, NaN, -1, 0, "3"]) {
  check(`a posture whose signalCount is ${String(bad)} (${typeof bad}) maps to 'unknown' — an unreadable count is not a confirmation`,
    deviceRiskTierFromPosture({ ...emptyPosture, signalCount: bad as never }) === "unknown");
}
check("a posture with signals but an off-tier riskTier maps to 'unknown', never 'ok'",
  deviceRiskTierFromPosture({ ...emptyPosture, signalCount: 1, riskTier: "green" as never }) === "unknown");
check("...and a real count with a real tier still passes the tier through (the guard is not vacuous)",
  deviceRiskTierFromPosture({ ...emptyPosture, signalCount: 1, riskTier: "watch" }) === "watch");
// The exhaustive sweep's domains are HAND-LISTED above. A request field added
// tomorrow and silently ignored by the evaluator would not be in that list, so the
// 3240-state sweep could not see it. Pin the list to the request's own key set.
const { PIM_ACTIVATION_REQUEST_KEYS } = await import("@workspace/pim-activation");
check("the exhaustive sweep's domains are exactly the request's declared keys plus requestIntegrity — a new field cannot be ignored unseen",
  JSON.stringify(Object.keys(domains).sort()) === JSON.stringify([...PIM_ACTIVATION_REQUEST_KEYS, "requestIntegrity"].sort()));

// Worst-concern-wins survives the bridge: one blocked signal among healthy ones still blocks.
const mixedTier = deviceRiskTierFromPosture(composeDeviceRisk([fromAgentIdentity(governedAgent), fromDeviceManagementHealth(retiredDevice)]));
check("worst-concern-wins survives the bridge: one blocked dimension among healthy ones still refuses", mixedTier === "blocked" && activationFor(mixedTier).outcome === "Denied");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
