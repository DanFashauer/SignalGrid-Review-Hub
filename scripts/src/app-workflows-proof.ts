// Proof: application-workflow gating (@workspace/app-workflows).
//
// The same Assist model as the physical orchestration, now over APP actions:
//   • deny blocks every action; restrict blocks gated actions but permits
//     low-risk ones; step-up holds gated actions; allow auto-runs only
//     non-sensitive actions and holds sensitive ones for human confirmation.
//   • confirming assist actions applies them; confirming all → proceed.
//   • a satisfied step-up releases held actions.
//   • per-vertical confirmation language (clinician / supervisor / dispatcher).
//   • END TO END: the REAL decision core gates a nurse's EMR + BCMA sessions.
//
// Run: pnpm --filter @workspace/scripts run proof:app-workflows

import { SignalGridCore } from "@workspace/signalgrid-core";
import {
  planAppSession,
  confirmAppActions,
  completeAppStepUp,
  gateAppAction,
  listAppIntegrations,
  findAppIntegration,
  APP_INTEGRATIONS,
  type AppPlanInput,
} from "@workspace/app-workflows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const emr = findAppIntegration("emr-chart")!;
const bcma = findAppIntegration("bcma")!;
const base = (outcome: AppPlanInput["outcome"], reasonCodes: string[] = []): AppPlanInput => ({
  integration: emr, outcome, reasonCodes,
});

// ── catalog integrity ─────────────────────────────────────────────────────────
check("catalog spans six verticals", new Set(APP_INTEGRATIONS.map((i) => i.vertical)).size === 6);
check("every action has a stable key + risk tier", APP_INTEGRATIONS.every((i) => i.actions.every((x) => x.key && x.riskTier)));
check("critical actions are always sensitive", APP_INTEGRATIONS.every((i) => i.actions.every((x) => x.riskTier !== "critical" || x.sensitive)));
check("healthcare integrations exist (EMR/BCMA/messaging/alarms)", listAppIntegrations("healthcare").length >= 4);

// ── allow: sensitive held, non-sensitive auto ────────────────────────────────
const allow = planAppSession(base("allow"));
check("allow mode is assist (EMR has sensitive actions)", allow.mode === "assist");
check("allow: place-order is assist (sensitive), not auto",
  allow.actions.find((x) => x.key === "order.place")?.disposition === "assist");
check("allow: document-note (standard) is auto",
  allow.actions.find((x) => x.key === "note.document")?.disposition === "auto");
check("SAFETY: no sensitive app action is ever auto on allow",
  APP_INTEGRATIONS.every((i) => planAppSession({ integration: i, outcome: "allow", reasonCodes: [] })
    .actions.every((x) => !(x.sensitive && x.disposition === "auto"))));

// ── deny / restrict / step_up ─────────────────────────────────────────────────
const deny = planAppSession(base("deny", ["IDENTITY_DISABLED"]));
check("deny blocks every app action", deny.mode === "deny" && deny.actions.every((x) => x.disposition === "blocked"));
check("deny surfaces the reason code", deny.actions[0].reason.includes("IDENTITY_DISABLED"));

const restrict = planAppSession(base("restrict", ["DEVICE_NONCOMPLIANT"]));
check("restrict mode is hold", restrict.mode === "hold");
check("restrict blocks a gated write (place order)", restrict.actions.find((x) => x.key === "order.place")?.disposition === "blocked");
const alarms = findAppIntegration("alarms")!;
const restrictAlarms = planAppSession({ integration: alarms, outcome: "restrict", reasonCodes: [] });
check("restrict still permits a low-risk action (alarm route, non-gated)",
  restrictAlarms.actions.find((x) => x.key === "alarm.route")?.disposition === "auto");

const stepUp = planAppSession(base("step_up", ["BASELINE_DRIFTED"]));
check("step_up mode is step_up", stepUp.mode === "step_up");
check("step_up holds a gated action (open chart)", stepUp.actions.find((x) => x.key === "chart.open")?.disposition === "step_up");

// ── confirm flow ──────────────────────────────────────────────────────────────
const sensitiveKeys = allow.actions.filter((x) => x.disposition === "assist").map((x) => x.key);
const partial = confirmAppActions(base("allow"), [sensitiveKeys[0]]);
check("confirming one assist applies it", partial.actions.find((x) => x.key === sensitiveKeys[0])?.disposition === "applied");
check("confirming one of several stays assist", partial.mode === "assist");
const full = confirmAppActions(base("allow"), sensitiveKeys);
check("confirming all sensitive → mode proceed", full.mode === "proceed");
check("confirming all → no assist remains", full.actions.every((x) => x.disposition !== "assist"));

// ── step-up completion releases held actions ─────────────────────────────────
const su = base("step_up", ["BASELINE_DRIFTED"]);
const suDone = completeAppStepUp(su);
check("completeAppStepUp releases held actions (mode assist)", suDone.mode === "assist");
check("SAFETY: step-up completion never auto-runs a sensitive action",
  suDone.actions.every((x) => !(x.sensitive && x.disposition === "auto")));

// ── single-action gate ────────────────────────────────────────────────────────
check("gateAppAction returns one action's disposition",
  gateAppAction(base("allow"), "order.place")?.disposition === "assist");
check("gateAppAction returns null for an unknown action", gateAppAction(base("allow"), "nope") === null);

// ── per-vertical confirmation language ───────────────────────────────────────
const wms = findAppIntegration("wms")!;
const tms = findAppIntegration("tms-dispatch")!;
const pos = findAppIntegration("pos")!;
check("warehouse plan names the supervisor",
  planAppSession({ integration: wms, outcome: "allow", reasonCodes: [] }).summary.includes("supervisor") ||
  planAppSession({ integration: wms, outcome: "allow", reasonCodes: [] }).actions.some((x) => x.reason.includes("supervisor")));
check("fleet plan names the dispatcher",
  planAppSession({ integration: tms, outcome: "allow", reasonCodes: [] }).actions.some((x) => x.reason.includes("dispatcher")) ||
  planAppSession({ integration: tms, outcome: "allow", reasonCodes: [] }).summary.includes("dispatcher"));
check("retail plan names the manager",
  planAppSession({ integration: pos, outcome: "allow", reasonCodes: [] }).actions.some((x) => x.reason.includes("manager")));
check("healthcare plan names the clinician",
  allow.actions.some((x) => x.reason.includes("clinician")));

// ── data-center / NOC (P5): uptime is the north star ─────────────────────────
// The whole point of this vertical is that uptime-affecting actions must never
// run from an unverified context. Assert the highest-risk actions stay held.
const netcfg = findAppIntegration("network-config")!;
const power = findAppIntegration("power-pdu")!;
const compute = findAppIntegration("compute-orchestration")!;
check("data-center vertical is in the catalog", listAppIntegrations("data_center").length === 6);
check("NOC plan names the shift lead",
  planAppSession({ integration: netcfg, outcome: "allow", reasonCodes: [] }).actions.some((x) => x.reason.includes("shift lead")));
check("SAFETY: config push to a core device is never auto on allow (held for shift lead)",
  planAppSession({ integration: netcfg, outcome: "allow", reasonCodes: [] }).actions.find((x) => x.key === "config.push")?.disposition === "assist");
check("SAFETY: power-cycle a rack is blocked under restriction",
  planAppSession({ integration: power, outcome: "restrict", reasonCodes: ["DEVICE_NONCOMPLIANT"] }).actions.find((x) => x.key === "rack.powercycle")?.disposition === "blocked");
check("uptime read stays available under restriction (power draw, non-gated)",
  planAppSession({ integration: power, outcome: "restrict", reasonCodes: [] }).actions.find((x) => x.key === "draw.read")?.disposition === "auto");
check("SAFETY: trigger a failover is held for step-up when verification is required",
  planAppSession({ integration: compute, outcome: "step_up", reasonCodes: ["BASELINE_DRIFTED"] }).actions.find((x) => x.key === "failover.trigger")?.disposition === "step_up");
check("SAFETY: deny blocks every uptime-affecting action",
  planAppSession({ integration: compute, outcome: "deny", reasonCodes: ["IDENTITY_DISABLED"] }).actions.every((x) => x.disposition === "blocked"));
check("SAFETY: no critical NOC action is ever auto on allow (whole vertical)",
  listAppIntegrations("data_center").every((i) => planAppSession({ integration: i, outcome: "allow", reasonCodes: [] })
    .actions.every((x) => !(x.riskTier === "critical" && x.disposition === "auto"))));

// ── determinism ───────────────────────────────────────────────────────────────
check("plans are deterministic", JSON.stringify(planAppSession(base("allow"))) === JSON.stringify(planAppSession(base("allow"))));

// ── fail closed on a malformed / unrecognized outcome ────────────────────────
const malformed = planAppSession({ integration: emr, outcome: "sideways" as never, reasonCodes: [] });
check("SAFETY: unrecognized outcome fails closed (mode deny, all blocked)",
  malformed.mode === "deny" && malformed.actions.every((x) => x.disposition === "blocked"));
const malformedConfirmed = planAppSession({ integration: emr, outcome: "bogus" as never, reasonCodes: [], confirmedActionKeys: ["order.place"], stepUpSatisfied: true });
check("SAFETY: a caller-supplied confirmation/step-up cannot rescue a malformed outcome",
  malformedConfirmed.actions.every((x) => x.disposition === "blocked"));

// ── END TO END: the real decision core gates a nurse's app sessions ──────────
const core = SignalGridCore.demo();
const token = core.demoApiKeys().find((k) => k.tenantId === "tenant_northwind" && k.role === "operator")!.token;
function gateFor(integrationId: string, identityRef: string, deviceRef: string) {
  const integ = findAppIntegration(integrationId)!;
  const r = core.evaluate(token, { identityRef, deviceRef, workflowKey: integ.workflowKey });
  return { outcome: r.outcome, plan: planAppSession({ integration: integ, outcome: r.outcome, reasonCodes: r.reasonCodes }) };
}
const compliantEmr = gateFor("emr-chart", "nurse.compliant", "ipad-ward-01");
check("e2e: compliant nurse EMR session allows, sensitive order held for confirm",
  compliantEmr.outcome === "allow" &&
  compliantEmr.plan.actions.find((x) => x.key === "order.place")?.disposition === "assist");
const driftBcma = gateFor("bcma", "nurse.baseline_drift", "ipad-ward-06");
check("e2e: baseline-drift nurse BCMA session steps up (controlled admin held)",
  driftBcma.outcome === "step_up" &&
  driftBcma.plan.actions.find((x) => x.key === "controlled.administer")?.disposition === "step_up");
const disabledEmr = gateFor("emr-chart", "nurse.disabled", "ipad-ward-04");
check("e2e: disabled nurse EMR session denies every action",
  disabledEmr.outcome === "deny" && disabledEmr.plan.actions.every((x) => x.disposition === "blocked"));

const total = passed + failures.length;
console.log(`App-workflows proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Application-workflow gating verified (Assist model over app actions, real-core end to end).");
