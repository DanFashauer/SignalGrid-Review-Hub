// Challenge-capability proof — fully OFFLINE and deterministic.
//
// The dimension: could this device+worker pair actually ANSWER the step-up a
// workflow would pose? The fabric's remedy doctrine chooses step_up over
// lockouts everywhere; this proves the fabric can now SEE when that remedy
// path is a dead end (no enrolled method, no authenticator, dead client) —
// instead of issuing a deny wearing a step_up label.
//
// Laws pinned here:
//  - READY is earned: only a posed, clean, bridge-affirmed report with at
//    least one accepted method positively enrolled + present + healthy.
//  - Absence is never capability, and silence is never a dead end: an
//    unreported or partially-reported method is a blind spot (monitor), while
//    UNANSWERABLE demands EVERY accepted method positively broken (alert).
//  - Unposed forecloses nothing (day-one quiet), and an unreadable pose
//    refuses rather than answering optimistically.
//  - The full single-method standing space is enumerated: answerable is true
//    in EXACTLY the all-affirmed cell.

import {
  makeDefaultChallengeCapabilityTransport,
  CHALLENGE_METHODS,
  ChallengeCapabilityConnector,
  ChallengeCapabilityConnectorError,
  createMockChallengeCapabilityTransport,
  evaluateChallengeCapability,
  guardReadOnly,
  normalizeChallengeReport,
  resolveChallengeCapabilityConnector,
  type ChallengeCapabilityReportRaw,
} from "@workspace/integrations/challenge-capability";
import { composeDeviceRisk, fromChallengeCapability } from "@workspace/posture-composition";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Challenge-capability (answerable step-up) proof");

const entry = (method: string, enrolled: unknown, present: unknown, healthy: unknown) => ({
  method,
  enrolled,
  authenticator_present: present,
  client_healthy: healthy,
});
const report = (methods: unknown, bridge: unknown = true): ChallengeCapabilityReportRaw => ({
  methods,
  bridge_reachable: bridge,
});
const norm = (r: ChallengeCapabilityReportRaw) => normalizeChallengeReport("pair-1", r);

// ── the ready path is earned ────────────────────────────────────────────────────
const ready = evaluateChallengeCapability(norm(report([entry("fingerprint", true, true, true)])), {
  acceptedMethods: ["fingerprint"],
});
check(
  "a posed, clean, bridge-affirmed, fully-positive method → challenge_ready/none, answerable, method listed",
  ready.posture === "challenge_ready" && ready.reasonCode === "CHALLENGE_READY" && ready.recommendedAction === "none" &&
    ready.challengeAnswerable === true && ready.answerableMethods.length === 1 && ready.answerableMethods[0] === "fingerprint",
);
check("a ready verdict composes to the 'ok' tier", composeDeviceRisk([fromChallengeCapability(ready)]).riskTier === "ok");

// One answerable accepted method is enough, even beside a broken one — the
// challenge IS answerable.
const mixedReady = evaluateChallengeCapability(
  norm(report([entry("fingerprint", true, true, true), entry("card_tap", false, true, true)])),
  { acceptedMethods: ["fingerprint", "card_tap"] },
);
check("one answerable method beside a broken one → still ready (the challenge IS answerable)", mixedReady.challengeAnswerable === true && mixedReady.posture === "challenge_ready");

// ── the dead end is an affirmative claim ────────────────────────────────────────
const dead = evaluateChallengeCapability(
  norm(report([entry("fingerprint", false, true, true), entry("card_tap", true, false, true)])),
  { acceptedMethods: ["fingerprint", "card_tap"] },
);
check(
  "EVERY accepted method positively broken → challenge_unanswerable/ALERT with per-method findings",
  dead.posture === "challenge_unanswerable" && dead.reasonCode === "CHALLENGE_UNANSWERABLE" &&
    dead.recommendedAction === "alert" && dead.challengeAnswerable === false && dead.criticalFindings.length === 2 &&
    dead.criticalFindings.includes("fingerprint: enrolled=false") && dead.criticalFindings.includes("card_tap: authenticator_present=false"),
);
check("an unanswerable pair composes to a non-ok tier, never silently healthy", composeDeviceRisk([fromChallengeCapability(dead)]).riskTier !== "ok");

// Silence is NOT a dead end: an unreported accepted method makes the outcome a
// blind spot (monitor), even beside a positively-broken sibling.
const blind = evaluateChallengeCapability(norm(report([entry("fingerprint", false, true, true)])), {
  acceptedMethods: ["fingerprint", "card_tap"],
});
check(
  "a broken method + an UNREPORTED method → unverified/monitor, never alert (a blind spot is not a dead end)",
  blind.posture === "unverified" && blind.reasonCode === "CHALLENGE_STANDING_UNKNOWN" && blind.recommendedAction === "monitor" &&
    blind.unknownSignals.includes("card_tap: not reported"),
);

// Absence is never capability: a method missing from the report cannot grant.
const absent = evaluateChallengeCapability(norm(report([])), { acceptedMethods: ["fingerprint"] });
check("an accepted method absent from the report → monitor, never ready (absence is never capability)", absent.challengeAnswerable === false && absent.recommendedAction === "monitor");

// A partially-reported method (nulls) is indeterminate, not broken and not ready.
const partial = evaluateChallengeCapability(norm(report([entry("fingerprint", true, null, true)])), {
  acceptedMethods: ["fingerprint"],
});
check("a partially-reported method (null axis) → unverified/monitor, neither ready nor a dead end", partial.posture === "unverified" && partial.unknownSignals.includes("fingerprint: standing not fully reported"));

// ── the pose is the caller's, and unposed forecloses nothing ────────────────────
const unposed = evaluateChallengeCapability(norm(report([entry("fingerprint", false, false, false)])));
check("UNPOSED → unassessed/none, quiet, answerable=false — a deployment that has not asked is never nagged", unposed.posture === "unassessed" && unposed.reasonCode === "CHALLENGE_UNPOSED" && unposed.recommendedAction === "none" && unposed.challengeAnswerable === false);
const emptyPose = evaluateChallengeCapability(norm(report([entry("fingerprint", true, true, true)])), { acceptedMethods: [] });
check("an EMPTY pose is unposed, not an alert and not a grant", emptyPose.posture === "unassessed" && emptyPose.challengeAnswerable === false);
const badPose = evaluateChallengeCapability(norm(report([entry("fingerprint", true, true, true)])), {
  acceptedMethods: ["fingerprint", "retina_scan"],
});
check("an unrecognized method in the POSE refuses the whole question — never answered optimistically", badPose.posture === "unknown" && badPose.reasonCode === "ACCEPTED_METHOD_UNRECOGNIZED" && badPose.recommendedAction === "monitor" && badPose.challengeAnswerable === false);

// ── unreadable evidence never grades ready ──────────────────────────────────────
check("a malformed report (unrecognized method NAME) never grades ready", (() => {
  const n = norm(report([entry("palm_vein", true, true, true)]));
  const v = evaluateChallengeCapability(n, { acceptedMethods: ["fingerprint"] });
  return n.reportIntegrity === "malformed" && v.reasonCode === "REPORT_MALFORMED" && v.challengeAnswerable === false;
})());
check("a DUPLICATE method entry is malformed (two claims about one fact)", norm(report([entry("fingerprint", true, true, true), entry("fingerprint", true, true, true)])).reportIntegrity === "malformed");
check("a non-array methods slot asserted is malformed", norm(report("all good")).reportIntegrity === "malformed");
check("an unrecognized entry key is malformed", norm(report([{ method: "fingerprint", enrolled: true, authenticator_present: true, client_healthy: true, vendor_extra: 1 }])).reportIntegrity === "malformed");
check("an unrecognized top-level key is malformed", norm({ methods: [], bridge_reachable: true, spurious: 1 } as ChallengeCapabilityReportRaw).reportIntegrity === "malformed");
check("a non-boolean assertion in a boolean slot is malformed, never coerced", norm(report([entry("fingerprint", "yes", true, true)])).reportIntegrity === "malformed");
check("a getter that throws is malformed (readThrew), never a silent default", (() => {
  const trap: Record<string, unknown> = {};
  Object.defineProperty(trap, "methods", { enumerable: true, get() { throw new Error("boom"); } });
  return normalizeChallengeReport("pair-1", trap as ChallengeCapabilityReportRaw).reportIntegrity === "malformed";
})());
check("a NON-OBJECT report (null) is malformed — not a quietly-empty clean read", normalizeChallengeReport("p", null as unknown as ChallengeCapabilityReportRaw).reportIntegrity === "malformed");
check("a non-boolean bridge_reachable assertion is malformed, never coerced and never mere silence", norm({ methods: [], bridge_reachable: "yes" } as ChallengeCapabilityReportRaw).reportIntegrity === "malformed");
check("a NON-ITERABLE methods slot asserted (a number) is malformed and does NOT throw", (() => {
  try {
    return norm({ methods: 42, bridge_reachable: true } as ChallengeCapabilityReportRaw).reportIntegrity === "malformed";
  } catch {
    return false;
  }
})());
check("a hostile report whose key enumeration THROWS (Proxy ownKeys trap) is malformed, never trusted", (() => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
  return normalizeChallengeReport("p", hostile as ChallengeCapabilityReportRaw).reportIntegrity === "malformed";
})());
check("an absent methods slot is CLEAN and empty — the bridge said nothing, which is absence, not corruption", (() => {
  const n = norm({ bridge_reachable: true });
  return n.reportIntegrity === "clean" && n.methods.length === 0;
})());
const malformedButPerfect = evaluateChallengeCapability(
  norm({ methods: [entry("fingerprint", true, true, true)], bridge_reachable: true, spurious: 1 } as ChallengeCapabilityReportRaw),
  { acceptedMethods: ["fingerprint"] },
);
check("a malformed report never grades ready even when its readable half looks perfect", malformedButPerfect.challengeAnswerable === false && malformedButPerfect.reasonCode === "REPORT_MALFORMED");

// ── the bridge must affirm, and coverage must exist ─────────────────────────────
check("bridge unreported (null) → unverified/monitor, never ready", evaluateChallengeCapability(norm({ methods: [entry("fingerprint", true, true, true)] }), { acceptedMethods: ["fingerprint"] }).reasonCode === "BRIDGE_UNREACHABLE");
check("bridge explicitly down → unverified/monitor, never ready", evaluateChallengeCapability(norm(report([entry("fingerprint", true, true, true)], false)), { acceptedMethods: ["fingerprint"] }).reasonCode === "BRIDGE_UNREACHABLE");
const uncovered = evaluateChallengeCapability(norm({}), { covered: false, acceptedMethods: ["fingerprint"] });
check("no capability record at all → unknown/NOT_COVERED/monitor", uncovered.posture === "unknown" && uncovered.reasonCode === "NOT_COVERED" && uncovered.recommendedAction === "monitor");

// ── exhaustive: the single-method standing space ────────────────────────────────
// One accepted method; enrolled × present × healthy × bridge each ∈
// {true,false,null}. Answerable must be true in EXACTLY the all-true cell;
// any explicit false among the method axes (bridge affirmed) must be the
// alert; everything else with the bridge affirmed is the monitor blind spot.
const tri = [true, false, null] as const;
let combos = 0;
let grants = 0;
let mismatches = 0;
for (const enrolled of tri) for (const present of tri) for (const healthy of tri) for (const bridge of tri) {
  combos += 1;
  const v = evaluateChallengeCapability(norm(report([entry("fingerprint", enrolled, present, healthy)], bridge)), {
    acceptedMethods: ["fingerprint"],
  });
  const expectAnswerable = enrolled === true && present === true && healthy === true && bridge === true;
  if (v.challengeAnswerable) grants += 1;
  if (v.challengeAnswerable !== expectAnswerable) mismatches += 1;
  if (bridge === true && !expectAnswerable) {
    const anyFalse = enrolled === false || present === false || healthy === false;
    const expectedReason = anyFalse ? "CHALLENGE_UNANSWERABLE" : "CHALLENGE_STANDING_UNKNOWN";
    if (v.reasonCode !== expectedReason) mismatches += 1;
  }
}
check(`exhaustive: over all ${combos} single-method standings, answerable is true in EXACTLY the all-affirmed cell (grants=${grants}, mismatches=${mismatches})`, combos === 81 && grants === 1 && mismatches === 0);

// ── determinism, fusion, connector guarantees, and the gate ─────────────────────
const detN = norm(report([entry("otp", true, true, true)]));
check("evaluator is deterministic", JSON.stringify(evaluateChallengeCapability(detN, { acceptedMethods: ["otp"] })) === JSON.stringify(evaluateChallengeCapability(detN, { acceptedMethods: ["otp"] })));
check("fromChallengeCapability emits a challenge_capability signal", fromChallengeCapability(ready).kind === "challenge_capability");
check("the method allowlist is the documented six", CHALLENGE_METHODS.length === 6);

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof ChallengeCapabilityConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const transport = createMockChallengeCapabilityTransport({ reports: { "pair-1": report([entry("pin", true, true, true)]) } });
const connector = new ChallengeCapabilityConnector({ accessToken: "t", baseUrl: "https://mfa.local/x" }, transport);
const fetched = await connector.fetchNormalized("pair-1");
check("the connector normalizes through the same defensive path", fetched.methods.length === 1 && fetched.methods[0].method === "pin" && fetched.reportIntegrity === "clean");
const unknownPair = await connector.fetchNormalized("ghost");
check("an unknown pair yields an empty report that can never grade ready", evaluateChallengeCapability(unknownPair, { acceptedMethods: ["pin"] }).challengeAnswerable === false);

check("dev tier resolves to fixture mode", resolveChallengeCapabilityConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveChallengeCapabilityConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveChallengeCapabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveChallengeCapabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CHALLENGE_CAPABILITY_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "challenge-capability",
  resolve: (env) => resolveChallengeCapabilityConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    CHALLENGE_CAPABILITY_ACCESS_TOKEN: "t",
  },
});


// The DEFAULT transport, which injecting one everywhere meant nothing ever executed.
// Its two guards survived every sweep: without `!res.ok` a vendor's 500 body is parsed
// as a report, and without the body-shape check an array or a bare `null` becomes one.
await checkDefaultTransport({
  check,
  family: "challenge-capability",
  transport: makeDefaultChallengeCapabilityTransport("https://vendor.invalid/challenge-capability") as (a: never) => Promise<unknown>,
  arg: { deviceRef: "d-1", token: "t" },
  codeOf: (err) => (err instanceof ChallengeCapabilityConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
