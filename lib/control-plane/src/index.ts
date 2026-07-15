/**
 * @workspace/control-plane — the SaaS **cloud control plane** scaffold.
 *
 * This is the "manage the whole fleet from one place" half of the hybrid
 * architecture in docs/DEPLOYMENT_MODELS.md: tenants, sites, edge nodes (the
 * local decision planes), fleet devices, policy-bundle distribution (config
 * DOWN), and telemetry ingest (metrics UP). The **decision** still happens in
 * the local decision plane (@workspace/signalgrid-core); the control plane never
 * decides — it distributes config and aggregates health.
 *
 * Everything here is deterministic and fixture-backed: no database, no clock, no
 * randomness, no live calls. It is seeded across THREE verticals — a hospital, a
 * warehouse, and a global mobile fleet — to show the same engine managing very
 * different frontlines from one plane.
 */

// ── deterministic checksum (FNV-1a, dependency-free, browser-safe) ───────────

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical checksum over a bundle's content (tenant + version + workflows). */
function bundleChecksum(tenantId: string, version: number, workflows: string[]): string {
  return fnv1a(`${tenantId}:${version}:${workflows.join(",")}`);
}

/**
 * Recompute a bundle's checksum from its content and compare to the advertised
 * checksum — the integrity check an edge node runs before applying config it
 * pulled DOWN. Returns false (fail closed) on any mismatch or tampering.
 */
export function verifyBundleChecksum(bundle: PolicyBundle): boolean {
  return bundleChecksum(bundle.tenantId, bundle.version, bundle.workflows) === bundle.checksum;
}

// ── domain model ─────────────────────────────────────────────────────────────

export type Vertical = "healthcare" | "warehouse" | "global_fleet";
export type Tier = "dev" | "alpha" | "beta" | "prod";
export type EdgeStatus = "healthy" | "degraded" | "unreachable";
export type DeviceKind = "tablet" | "dock" | "badge_reader" | "rugged_scanner" | "vehicle_mount";

export interface Tenant {
  id: string;
  name: string;
  vertical: Vertical;
  tier: Tier;
}

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  region: string;
}

/** A local decision plane (edge / on-prem deployment) reporting to the control plane. */
export interface EdgeNode {
  id: string;
  siteId: string;
  coreVersion: string;
  bundleVersion: number; // policy bundle this node currently runs
  status: EdgeStatus;
  lastSyncMinsAgo: number;
}

export interface FleetDevice {
  id: string;
  siteId: string;
  kind: DeviceKind;
  online: boolean;
  lastSeenMinsAgo: number;
}

/** The config pushed DOWN to a tenant's edge nodes. */
export interface PolicyBundle {
  tenantId: string;
  version: number;
  workflows: string[];
  checksum: string;
}

/** A telemetry batch reported UP by an edge node. */
export interface TelemetryBatch {
  nodeId: string;
  windowMins: number;
  decisions: number;
  allow: number;
  stepUp: number;
  restrict: number;
  deny: number;
}

export interface FleetHealth {
  tenants: number;
  sites: number;
  edgeNodes: number;
  edgeHealthy: number;
  devices: number;
  devicesOnline: number;
  decisions: number;
  byVertical: Array<{ vertical: Vertical; sites: number; devices: number; decisions: number }>;
}

export interface SyncPlan {
  nodeId: string;
  currentBundleVersion: number;
  targetBundleVersion: number;
  updateAvailable: boolean;
  checksum: string;
}

// ── seed: three verticals, one plane ─────────────────────────────────────────

interface Seed {
  tenants: Tenant[];
  sites: Site[];
  nodes: EdgeNode[];
  devices: FleetDevice[];
  bundles: Map<string, { version: number; workflows: string[] }>;
  telemetry: Map<string, TelemetryBatch>; // by nodeId
}

function buildSeed(): Seed {
  const tenants: Tenant[] = [
    { id: "tenant_northwind", name: "Northwind Health", vertical: "healthcare", tier: "beta" },
    { id: "tenant_atlas", name: "Atlas Logistics", vertical: "warehouse", tier: "alpha" },
    { id: "tenant_meridian", name: "Meridian Field Ops", vertical: "global_fleet", tier: "alpha" },
  ];

  const sites: Site[] = [
    { id: "site_nw_general", tenantId: "tenant_northwind", name: "Northwind General Hospital", region: "us-east" },
    { id: "site_nw_childrens", tenantId: "tenant_northwind", name: "Northwind Children's", region: "us-east" },
    { id: "site_atlas_dc7", tenantId: "tenant_atlas", name: "Atlas DC-7", region: "us-central" },
    { id: "site_mer_euw", tenantId: "tenant_meridian", name: "Meridian EU-West", region: "eu-west" },
    { id: "site_mer_apac", tenantId: "tenant_meridian", name: "Meridian APAC", region: "ap-southeast" },
  ];

  const nodes: EdgeNode[] = [
    { id: "edge_nw_general", siteId: "site_nw_general", coreVersion: "1.4.0", bundleVersion: 7, status: "healthy", lastSyncMinsAgo: 2 },
    { id: "edge_nw_childrens", siteId: "site_nw_childrens", coreVersion: "1.4.0", bundleVersion: 6, status: "healthy", lastSyncMinsAgo: 4 },
    { id: "edge_atlas_dc7", siteId: "site_atlas_dc7", coreVersion: "1.4.0", bundleVersion: 3, status: "degraded", lastSyncMinsAgo: 21 },
    { id: "edge_mer_euw", siteId: "site_mer_euw", coreVersion: "1.3.2", bundleVersion: 5, status: "healthy", lastSyncMinsAgo: 6 },
    { id: "edge_mer_apac", siteId: "site_mer_apac", coreVersion: "1.3.2", bundleVersion: 5, status: "unreachable", lastSyncMinsAgo: 143 },
  ];

  // A compact fleet across verticals — hospital iPads/docks/badge readers,
  // warehouse rugged scanners, global-fleet tablets + vehicle mounts.
  const devicePlan: Array<[string, DeviceKind, number, number]> = [
    // [siteId, kind, count, onlineCount]
    ["site_nw_general", "tablet", 48, 46],
    ["site_nw_general", "dock", 24, 24],
    ["site_nw_general", "badge_reader", 24, 23],
    ["site_nw_childrens", "tablet", 20, 19],
    ["site_nw_childrens", "dock", 10, 10],
    ["site_atlas_dc7", "rugged_scanner", 140, 132],
    ["site_atlas_dc7", "dock", 40, 38],
    ["site_mer_euw", "tablet", 60, 55],
    ["site_mer_euw", "vehicle_mount", 30, 27],
    ["site_mer_apac", "tablet", 40, 31],
    ["site_mer_apac", "vehicle_mount", 20, 12],
  ];
  const devices: FleetDevice[] = [];
  for (const [siteId, kind, count, online] of devicePlan) {
    for (let i = 0; i < count; i++) {
      devices.push({
        id: `${siteId}:${kind}:${String(i).padStart(3, "0")}`,
        siteId,
        kind,
        online: i < online,
        lastSeenMinsAgo: i < online ? (i % 12) : 60 + (i % 240),
      });
    }
  }

  const bundles = new Map<string, { version: number; workflows: string[] }>([
    ["tenant_northwind", { version: 7, workflows: ["general-lookup", "clinical-session", "med-admin"] }],
    ["tenant_atlas", { version: 4, workflows: ["general-lookup", "pick-pack", "controlled-area"] }],
    ["tenant_meridian", { version: 5, workflows: ["general-lookup", "field-session", "vehicle-checkout"] }],
  ]);

  // Deterministic per-node telemetry (shift-shaped-ish, fixed).
  const telemetry = new Map<string, TelemetryBatch>();
  const telePlan: Array<[string, number]> = [
    ["edge_nw_general", 4200],
    ["edge_nw_childrens", 1400],
    ["edge_atlas_dc7", 9800],
    ["edge_mer_euw", 3600],
    ["edge_mer_apac", 1500],
  ];
  for (const [nodeId, decisions] of telePlan) {
    telemetry.set(nodeId, {
      nodeId,
      windowMins: 1440,
      decisions,
      allow: Math.round(decisions * 0.82),
      stepUp: Math.round(decisions * 0.1),
      restrict: Math.round(decisions * 0.05),
      deny: Math.round(decisions * 0.03),
    });
  }

  return { tenants, sites, nodes, devices, bundles, telemetry };
}

// ── the control plane ────────────────────────────────────────────────────────

export class ControlPlane {
  private constructor(private readonly seed: Seed) {}

  static demo(): ControlPlane {
    return new ControlPlane(buildSeed());
  }

  listTenants(): Tenant[] {
    return [...this.seed.tenants];
  }

  listSites(tenantId?: string): Site[] {
    return this.seed.sites.filter((s) => !tenantId || s.tenantId === tenantId);
  }

  listEdgeNodes(tenantId?: string): EdgeNode[] {
    const siteIds = new Set(this.listSites(tenantId).map((s) => s.id));
    return this.seed.nodes.filter((n) => siteIds.has(n.siteId));
  }

  listFleet(siteId?: string): FleetDevice[] {
    return this.seed.devices.filter((d) => !siteId || d.siteId === siteId);
  }

  /** The config bundle to push DOWN to a tenant's edge nodes. */
  getPolicyBundle(tenantId: string): PolicyBundle | null {
    const b = this.seed.bundles.get(tenantId);
    if (!b) return null;
    return { tenantId, version: b.version, workflows: b.workflows, checksum: bundleChecksum(tenantId, b.version, b.workflows) };
  }

  /**
   * Apply the tenant's current bundle to an edge node (the node "pulled" the
   * config and verified it). Advances the node's bundleVersion to target and
   * returns the fresh sync plan. Idempotent; returns null for an unknown node.
   */
  applyBundle(nodeId: string): SyncPlan | null {
    const node = this.seed.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const site = this.seed.sites.find((s) => s.id === node.siteId);
    if (!site) return null;
    const bundle = this.getPolicyBundle(site.tenantId);
    if (!bundle) return null;
    if (node.bundleVersion < bundle.version) node.bundleVersion = bundle.version;
    return this.syncPlan(nodeId);
  }

  /** What an edge node should pull: whether its bundle is behind the target. */
  syncPlan(nodeId: string): SyncPlan | null {
    const node = this.seed.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const site = this.seed.sites.find((s) => s.id === node.siteId);
    if (!site) return null;
    const bundle = this.getPolicyBundle(site.tenantId);
    if (!bundle) return null;
    return {
      nodeId,
      currentBundleVersion: node.bundleVersion,
      targetBundleVersion: bundle.version,
      updateAvailable: node.bundleVersion < bundle.version,
      checksum: bundle.checksum,
    };
  }

  /**
   * Ingest a telemetry batch reported UP by an edge node. Returns the stored
   * batch (last-write-wins for the node's window). Pure/deterministic: the
   * caller supplies the numbers; no clock is read here.
   */
  ingestTelemetry(batch: TelemetryBatch): TelemetryBatch {
    this.seed.telemetry.set(batch.nodeId, batch);
    return batch;
  }

  /** Fleet-wide health rollup across every tenant, with a per-vertical breakdown. */
  fleetHealth(tenantId?: string): FleetHealth {
    const tenants = this.seed.tenants.filter((t) => !tenantId || t.id === tenantId);
    const tenantIds = new Set(tenants.map((t) => t.id));
    const sites = this.seed.sites.filter((s) => tenantIds.has(s.tenantId));
    const siteIds = new Set(sites.map((s) => s.id));
    const nodes = this.seed.nodes.filter((n) => siteIds.has(n.siteId));
    const devices = this.seed.devices.filter((d) => siteIds.has(d.siteId));

    const decisionsFor = (nodeIds: Set<string>): number =>
      [...this.seed.telemetry.values()]
        .filter((t) => nodeIds.has(t.nodeId))
        .reduce((sum, t) => sum + t.decisions, 0);

    const byVertical = (["healthcare", "warehouse", "global_fleet"] as Vertical[])
      .map((vertical) => {
        const vTenantIds = new Set(tenants.filter((t) => t.vertical === vertical).map((t) => t.id));
        const vSites = sites.filter((s) => vTenantIds.has(s.tenantId));
        const vSiteIds = new Set(vSites.map((s) => s.id));
        const vNodeIds = new Set(nodes.filter((n) => vSiteIds.has(n.siteId)).map((n) => n.id));
        return {
          vertical,
          sites: vSites.length,
          devices: devices.filter((d) => vSiteIds.has(d.siteId)).length,
          decisions: decisionsFor(vNodeIds),
        };
      })
      .filter((v) => v.sites > 0);

    return {
      tenants: tenants.length,
      sites: sites.length,
      edgeNodes: nodes.length,
      edgeHealthy: nodes.filter((n) => n.status === "healthy").length,
      devices: devices.length,
      devicesOnline: devices.filter((d) => d.online).length,
      decisions: decisionsFor(new Set(nodes.map((n) => n.id))),
      byVertical,
    };
  }
}
