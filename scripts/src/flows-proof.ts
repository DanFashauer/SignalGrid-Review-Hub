// Proof: the admin-configurable flow layer (@workspace/flows).
//
// Verifies the model the administrator configures and the Grid runs:
//   • flow health from observed signals (healthy / degraded / broken);
//   • a broken flow SELF-HEALS via its agent, or raises an ITSM-agnostic
//     incident — per the flow's configuration;
//   • per-action approval config (automated / admin / dual / user-override) is
//     honoured, and the ONLY thing an end user can act on is a downtime
//     break-glass override (with its safety nets);
//   • grid intelligence rises as more healthy signals feed more flows.
//
// Run: pnpm --filter @workspace/scripts run proof:flows

import {
  DEMO_FLOWS,
  evaluateFlowHealth,
  resolveFlowBreak,
  planFlowActions,
  gridIntelligence,
  findFlow,
  type SignalState,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };
const NOW = "2026-07-16T14:00:00.000Z";

const med = findFlow("flow_med_admin")!;
const net = findFlow("flow_network_change")!;
const cage = findFlow("flow_controlled_area")!;

const healthy = (ids: string[]): SignalState[] => ids.map((id) => ({ id, status: "healthy" }));

// ── catalog integrity ────────────────────────────────────────────────────────
check("flows have signals, actions, support team + itsm",
  DEMO_FLOWS.every((f) => f.requiredSignals.length > 0 && f.actions.length > 0 && !!f.supportTeam && !!f.itsm));
check("each flow carries exactly one downtime user-override action",
  DEMO_FLOWS.every((f) => f.actions.filter((a) => a.approval === "user_override_on_downtime").length <= 1));

// ── flow health ──────────────────────────────────────────────────────────────
check("all-healthy signals → flow healthy", evaluateFlowHealth(med, healthy(med.requiredSignals)).status === "healthy");
const oneBroken: SignalState[] = [{ id: "identity", status: "healthy" }, { id: "device_compliance", status: "broken" }, { id: "badge_binding", status: "healthy" }, { id: "baseline", status: "healthy" }];
const medBroken = evaluateFlowHealth(med, oneBroken);
check("a broken required signal → flow broken", medBroken.status === "broken" && medBroken.brokenSignals.includes("device_compliance"));
const oneStale: SignalState[] = [{ id: "identity", status: "healthy" }, { id: "device_compliance", status: "stale" }, { id: "badge_binding", status: "healthy" }, { id: "baseline", status: "healthy" }];
check("a stale required signal → flow degraded (not broken)", evaluateFlowHealth(med, oneStale).status === "degraded");
check("a missing required signal breaks the flow", evaluateFlowHealth(med, healthy(["identity"])).brokenSignals.length === 3);

// ── break resolution: self-heal OR incident ──────────────────────────────────
const healthyRes = resolveFlowBreak(med, healthy(med.requiredSignals), NOW);
check("healthy flow needs no resolution", healthyRes.kind === "healthy");

// med has NO autoHeal → a broken flow raises an incident for its ITSM.
const medRes = resolveFlowBreak(med, oneBroken, NOW);
check("broken flow without an agent raises an incident", medRes.kind === "incident");
if (medRes.kind === "incident") {
  check("incident carries severity, team, and the target ITSM",
    medRes.incident.severity === "sev2" && medRes.incident.supportTeam === "Clinical Ops" && medRes.incident.itsm === "servicedesk");
  check("incident names the broken signal", medRes.incident.brokenSignals.includes("device_compliance"));
}

// net has an auto-resolving agent → self-heal, no fallback incident.
const netBroken = healthy(["identity", "device_compliance", "baseline"]); // change_window missing
const netRes = resolveFlowBreak(net, netBroken, NOW);
check("uptime-critical flow self-heals via its agent", netRes.kind === "self_heal");
if (netRes.kind === "self_heal") {
  check("auto-resolving agent needs no fallback incident", netRes.plan.autoResolves === true && netRes.plan.fallbackIncident === null);
  check("self-heal plan names the offload agent", netRes.plan.agent === "config-rollback-bot");
}

// cage has a NON-auto-resolving agent → self-heal WITH a fallback incident.
const cageBroken = healthy(["identity", "device_compliance"]); // custody missing
const cageRes = resolveFlowBreak(cage, cageBroken, NOW);
check("non-auto-resolving agent self-heals but still pages", cageRes.kind === "self_heal");
if (cageRes.kind === "self_heal") {
  check("fallback incident raised when the agent can't fully resolve", cageRes.plan.fallbackIncident !== null);
}

// ── action approval config (admin-authored) ──────────────────────────────────
const allow = planFlowActions(med, "allow");
const byKey = (plan: typeof allow, k: string) => plan.find((a) => a.key === k)!;
check("automated action runs on allow", byKey(allow, "bcma.open").disposition === "automated");
check("dual-approval action needs two approvals", byKey(allow, "controlled.administer").disposition === "dual_approval" && byKey(allow, "controlled.administer").requiresApprovals === 2);
check("admin-approval action needs one approval", byKey(allow, "dose.override").disposition === "admin_approval" && byKey(allow, "dose.override").requiresApprovals === 1);
check("user-override is NOT offered without a downtime", byKey(allow, "downtime.paper_fallback").disposition === "blocked");

// deny blocks everything (an override needs downtime + satisfied safety nets).
const deny = planFlowActions(med, "deny");
check("deny blocks all non-override actions", deny.filter((a) => a.approval !== "user_override_on_downtime").every((a) => a.disposition === "blocked"));

// step_up HOLDS every action until verification is satisfied — nothing runs early.
const stepHeld = planFlowActions(med, "step_up");
check("SAFETY: step_up holds automated actions (not run before verification)",
  byKey(stepHeld, "bcma.open").disposition === "held");
check("step_up holds every non-override action", stepHeld.filter((a) => a.approval !== "user_override_on_downtime").every((a) => a.disposition === "held"));
const stepDone = planFlowActions(med, "step_up", { stepUpSatisfied: true });
check("a satisfied step-up releases as allow", byKey(stepDone, "bcma.open").disposition === "automated");

// break-glass override: downtime ALONE is not enough — safety nets must be satisfied.
const downtimeOnly = planFlowActions(med, "deny", { downtime: true });
check("SAFETY: downtime without satisfied safety nets does NOT offer the override",
  byKey(downtimeOnly, "downtime.paper_fallback").disposition === "blocked");
const downtimeCleared = planFlowActions(med, "deny", { downtime: true, safetyNetsCleared: true });
const override = byKey(downtimeCleared, "downtime.paper_fallback");
check("downtime + satisfied safety nets enables the break-glass override",
  override.disposition === "user_override" && override.reason.includes("safety nets satisfied"));
check("SAFETY: a user can ONLY ever act on a downtime override, nothing else",
  downtimeCleared.every((a) => a.disposition !== "user_override" || a.approval === "user_override_on_downtime"));

// an override action with NO configured safety nets fails closed even in downtime.
const noNetsFlow = { ...med, actions: [{ key: "x", label: "x", approval: "user_override_on_downtime" as const }] };
check("SAFETY: override with no configured safety nets is blocked",
  planFlowActions(noNetsFlow, "deny", { downtime: true, safetyNetsCleared: true })[0].disposition === "blocked");

// conflicting signal observations aggregate to the MOST RESTRICTIVE (fail closed).
const conflicting: SignalState[] = [
  { id: "identity", status: "healthy" }, { id: "device_compliance", status: "healthy" },
  { id: "badge_binding", status: "healthy" }, { id: "baseline", status: "broken" },
  { id: "baseline", status: "healthy" }, // a later healthy obs must NOT override the broken one
];
check("SAFETY: conflicting signal observations resolve to the most restrictive (broken)",
  evaluateFlowHealth(med, conflicting).status === "broken");
// An UNKNOWN status (untyped JSON, a drifted producer) is broken, never healthy — and it
// cannot mask a broken observed after it. Until 2026-09-05 `SIGNAL_SEVERITY[unknown]`
// was undefined, `3 > undefined` was false, and the unknown-first vector below graded
// the flow HEALTHY with no incident raised (verified before the fix: this exact vector
// took the suite from 32/32 to 31/32 once the assertion existed).
const unknownFirst: SignalState[] = [
  { id: "identity", status: "offline" as never }, { id: "identity", status: "broken" },
  { id: "device_compliance", status: "healthy" }, { id: "badge_binding", status: "healthy" }, { id: "baseline", status: "healthy" },
];
check("SAFETY: an unknown status observed FIRST does not mask a broken observed second", evaluateFlowHealth(med, unknownFirst).status === "broken");
const unknownOnly: SignalState[] = [
  { id: "identity", status: "offline" as never },
  { id: "device_compliance", status: "healthy" }, { id: "badge_binding", status: "healthy" }, { id: "baseline", status: "healthy" },
];
const unknownHealth = evaluateFlowHealth(med, unknownOnly);
check("SAFETY: an unknown status on a required signal BREAKS the flow (named in brokenSignals), never healthy",
  unknownHealth.status === "broken" && unknownHealth.brokenSignals.includes("identity"));
check("SAFETY: a prototype-key status (\"toString\") is unknown, not a severity", evaluateFlowHealth(med, [{ id: "identity", status: "toString" as never }, ...unknownOnly.slice(1)]).status === "broken");

// ── grid intelligence: more signals ⇒ smarter ────────────────────────────────
const few = gridIntelligence(DEMO_FLOWS, healthy(["identity"]));
const allSignals = [...new Set(DEMO_FLOWS.flatMap((f) => f.requiredSignals))];
const many = gridIntelligence(DEMO_FLOWS, healthy(allSignals));
check("more healthy signals raises the smartness score", many.smartnessScore > few.smartnessScore);
check("smartness score is bounded 0..100", many.smartnessScore <= 100 && few.smartnessScore >= 0);
check("full-signal coverage makes every flow healthy", many.flowsHealthy === DEMO_FLOWS.length);

// ── determinism ───────────────────────────────────────────────────────────────
check("resolution is deterministic", JSON.stringify(resolveFlowBreak(net, netBroken, NOW)) === JSON.stringify(resolveFlowBreak(net, netBroken, NOW)));

const total = passed + failures.length;
console.log(`Flows proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Admin flow layer verified (config-driven approvals, health→self-heal/incident, more-signals-smarter).");
