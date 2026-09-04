// Proof: the SaaS control-plane scaffold (@workspace/control-plane).
//
// Verifies the cloud-side management contract from docs/DEPLOYMENT_MODELS.md
// on the deterministic fixture seed:
//   1. Seeded across six verticals (healthcare / warehouse / global fleet /
//      retail / industrial / data-center-NOC).
//   2. Tenant scoping — a tenant's site/node queries never leak another tenant.
//   3. Policy-bundle checksum is deterministic (config-down integrity).
//   4. Sync plan detects behind vs up-to-date edge nodes.
//   5. Telemetry ingest (up) changes the health rollup.
//   6. Per-vertical health breakdown is correct.
//
// Run: pnpm --filter @workspace/scripts run proof:control-plane

import { ControlPlane, verifyBundleSignature, verifyBundleChecksum } from "@workspace/control-plane";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(name);
}

function main() {
  const cp = ControlPlane.demo();

  // 1. Six verticals.
  const tenants = cp.listTenants();
  const verticals = new Set(tenants.map((t) => t.vertical));
  check("seeded with 6 tenants", tenants.length === 6);
  check("covers healthcare + warehouse + global_fleet", verticals.has("healthcare") && verticals.has("warehouse") && verticals.has("global_fleet"));
  check("covers retail + industrial + data_center", verticals.has("retail") && verticals.has("industrial") && verticals.has("data_center"));

  // 2. Tenant scoping — no cross-tenant leakage.
  const nwSites = cp.listSites("tenant_northwind");
  check("tenant site scoping returns only that tenant's sites", nwSites.length > 0 && nwSites.every((s) => s.tenantId === "tenant_northwind"));
  const nwNodes = cp.listEdgeNodes("tenant_northwind");
  const nwSiteIds = new Set(nwSites.map((s) => s.id));
  check("tenant edge-node scoping stays within the tenant", nwNodes.length > 0 && nwNodes.every((n) => nwSiteIds.has(n.siteId)));
  check("another tenant's sites are excluded", !cp.listSites("tenant_northwind").some((s) => s.tenantId === "tenant_atlas"));

  // 2b. An EMPTY scope is not a wildcard (Finding 3, 2026-09-04). `undefined` = no
  // scope given ⇒ everything (the admin fleet view); "" or whitespace-only = an
  // UNRESOLVED scope ⇒ nothing, so a caller that derived a tenant/site id and
  // forgot to check it for emptiness gets no rows rather than every tenant's data.
  // The pre-fix `!tenantId` / `!siteId` filters treated "" identically to undefined;
  // these assertions fail if that wildcard behavior returns.
  check("undefined tenant scope returns all sites", cp.listSites(undefined).length === cp.listSites().length && cp.listSites().length > nwSites.length);
  check("empty-string tenant scope returns NO sites (not a wildcard)", cp.listSites("").length === 0);
  check("whitespace-only tenant scope returns NO sites", cp.listSites("   ").length === 0);
  check("empty-string tenant scope returns NO edge nodes", cp.listEdgeNodes("").length === 0);
  check("undefined site scope returns all fleet devices", cp.listFleet(undefined).length === cp.listFleet().length && cp.listFleet().length > 0);
  check("empty-string site scope returns NO fleet devices", cp.listFleet("").length === 0);
  check("undefined tenant scope in fleetHealth spans all six verticals", cp.fleetHealth(undefined).byVertical.length === 6);
  check("empty-string tenant scope in fleetHealth yields no tenants", cp.fleetHealth("").byVertical.length === 0);
  const emptyOps = cp.operationalIntelligence("");
  check("empty-string tenant scope in operationalIntelligence yields nothing", emptyOps.hotspots.length === 0 && emptyOps.postureDrift.length === 0 && emptyOps.custodyGaps.length === 0);

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
  const dataCenter = health.byVertical.find((v) => v.vertical === "data_center");
  check("fleet health spans all six verticals", health.byVertical.length === 6);
  check("healthcare vertical has multiple sites", (healthcare?.sites ?? 0) >= 2);
  check("warehouse vertical has devices", (warehouse?.devices ?? 0) > 0);
  check("retail vertical has devices", (retail?.devices ?? 0) > 0);
  check("industrial vertical has devices", (industrial?.devices ?? 0) > 0);
  check("data_center vertical has devices", (dataCenter?.devices ?? 0) > 0);
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

  // 8. Bundle authenticity fails closed on tampering.
  // A valid signed bundle verifies on both integrity (checksum) and
  // authenticity (signature); mutating its content or corrupting its signature
  // must make the edge node refuse it.
  const good = cp.getPolicyBundle("tenant_northwind");
  check("pristine bundle passes checksum (integrity)", !!good && verifyBundleChecksum(good));
  check("pristine bundle passes signature (authenticity)", !!good && verifyBundleSignature(good));

  // Mutate the workflows but keep the advertised checksum/signature — the
  // classic config-tampering attack. Both checks must fail closed.
  const tamperedWorkflows = { ...good!, workflows: [...good!.workflows, "exfiltrate-phi"] };
  check("tampered workflows fail the checksum (fail closed)", !verifyBundleChecksum(tamperedWorkflows));
  check("tampered workflows fail the signature (fail closed)", !verifyBundleSignature(tamperedWorkflows));

  // Flip one hex char of the signature — content (and thus checksum) is intact,
  // but authenticity is broken: signature must fail, checksum still passes.
  const flipHex = (c: string) => (c === "0" ? "1" : "0");
  const forgedSig = { ...good!, signature: flipHex(good!.signature[0]) + good!.signature.slice(1) };
  check("signature-only forgery still passes checksum (integrity intact)", verifyBundleChecksum(forgedSig));
  check("signature-only forgery fails the signature (authenticity broken)", !verifyBundleSignature(forgedSig));

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
