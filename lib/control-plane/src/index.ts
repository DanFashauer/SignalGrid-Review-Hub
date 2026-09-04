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

import { createHmac, timingSafeEqual } from "crypto";

// ── deterministic checksum (FNV-1a, dependency-free, browser-safe) ───────────

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical checksum over a bundle's content (tenant + version + workflows).
 *  Exported so the edge-sync proof can mint a checksum-consistent bundle for an
 *  UNPROVISIONED tenant and prove it still fails authenticity. */
export function bundleChecksum(tenantId: string, version: number, workflows: string[]): string {
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

// ── bundle signing (authenticity) ────────────────────────────────────────────
//
// The checksum proves a bundle wasn't corrupted; the signature proves it came
// from the control plane (authenticity). We HMAC-SHA256 the canonical bundle
// content with a per-tenant signing key so an edge node can refuse config that
// isn't signed by the control plane it trusts — even a checksum-consistent
// forgery fails. Keys here are PUBLIC-SAFE FIXTURES (obviously fake); a real
// deployment would use per-tenant secrets or asymmetric signing.

const FIXTURE_SIGNING_KEYS: Record<string, string> = {
  tenant_northwind: "cpk_demo_northwind_signing",
  tenant_atlas: "cpk_demo_atlas_signing",
  tenant_meridian: "cpk_demo_meridian_signing",
  tenant_vero: "cpk_demo_vero_signing",
  tenant_forge: "cpk_demo_forge_signing",
  tenant_orion: "cpk_demo_orion_signing",
};

function canonicalBundle(tenantId: string, version: number, workflows: string[]): string {
  return `${tenantId}:${version}:${workflows.join(",")}`;
}

/**
 * The signing key for a tenant, or undefined when the tenant is not provisioned
 * with one. `hasOwnProperty` is load-bearing: a plain `FIXTURE_SIGNING_KEYS[tenantId]`
 * resolves `"constructor"`/`"__proto__"` to an inherited value, so an unprovisioned
 * tenant with a crafted name could otherwise pick up a truthy key. An unprovisioned
 * tenant has NO key, full stop.
 */
function signingKeyFor(tenantId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(FIXTURE_SIGNING_KEYS, tenantId)
    ? FIXTURE_SIGNING_KEYS[tenantId]
    : undefined;
}

/**
 * HMAC signature over the canonical bundle, or undefined when the tenant has no
 * signing key. There is deliberately NO shared fallback key. This function backs
 * BOTH signing and verification (verifyBundleSignature calls it), so a fallback
 * made every unprovisioned tenant verify against a public constant — an attacker
 * naming any un-provisioned tenant, computing its checksum and signing with the
 * shared default, produced a bundle that VERIFIED. That inverts golden rule 2 (an
 * unknown signal must raise assurance, never lower it) on the authenticity boundary
 * an edge node runs before applying pulled config. Guarded by
 * scripts/src/edge-sync-proof.ts.
 */
function bundleSignature(tenantId: string, version: number, workflows: string[]): string | undefined {
  const key = signingKeyFor(tenantId);
  if (key === undefined) return undefined;
  return createHmac("sha256", key).update(canonicalBundle(tenantId, version, workflows)).digest("hex");
}

/**
 * Verify a bundle's signature (authenticity) AND checksum (integrity) — the
 * full check an edge node runs before applying pulled config. Constant-time
 * signature comparison; fail closed on any mismatch or tampering.
 */
export function verifyBundleSignature(bundle: PolicyBundle): boolean {
  if (!verifyBundleChecksum(bundle)) return false;
  const expected = bundleSignature(bundle.tenantId, bundle.version, bundle.workflows);
  // No trusted signing key for this tenant ⇒ it cannot be authentic. Fail closed
  // rather than accept a signature computed against any shared/default key.
  if (expected === undefined) return false;
  if (typeof bundle.signature !== "string" || bundle.signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(bundle.signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ── domain model ─────────────────────────────────────────────────────────────

export type Vertical = "healthcare" | "warehouse" | "global_fleet" | "retail" | "industrial" | "data_center";
export type Tier = "dev" | "alpha" | "beta" | "prod";
export type EdgeStatus = "healthy" | "degraded" | "unreachable";
export type DeviceKind =
  | "tablet"
  | "dock"
  | "badge_reader"
  | "rugged_scanner"
  | "vehicle_mount"
  | "pos_terminal"
  | "hmi_panel"
  | "noc_console";

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
  checksum: string; // integrity (FNV over content)
  signature: string; // authenticity (HMAC-SHA256 over content, fixture key)
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

/** Outcome labels the decision core produces (telemetry UP is aggregated from these). */
export type DecisionOutcomeLabel = "allow" | "step_up" | "restrict" | "deny";

/**
 * Shape a telemetry batch from a run of decision outcomes reported by an edge
 * node's decision plane. This is the "telemetry UP" aggregation: the edge tallies
 * its own decisions and reports counts to the control plane — raw decisions never
 * leave the edge. Deterministic; no clock read here.
 */
export function aggregateOutcomes(
  nodeId: string,
  outcomes: DecisionOutcomeLabel[],
  windowMins = 1440,
): TelemetryBatch {
  const tally = { allow: 0, step_up: 0, restrict: 0, deny: 0 };
  for (const o of outcomes) tally[o] += 1;
  return {
    nodeId,
    windowMins,
    decisions: outcomes.length,
    allow: tally.allow,
    stepUp: tally.step_up,
    restrict: tally.restrict,
    deny: tally.deny,
  };
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

// ── operational intelligence (Phase 3 rollups) ───────────────────────────────
// Derived from ingested telemetry + node status + sync state — an operator's
// "where is friction / drift / risk concentrating" view across sites. All
// deterministic; no clock is read.

/** A node whose decisions carry disproportionate friction (step-up/restrict/deny). */
export interface FrictionHotspot {
  nodeId: string;
  siteId: string;
  siteName: string;
  vertical: Vertical;
  decisions: number;
  /** (stepUp + restrict + deny) / decisions, 0..1 rounded to 4 dp. */
  frictionRate: number;
  stepUpRate: number;
  restrictRate: number;
  denyRate: number;
}

/** A node running a bundle behind the tenant's current target (config drift). */
export interface PostureDrift {
  nodeId: string;
  siteName: string;
  vertical: Vertical;
  currentBundleVersion: number;
  targetBundleVersion: number;
  behindBy: number;
}

/** A node whose custody signal is weak: unreachable/degraded or stale sync. */
export interface CustodyGap {
  nodeId: string;
  siteName: string;
  vertical: Vertical;
  status: EdgeStatus;
  lastSyncMinsAgo: number;
  reason: string;
}

export interface OpsIntelligence {
  hotspots: FrictionHotspot[];
  postureDrift: PostureDrift[];
  custodyGaps: CustodyGap[];
  summary: {
    nodesWithTelemetry: number;
    avgFrictionRate: number;
    hotspotCount: number;
    driftCount: number;
    gapCount: number;
  };
}

/** A node at/above this friction rate is flagged a hotspot. */
export const HOTSPOT_FRICTION_THRESHOLD = 0.2;
/** A node whose last sync is older than this (mins) is a custody/staleness gap. */
export const STALE_SYNC_MINS = 60;

// ── seed: six verticals, one plane ───────────────────────────────────────────

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
    { id: "tenant_vero", name: "Vero Markets", vertical: "retail", tier: "alpha" },
    { id: "tenant_forge", name: "Forge Industrial", vertical: "industrial", tier: "alpha" },
    { id: "tenant_orion", name: "Orion Data Centers", vertical: "data_center", tier: "alpha" },
  ];

  const sites: Site[] = [
    { id: "site_nw_general", tenantId: "tenant_northwind", name: "Northwind General Hospital", region: "us-east" },
    { id: "site_nw_childrens", tenantId: "tenant_northwind", name: "Northwind Children's", region: "us-east" },
    { id: "site_atlas_dc7", tenantId: "tenant_atlas", name: "Atlas DC-7", region: "us-central" },
    { id: "site_mer_euw", tenantId: "tenant_meridian", name: "Meridian EU-West", region: "eu-west" },
    { id: "site_mer_apac", tenantId: "tenant_meridian", name: "Meridian APAC", region: "ap-southeast" },
    { id: "site_vero_flagship", tenantId: "tenant_vero", name: "Vero Flagship Store", region: "us-west" },
    { id: "site_forge_plant2", tenantId: "tenant_forge", name: "Forge Plant 2", region: "us-central" },
    { id: "site_orion_iad1", tenantId: "tenant_orion", name: "Orion IAD1 Data Center", region: "us-east" },
  ];

  const nodes: EdgeNode[] = [
    { id: "edge_nw_general", siteId: "site_nw_general", coreVersion: "1.4.0", bundleVersion: 7, status: "healthy", lastSyncMinsAgo: 2 },
    { id: "edge_nw_childrens", siteId: "site_nw_childrens", coreVersion: "1.4.0", bundleVersion: 6, status: "healthy", lastSyncMinsAgo: 4 },
    { id: "edge_atlas_dc7", siteId: "site_atlas_dc7", coreVersion: "1.4.0", bundleVersion: 3, status: "degraded", lastSyncMinsAgo: 21 },
    { id: "edge_mer_euw", siteId: "site_mer_euw", coreVersion: "1.3.2", bundleVersion: 5, status: "healthy", lastSyncMinsAgo: 6 },
    { id: "edge_mer_apac", siteId: "site_mer_apac", coreVersion: "1.3.2", bundleVersion: 5, status: "unreachable", lastSyncMinsAgo: 143 },
    { id: "edge_vero_flagship", siteId: "site_vero_flagship", coreVersion: "1.4.0", bundleVersion: 2, status: "healthy", lastSyncMinsAgo: 3 },
    { id: "edge_forge_plant2", siteId: "site_forge_plant2", coreVersion: "1.3.2", bundleVersion: 1, status: "degraded", lastSyncMinsAgo: 34 },
    { id: "edge_orion_iad1", siteId: "site_orion_iad1", coreVersion: "1.4.0", bundleVersion: 3, status: "healthy", lastSyncMinsAgo: 1 },
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
    ["site_vero_flagship", "pos_terminal", 32, 31],
    ["site_vero_flagship", "rugged_scanner", 18, 17],
    ["site_forge_plant2", "hmi_panel", 24, 22],
    ["site_forge_plant2", "tablet", 12, 11],
    ["site_orion_iad1", "noc_console", 28, 28],
    ["site_orion_iad1", "tablet", 10, 10],
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
    ["tenant_vero", { version: 2, workflows: ["general-lookup", "pos-session", "restricted-sale"] }],
    ["tenant_forge", { version: 1, workflows: ["general-lookup", "line-ops"] }],
    ["tenant_orion", { version: 3, workflows: ["general-lookup", "noc-session", "network-change", "power-control", "incident-response", "facilities-control", "compute-ops"] }],
  ]);

  // Deterministic per-node telemetry (shift-shaped-ish, fixed).
  const telemetry = new Map<string, TelemetryBatch>();
  const telePlan: Array<[string, number]> = [
    ["edge_nw_general", 4200],
    ["edge_nw_childrens", 1400],
    ["edge_atlas_dc7", 9800],
    ["edge_mer_euw", 3600],
    ["edge_mer_apac", 1500],
    ["edge_vero_flagship", 5200],
    ["edge_forge_plant2", 2100],
    ["edge_orion_iad1", 6400],
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
    const signature = bundleSignature(tenantId, b.version, b.workflows);
    // A seeded bundle whose tenant has no signing key is a control-plane
    // misconfiguration — refuse to mint a bundle no edge node could authenticate,
    // rather than emit one signed with a shared/absent key.
    if (signature === undefined) return null;
    return {
      tenantId,
      version: b.version,
      workflows: b.workflows,
      checksum: bundleChecksum(tenantId, b.version, b.workflows),
      signature,
    };
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
    // Sanitize on ingest so a malformed or inconsistent batch can't skew fleet
    // rollups. Counts are clamped to non-negative integers, and `decisions` is
    // held to be at least the sum of its outcome parts — that invariant is what
    // keeps every derived rate (friction/stepUp/restrict/deny) inside [0,1]
    // downstream. Deterministic: no clock is read.
    const nonNeg = (x: number) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    const allow = nonNeg(batch.allow);
    const stepUp = nonNeg(batch.stepUp);
    const restrict = nonNeg(batch.restrict);
    const deny = nonNeg(batch.deny);
    const sanitized: TelemetryBatch = {
      nodeId: batch.nodeId,
      windowMins: nonNeg(batch.windowMins),
      allow,
      stepUp,
      restrict,
      deny,
      decisions: Math.max(nonNeg(batch.decisions), allow + stepUp + restrict + deny),
    };
    this.seed.telemetry.set(sanitized.nodeId, sanitized);
    return sanitized;
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

    const byVertical = (["healthcare", "warehouse", "global_fleet", "retail", "industrial", "data_center"] as Vertical[])
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

  /**
   * Operational-intelligence rollup (Phase 3): friction hotspots, posture/config
   * drift, and custody gaps across a tenant's (or the whole fleet's) sites,
   * derived from ingested telemetry + node status + sync state. Deterministic.
   */
  operationalIntelligence(tenantId?: string): OpsIntelligence {
    const tenants = this.seed.tenants.filter((t) => !tenantId || t.id === tenantId);
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const sites = this.seed.sites.filter((s) => tenantById.has(s.tenantId));
    const siteById = new Map(sites.map((s) => [s.id, s]));
    const nodes = this.seed.nodes.filter((n) => siteById.has(n.siteId));
    const round4 = (x: number) => Math.round(x * 10000) / 10000;
    const verticalOf = (siteId: string): Vertical =>
      tenantById.get(siteById.get(siteId)?.tenantId ?? "")?.vertical ?? "healthcare";
    const siteNameOf = (siteId: string): string => siteById.get(siteId)?.name ?? siteId;

    // Friction hotspots — from telemetry, worst first.
    const hotspots: FrictionHotspot[] = nodes
      .map((n) => ({ n, t: this.seed.telemetry.get(n.id) }))
      .filter((x): x is { n: EdgeNode; t: TelemetryBatch } => !!x.t && x.t.decisions > 0)
      .map(({ n, t }) => {
        const friction = t.stepUp + t.restrict + t.deny;
        return {
          nodeId: n.id,
          siteId: n.siteId,
          siteName: siteNameOf(n.siteId),
          vertical: verticalOf(n.siteId),
          decisions: t.decisions,
          frictionRate: round4(friction / t.decisions),
          stepUpRate: round4(t.stepUp / t.decisions),
          restrictRate: round4(t.restrict / t.decisions),
          denyRate: round4(t.deny / t.decisions),
        };
      })
      .sort((a, b) => b.frictionRate - a.frictionRate || a.nodeId.localeCompare(b.nodeId));

    // Posture/config drift — nodes behind the tenant's current bundle.
    const postureDrift: PostureDrift[] = nodes
      .map((n) => ({ n, plan: this.syncPlan(n.id) }))
      .filter((x) => x.plan?.updateAvailable)
      .map(({ n, plan }) => ({
        nodeId: n.id,
        siteName: siteNameOf(n.siteId),
        vertical: verticalOf(n.siteId),
        currentBundleVersion: plan!.currentBundleVersion,
        targetBundleVersion: plan!.targetBundleVersion,
        behindBy: plan!.targetBundleVersion - plan!.currentBundleVersion,
      }))
      .sort((a, b) => b.behindBy - a.behindBy || a.nodeId.localeCompare(b.nodeId));

    // Custody gaps — unreachable/degraded nodes, or a stale last sync.
    const custodyGaps: CustodyGap[] = nodes
      .filter((n) => n.status !== "healthy" || n.lastSyncMinsAgo > STALE_SYNC_MINS)
      .map((n) => {
        const reasons: string[] = [];
        if (n.status !== "healthy") reasons.push(`edge ${n.status}`);
        if (n.lastSyncMinsAgo > STALE_SYNC_MINS) reasons.push(`last sync ${n.lastSyncMinsAgo}m ago`);
        return {
          nodeId: n.id,
          siteName: siteNameOf(n.siteId),
          vertical: verticalOf(n.siteId),
          status: n.status,
          lastSyncMinsAgo: n.lastSyncMinsAgo,
          reason: reasons.join("; "),
        };
      })
      .sort((a, b) => b.lastSyncMinsAgo - a.lastSyncMinsAgo || a.nodeId.localeCompare(b.nodeId));

    const avgFrictionRate = hotspots.length
      ? round4(hotspots.reduce((s, h) => s + h.frictionRate, 0) / hotspots.length)
      : 0;

    return {
      hotspots,
      postureDrift,
      custodyGaps,
      summary: {
        nodesWithTelemetry: hotspots.length,
        avgFrictionRate,
        hotspotCount: hotspots.filter((h) => h.frictionRate >= HOTSPOT_FRICTION_THRESHOLD).length,
        driftCount: postureDrift.length,
        gapCount: custodyGaps.length,
      },
    };
  }
}
