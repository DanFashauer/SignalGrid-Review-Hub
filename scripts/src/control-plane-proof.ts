// Proof: the SaaS control-plane scaffold (@workspace/control-plane).
//
// Verifies the cloud-side management contract from docs/DEPLOYMENT_MODELS.md
// on the deterministic fixture seed:
//   1. Seeded across three verticals (healthcare / warehouse / global fleet).
//   2. Tenant scoping — a tenant's site/node queries never leak another tenant.
//   3. Policy-bundle checksum is deterministic (config-down integrity).
//   4. Sync plan detects behind vs up-to-date edge nodes.
//   5. Telemetry ingest (up) changes the health rollup.
//   6. Per-vertical health breakdown is correct.
//
// Run: pnpm --filter @workspace/scripts run proof:control-plane

import { ControlPlane } from "@workspace/control-plane";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(name);
}

function main() {
  const cp = ControlPlane.demo();

  // 1. Three verticals.
  const tenants = cp.listTenants();
  const verticals = new Set(tenants.map((t) => t.vertical));
  check("seeded with 3 tenants", tenants.length === 3);
  check("covers healthcare + warehouse + global_fleet", verticals.has("healthcare") && verticals.has("warehouse") && verticals.has("global_fleet"));

  // 2. Tenant scoping — no cross-tenant leakage.
  const nwSites = cp.listSites("tenant_northwind");
  check("tenant site scoping returns only that tenant's sites", nwSites.length > 0 && nwSites.every((s) => s.tenantId === "tenant_northwind"));
  const nwNodes = cp.listEdgeNodes("tenant_northwind");
  const nwSiteIds = new Set(nwSites.map((s) => s.id));
  check("tenant edge-node scoping stays within the tenant", nwNodes.length > 0 && nwNodes.every((n) => nwSiteIds.has(n.siteId)));
  check("another tenant's sites are excluded", !cp.listSites("tenant_northwind").some((s) => s.tenantId === "tenant_atlas"));

  // 3. Deterministic policy-bundle checksum.
  const b1 = cp.getPolicyBundle("tenant_northwind");
  const b2 = cp.getPolicyBundle("tenant_northwind");
  check("policy bundle resolves", b1 !== null);
  check("policy-bundle checksum is deterministic", !!b1 && !!b2 && b1.checksum === b2.checksum);
  check("different tenants get different bundles", cp.getPolicyBundle("tenant_atlas")?.checksum !== b1?.checksum);

  // 4. Sync plan: behind vs up-to-date.
  const behind = cp.syncPlan("edge_atlas_dc7"); // bundleVersion 3 < target 4
  const current = cp.syncPlan("edge_nw_general"); // bundleVersion 7 == target 7
  check("edge node behind target reports updateAvailable", behind?.updateAvailable === true);
  check("up-to-date edge node reports no update", current?.updateAvailable === false);
  check("unknown node yields no sync plan", cp.syncPlan("edge_nope") === null);

  // 5. Telemetry ingest changes the rollup.
  const before = cp.fleetHealth("tenant_northwind").decisions;
  cp.ingestTelemetry({ nodeId: "edge_nw_general", windowMins: 1440, decisions: 999999, allow: 800000, stepUp: 100000, restrict: 60000, deny: 39999 });
  const after = cp.fleetHealth("tenant_northwind").decisions;
  check("telemetry ingest updates the health rollup", after !== before && after >= 999999);

  // 6. Per-vertical breakdown.
  const health = cp.fleetHealth();
  const healthcare = health.byVertical.find((v) => v.vertical === "healthcare");
  const warehouse = health.byVertical.find((v) => v.vertical === "warehouse");
  check("fleet health spans all verticals", health.byVertical.length === 3);
  check("healthcare vertical has multiple sites", (healthcare?.sites ?? 0) >= 2);
  check("warehouse vertical has devices", (warehouse?.devices ?? 0) > 0);
  check("edge health counts are sane", health.edgeHealthy <= health.edgeNodes && health.devicesOnline <= health.devices);

  const total = passed + failures.length;
  console.log(`Control-plane proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Cloud control-plane contract confirmed (tenants, scoping, config-down, telemetry-up, health).");
}

main();
