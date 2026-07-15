// Proof: telemetry UP from the decision plane to the control plane.
//
// Wires the two planes end to end: the decision core (@workspace/signalgrid-core)
// produces REAL decisions; the edge tallies them into a telemetry batch
// (aggregateOutcomes) and reports it UP; the control plane ingests it and the
// fleet-health rollup reflects the real counts. Raw decisions never leave the
// edge — only aggregate counts travel.
//
//   1. The core produces real, varied outcomes (not a stub).
//   2. Aggregation tallies every decision; components sum to the total.
//   3. Ingesting the batch makes the control-plane rollup reflect the counts.
//   4. The per-vertical rollup reflects it too.
//
// Run: pnpm --filter @workspace/scripts run proof:telemetry-up

import { SignalGridCore } from "@workspace/signalgrid-core";
import { ControlPlane, aggregateOutcomes, type DecisionOutcomeLabel } from "@workspace/control-plane";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(name);
}

function main() {
  const core = SignalGridCore.demo();
  const cp = ControlPlane.demo();
  const TOKEN = "sgk_demo_northwind_operator";

  // Run a batch of real evaluations against the decision core.
  const requests: Array<[string, string, string]> = [
    ["nurse.compliant", "ipad-ward-01", "med-admin"],
    ["nurse.compliant", "ipad-ward-01", "clinical-session"],
    ["nurse.compliant", "ipad-ward-01", "general-lookup"],
    ["nurse.noncompliant", "ipad-ward-02", "med-admin"],
    ["nurse.disabled", "ipad-ward-04", "med-admin"],
    ["nurse.badge_removed", "ipad-badge-01", "clinical-session"],
    ["nurse.tamper", "ipad-loan-02", "med-admin"],
  ];
  const outcomes = requests.map(
    ([identityRef, deviceRef, workflowKey]) =>
      core.evaluate(TOKEN, { identityRef, deviceRef, workflowKey }).outcome as DecisionOutcomeLabel,
  );

  check("core produced a decision per request", outcomes.length === requests.length);
  check("core produced real, varied outcomes", new Set(outcomes).size >= 2);

  // The edge tallies its decisions and reports UP.
  const batch = aggregateOutcomes("edge_nw_general", outcomes);
  const manual = { allow: 0, step_up: 0, restrict: 0, deny: 0 };
  for (const o of outcomes) manual[o] += 1;

  check("batch counts every decision", batch.decisions === outcomes.length);
  check("batch components sum to the total", batch.allow + batch.stepUp + batch.restrict + batch.deny === batch.decisions);
  check("aggregation matches the outcomes", batch.allow === manual.allow && batch.stepUp === manual.step_up && batch.restrict === manual.restrict && batch.deny === manual.deny);

  // Ingest UP. Zero the other northwind node so the tenant rollup equals this
  // batch exactly (deterministic assertion).
  cp.ingestTelemetry(batch);
  cp.ingestTelemetry(aggregateOutcomes("edge_nw_childrens", []));

  const health = cp.fleetHealth("tenant_northwind");
  check("control-plane rollup reflects the ingested telemetry", health.decisions === batch.decisions);
  const healthcare = health.byVertical.find((v) => v.vertical === "healthcare");
  check("per-vertical rollup reflects it", healthcare?.decisions === batch.decisions);

  const total = passed + failures.length;
  console.log(`Telemetry-up proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Decision-plane → control-plane telemetry wiring confirmed (real decisions, aggregate up, rollup reflects).");
}

main();
