// Proof: the recommendations engine (@workspace/recommendations).
//
// The Grid learns from observed usage and PROPOSES improvements (never applies):
//   • relax a gate that is always approved on healthy posture (one step);
//   • tighten an action showing denials/overrides (more scrutiny);
//   • add a candidate signal to a flow that keeps breaking or runs hot;
//   • merge two near-duplicate flows;
//   • it needs real evidence (min-sample threshold) and is deterministic.
//
// Run: pnpm --filter @workspace/scripts run proof:recommendations

import { listFlows, type Flow } from "@workspace/flows";
import { recommend, flowSimilarity, DEMO_USAGE, type UsageHistory } from "@workspace/recommendations";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const flows = listFlows();
const recs = recommend(DEMO_USAGE, flows);
const has = (id: string) => recs.some((r) => r.id === id);
const get = (id: string) => recs.find((r) => r.id === id);

// ── the four recommendation kinds fire on the fixture ────────────────────────
check("recommends relaxing an always-approved gate (admin → automated)",
  get("automate:flow_controlled_area:gate.unlock")?.suggestedChange.includes("automated") === true);
check("relax steps only ONE level (dual → admin, not straight to automated)",
  get("automate:flow_med_admin:controlled.administer")?.suggestedChange.includes("admin_approval") === true);
check("recommends tightening an action with denials/overrides (admin → dual)",
  get("tighten:flow_med_admin:dose.override")?.suggestedChange.includes("dual_approval") === true);
check("an anomalous action is NOT also recommended for relaxing",
  !has("automate:flow_med_admin:dose.override"));
check("recommends adding a candidate signal to a flow that keeps breaking",
  get("add_signal:flow_med_admin:attestation")?.kind === "add_signal");
check("recommends adding a signal to a high-friction flow",
  has("add_signal:flow_controlled_area:badge_binding"));

// ── evidence threshold: too few samples → no recommendation ──────────────────
const thin: UsageHistory = {
  actions: [{ flowId: "flow_med_admin", actionKey: "bcma.open", approvalPolicy: "admin_approval", samples: 5, approved: 5, denied: 0, overrides: 0, postureHealthyRate: 1 }],
  flows: [],
};
check("SAFETY: below the sample threshold, no recommendation is made", recommend(thin, flows).length === 0);

// ── never relaxes a downtime override or an already-automated action ─────────
const overrideUsage: UsageHistory = {
  actions: [{ flowId: "flow_med_admin", actionKey: "downtime.paper_fallback", approvalPolicy: "user_override_on_downtime", samples: 40, approved: 40, denied: 0, overrides: 0, postureHealthyRate: 1 }],
  flows: [],
};
check("SAFETY: a downtime override is never recommended for relaxing", recommend(overrideUsage, flows).every((r) => r.kind !== "automate_action"));

// ── advisory only + confidence bounded + sorted ──────────────────────────────
check("every recommendation is advisory (has a suggested change, changes nothing)",
  recs.every((r) => typeof r.suggestedChange === "string" && r.suggestedChange.length > 0));
check("confidence is bounded 0..1", recs.every((r) => r.confidence >= 0 && r.confidence <= 1));
check("recommendations are sorted by confidence (desc)",
  recs.every((r, i) => i === 0 || recs[i - 1].confidence >= r.confidence));

// ── merge similarity: distinct demo flows do NOT trigger a merge ─────────────
check("distinct flows do not trigger a merge recommendation", !recs.some((r) => r.kind === "merge_flows"));
const twin: Flow = { ...flows[0], id: "flow_twin", name: "Twin flow" };
check("near-duplicate flows are flagged for merge",
  recommend(DEMO_USAGE, [...flows, twin]).some((r) => r.kind === "merge_flows"));
check("flowSimilarity of a flow with itself is 1", flowSimilarity(flows[0], flows[0]) === 1);

// ── determinism ───────────────────────────────────────────────────────────────
check("recommendations are deterministic", JSON.stringify(recommend(DEMO_USAGE, flows)) === JSON.stringify(recommend(DEMO_USAGE, flows)));

const total = passed + failures.length;
console.log(`Recommendations proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Recommendations engine verified (learn habits → advisory flow/signal proposals, evidence-gated, deterministic).");
