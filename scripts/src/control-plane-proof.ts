// Proof: the SaaS control-plane scaffold (@workspace/control-plane).
//
// Verifies the cloud-side management contract from docs/DEPLOYMENT_MODELS.md
// on the deterministic fixture seed:
//   1. Seeded across five verticals (healthcare / warehouse / global fleet /
//      retail / industrial).
//   2. Tenant scoping — a tenant's site/node queries never leak another tenant.
//   3. Policy-bundle checksum is deterministic (config-down integrity).
//   4. Sync plan detects behind vs up-to-date edge nodes.
//   5. Telemetry ingest (up) changes the health rollup.
//   6. Per-vertical health breakdown is correct.
//
// Run: pnpm --filter @workspace/scripts run proof:control-plane

import { ControlPlane, verifyBundleSignature } from "@workspace/control-plane";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(name);
}

function main() {
  const cp = ControlPlane.demo();

  // 1. Five verticals.
  const tenants = cp.listTenants();
  const verticals = new Set(tenants.map((t) => t.vertical));
  check("seeded with 5 tenants", tenants.length === 5);
  check("covers healthcare + warehouse + global_fleet", verticals.has("healthcare") && verticals.has("warehouse") && verticals.has("global_fleet"));
  check("covers retail + industrial", verticals.has("retail") && verticals.has("industrial"));

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
  check("policy bundle is signed and verifies", !!b1 && verifyBundleSignature(b1));

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
  const retail = health.byVertical.find((v) => v.vertical === "retail");
  const industrial = health.byVertical.find((v) => v.vertical === "industrial");
  check("fleet health spans all five verticals", health.byVertical.length === 5);
  check("healthcare vertical has multiple sites", (healthcare?.sites ?? 0) >= 2);
  check("warehouse vertical has devices", (warehouse?.devices ?? 0) > 0);
  check("retail vertical has devices", (retail?.devices ?? 0) > 0);
  check("industrial vertical has devices", (industrial?.devices ?? 0) > 0);
  check("edge health counts are sane", health.edgeHealthy <= health.edgeNodes && health.devicesOnline <= health.devices);

  // 7. Operational-intelligence rollup (Phase 3).
  // Push a high-friction batch into a known node and confirm it surfaces.
  cp.ingestTelemetry({ nodeId: "edge_atlas_dc7", windowMins: 1440, decisions: 1000, allow: 400, stepUp: 300, restrict: 200, deny: 100 });
  const ops = cp.operationalIntelligence();
  const atlasHot = ops.hotspots.find((h) => h.nodeId === "edge_atlas_dc7");
  check("ops rollup surfaces the high-friction node as a hotspot", !!atlasHot && atlasHot.frictionRate === 0.6);
  check("ops hotspots are sorted worst-friction first", ops.hotspots.every((h, i) => i === 0 || ops.hotspots[i - 1].frictionRate >= h.frictionRate));
  check("ops rollup flags the behind node as posture drift", ops.postureDrift.some((d) => d.nodeId === "edge_atlas_dc7" && d.behindBy > 0));
  check("ops custody gaps only list non-healthy or stale-sync nodes", ops.custodyGaps.every((g) => g.status !== "healthy" || g.lastSyncMinsAgo > 60));
  check("ops summary counts are consistent", ops.summary.driftCount === ops.postureDrift.length && ops.summary.gapCount === ops.custodyGaps.length && ops.summary.hotspotCount <= ops.hotspots.length);
  const nwOps = cp.operationalIntelligence("tenant_northwind");
  check("ops rollup is tenant-scoped (no atlas node under northwind)", nwOps.hotspots.every((h) => h.nodeId !== "edge_atlas_dc7") && nwOps.postureDrift.every((d) => d.nodeId !== "edge_atlas_dc7"));

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
