// Policy-binding decision proof — fully OFFLINE and deterministic.
//
// "Policies are assigned to security groups, not to each device one by one" — so
// membership IS the policy binding, and a wrong binding applies the wrong policies
// SILENTLY. This proof pins the doctrine across every failure mode: unbound is
// affirmatively ungoverned (restrict); a binding WIDER than the device's observed
// properties warrant is the fail-open case (restrict); NARROWER is a fail-closed
// nuisance (monitor); an unreadable direction cannot be confirmed benign (step_up);
// users inside a device group break policy targeting at group scale (alert); and
// unknown anything raises, never grants. The grant requires bound + matched +
// clean hygiene + clean parse, with the mismatch direction pinned moot-when-matched.
import {
  PolicyBindingConnector,
  PolicyBindingConnectorError,
  createMockPolicyBindingTransport,
  evaluatePolicyBinding,
  guardReadOnly,
  normalizeReport,
  type PolicyBindingReportRaw,
  type NormalizedPolicyBinding,
} from "@workspace/integrations/policy-binding";
import { SIGNAL_KINDS, composeDeviceRisk, fromPolicyBinding } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Policy-binding decision proof");

const ev = (r: PolicyBindingReportRaw, id = "dev-1") => evaluatePolicyBinding(normalizeReport(id, r));

// ── the grant ───────────────────────────────────────────────────────────────────
const correct = ev({ binding: "bound", profile_match: "matched", membership_hygiene: "clean" });
check("bound + matched + clean hygiene → the grant (binding confirmed)",
  correct.recommendedAction === "none" && correct.reasonCode === "BOUND_CORRECTLY" && correct.bindingConfirmed === true);
check("...with no critical findings and no unknowns", correct.criticalFindings.length === 0 && correct.unknownSignals.length === 0);
const correctWithDirection = ev({ binding: "bound", profile_match: "matched", mismatch_direction: "wider", membership_hygiene: "clean" });
check("a direction value alongside 'matched' is moot — the grant survives (direction exists in service of a mismatch)",
  correctWithDirection.recommendedAction === "none");

// ── the failure modes, each with its own reason ─────────────────────────────────
const unbound = ev({ binding: "unbound", profile_match: "matched", membership_hygiene: "clean" });
check("UNBOUND → restrict (an enrolled device outside every policy group receives NO policy — affirmatively ungoverned)",
  unbound.recommendedAction === "restrict" && unbound.reasonCode === "UNBOUND_UNGOVERNED" && unbound.criticalFindings.includes("unbound_ungoverned"));
const tooWide = ev({ binding: "bound", profile_match: "mismatched", mismatch_direction: "wider", membership_hygiene: "clean" });
check("mismatched + WIDER → restrict (fail-open: the corporate device in the BYOD group, 'compliant' against the wrong bar)",
  tooWide.recommendedAction === "restrict" && tooWide.reasonCode === "BINDING_TOO_WIDE" && tooWide.criticalFindings.includes("binding_too_wide"));
const tooNarrow = ev({ binding: "bound", profile_match: "mismatched", mismatch_direction: "narrower", membership_hygiene: "clean" });
check("mismatched + NARROWER → monitor (a fail-closed mistake: an ops nuisance, not a trust hole)",
  tooNarrow.recommendedAction === "monitor" && tooNarrow.reasonCode === "BINDING_TOO_NARROW");
const dirUnknown = ev({ binding: "bound", profile_match: "mismatched", membership_hygiene: "clean" });
check("mismatched + direction UNREADABLE → step_up (cannot confirm it is not the fail-open case)",
  dirUnknown.recommendedAction === "step_up" && dirUnknown.reasonCode === "MISMATCH_DIRECTION_UNKNOWN" && dirUnknown.unknownSignals.includes("mismatch_direction"));
const mixed = ev({ binding: "bound", profile_match: "matched", membership_hygiene: "mixed" });
check("users inside the device group → alert (policy targeting broken at GROUP scale, not one device)",
  mixed.recommendedAction === "alert" && mixed.reasonCode === "MIXED_MEMBERSHIP" && mixed.criticalFindings.includes("mixed_membership"));

// ── unknowns raise, never grant ─────────────────────────────────────────────────
const matchUnknown = ev({ binding: "bound", membership_hygiene: "clean" });
check("match state unreadable → step_up (MATCH_UNKNOWN)",
  matchUnknown.recommendedAction === "step_up" && matchUnknown.reasonCode === "MATCH_UNKNOWN");
const hygieneUnknown = ev({ binding: "bound", profile_match: "matched" });
check("hygiene state unreadable → step_up (HYGIENE_UNKNOWN)",
  hygieneUnknown.recommendedAction === "step_up" && hygieneUnknown.reasonCode === "HYGIENE_UNKNOWN");
const bindingUnknown = ev({ profile_match: "matched", membership_hygiene: "clean" });
check("binding state unreadable → step_up, never a confirmation",
  bindingUnknown.recommendedAction === "step_up" && bindingUnknown.unknownSignals.includes("binding"));
const uncovered = evaluatePolicyBinding(
  normalizeReport("d", { binding: "bound", profile_match: "matched", membership_hygiene: "clean" }),
  { covered: false });
check("no binding report returned (covered=false) → step_up",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── malformed / hostile report shapes ───────────────────────────────────────────
const extraKey = normalizeReport("x", { binding: "bound", profile_match: "matched", membership_hygiene: "clean", group_name: "SG-DEV-WIN-CORP" } as PolicyBindingReportRaw);
// The refusal must come from the INTEGRITY branch itself (REPORT_MALFORMED), not
// merely from the grant backstop — a malformed report whose fields all parse valid
// is exactly the state only the integrity branch can name.
check("an unrecognized key refuses AS malformed (not via the backstop)",
  extraKey.reportIntegrity === "malformed" && evaluatePolicyBinding(extraKey).reasonCode === "REPORT_MALFORMED" && evaluatePolicyBinding(extraKey).recommendedAction !== "none");
// Per-field integrity: each asserted-but-unparseable field must mark the report
// MALFORMED on its own (one junk field per report — several at once would let one
// integrity term hide behind another).
check("junk binding alone → malformed",
  normalizeReport("j1", { binding: "sorta", profile_match: "matched", membership_hygiene: "clean" }).reportIntegrity === "malformed");
check("junk profile_match alone → malformed",
  normalizeReport("j2", { binding: "bound", profile_match: "close-enough", membership_hygiene: "clean" }).reportIntegrity === "malformed");
check("junk mismatch_direction alone → malformed",
  normalizeReport("j3", { binding: "bound", profile_match: "mismatched", mismatch_direction: "sideways", membership_hygiene: "clean" }).reportIntegrity === "malformed");
check("junk membership_hygiene alone → malformed",
  normalizeReport("j4", { binding: "bound", profile_match: "matched", membership_hygiene: "mostly" }).reportIntegrity === "malformed");
const inherited = evaluatePolicyBinding(normalizeReport("i", Object.create({ binding: "bound", profile_match: "matched", membership_hygiene: "clean" }) as PolicyBindingReportRaw));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy({ binding: "bound", profile_match: "matched", membership_hygiene: "clean" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as PolicyBindingReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluatePolicyBinding(normalizeReport("px", hidden)).recommendedAction !== "none");
const throwingKeys = new Proxy({ binding: "bound", profile_match: "matched", membership_hygiene: "clean" }, { ownKeys: () => { throw new Error("hostile"); } }) as PolicyBindingReportRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluatePolicyBinding(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
const throwingAccessor = { profile_match: "matched", membership_hygiene: "clean" } as PolicyBindingReportRaw;
Object.defineProperty(throwingAccessor, "binding", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    normalizeReport("ta", throwingAccessor).reportIntegrity === "malformed" && evaluatePolicyBinding(normalizeReport("ta2", throwingAccessor)).recommendedAction !== "none");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeReport("s", "boom" as unknown as PolicyBindingReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeReport("n", null as unknown as PolicyBindingReportRaw).reportIntegrity === "malformed");
check("case and whitespace are canonicalized, not rejected",
  normalizeReport("cw", { binding: " BOUND " } as PolicyBindingReportRaw).binding === "bound");

// ── connector surface (mutation-guard coverage: every guard falsifiable) ────────
let pbReadOnly = false;
try { guardReadOnly("POST"); } catch (err) { pbReadOnly = err instanceof PolicyBindingConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", pbReadOnly);
const pbConn = new PolicyBindingConnector(
  { accessToken: "t", baseUrl: "https://plane.example" },
  createMockPolicyBindingTransport({ reports: { "dev-9": { binding: "bound", profile_match: "matched", membership_hygiene: "clean" } } }),
);
check("the connector round-trip normalizes a clean report end to end (grantable)",
  evaluatePolicyBinding(await pbConn.fetchNormalized("dev-9")).recommendedAction === "none");
check("an unknown device yields an all-unknown report that cannot grant",
  evaluatePolicyBinding(await pbConn.fetchNormalized("dev-unknown")).recommendedAction !== "none");
let pbDeepProto: object = {};
for (let i = 0; i < 100; i += 1) pbDeepProto = Object.create(pbDeepProto);
const pbDeepReport = Object.assign(Object.create(pbDeepProto), { binding: "bound", profile_match: "matched", membership_hygiene: "clean" });
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", pbDeepReport as PolicyBindingReportRaw).reportIntegrity === "malformed");
const pbProtoAlias = Object.assign(Object.create({ profile_match: "mismatched" }), { binding: "bound", profile_match: "matched", membership_hygiene: "clean" });
check("a recognized key inherited from the prototype marks the report malformed",
  normalizeReport("pa", pbProtoAlias as PolicyBindingReportRaw).reportIntegrity === "malformed");

// ── exhaustive (normalized): the grant is bound + matched + clean hygiene + clean ──
const normDomains = {
  binding: ["bound", "unbound", "unknown"],
  profileMatch: ["matched", "mismatched", "unknown"],
  mismatchDirection: ["wider", "narrower", "unknown"],
  membershipHygiene: ["clean", "mixed", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedPolicyBinding => ({
  sourceSystem: "policy-binding", deviceRef: "enum", source: "enum",
  binding: c.binding as NormalizedPolicyBinding["binding"],
  profileMatch: c.profileMatch as NormalizedPolicyBinding["profileMatch"],
  mismatchDirection: c.mismatchDirection as NormalizedPolicyBinding["mismatchDirection"],
  membershipHygiene: c.membershipHygiene as NormalizedPolicyBinding["membershipHygiene"],
  reportIntegrity: c.reportIntegrity as NormalizedPolicyBinding["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluatePolicyBinding,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.bindingConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.binding === "bound" &&
    c.profileMatch === "matched" &&
    c.membershipHygiene === "clean",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, the binding is confirmed ONLY when bound + matched + clean hygiene + clean parse (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 162,
);
check("exhaustive (normalized): exactly 3 states grant (one per direction value — moot when matched, the pinned doctrine)",
  normRes.noneCount === 3);

// ── exhaustive (raw wire): the normalizer + evaluator on hostile input ───────────
const rawDomains = {
  binding: ["bound", "unbound", undefined, "junk"],
  profile_match: ["matched", "mismatched", undefined],
  mismatch_direction: ["wider", "narrower", undefined],
  membership_hygiene: ["clean", "mixed", undefined, 7],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedPolicyBinding => {
  const { __alias, ...wire } = c;
  const raw: PolicyBindingReportRaw = {};
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.group_name = "SG-DEV-WIN-CORP";
  return normalizeReport("enum", raw, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluatePolicyBinding,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.bindingConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.binding === "bound" &&
    c.profile_match === "matched" &&
    c.membership_hygiene === "clean",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — junk enums, a number, an aliased group_name key — the binding is confirmed only on fully-clean bound+matched+clean reports (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 288,
);
check("exhaustive (raw wire): exactly 3 raw reports grant (one per direction value, all bound+matched+clean)",
  rawRes.noneCount === 3);

// ── fusion into the fabric (posture-composition + incident routing) ─────────────
check("policy_binding is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("policy_binding"));
const fusedWide = fromPolicyBinding(ev({ binding: "bound", profile_match: "mismatched", mismatch_direction: "wider", membership_hygiene: "clean" }));
check("fromPolicyBinding maps the fail-open (too-wide) verdict onto the unified ladder as restrict",
  fusedWide.kind === "policy_binding" && fusedWide.action === "restrict" && fusedWide.reason === "BINDING_TOO_WIDE");
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fusedWide,
]);
check("composition is worst-concern-wins: one too-wide binding drags an otherwise-healthy device to restrict, with policy_binding as the top driver",
  fused.strongestAction === "restrict" && fused.drivers[0]?.kind === "policy_binding");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromPolicyBinding(correct),
]);
check("...and a confirmed-correct binding contributes none — the dimension never lowers, only raises",
  fusedClean.strongestAction === "none");

// Determinism.
const d1 = normalizeReport("det", { binding: "bound", profile_match: "mismatched", mismatch_direction: "wider", membership_hygiene: "clean" });
check("evaluator is deterministic", JSON.stringify(evaluatePolicyBinding(d1)) === JSON.stringify(evaluatePolicyBinding(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
