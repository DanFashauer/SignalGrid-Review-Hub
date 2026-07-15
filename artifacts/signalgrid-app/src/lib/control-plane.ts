/**
 * Client for the `/cp/v1` **control-plane** surface (the cloud management plane).
 * Separate from the `/v1` decision core and the `/api/*` monitoring fixtures.
 * Honors VITE_API_BASE_URL like the generated client (see main.tsx).
 */

const BASE = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

export type Vertical = "healthcare" | "warehouse" | "global_fleet";
export type EdgeStatus = "healthy" | "degraded" | "unreachable";

export interface Tenant { id: string; name: string; vertical: Vertical; tier: string }
export interface Site { id: string; tenantId: string; name: string; region: string }
export interface EdgeNode {
  id: string; siteId: string; coreVersion: string; bundleVersion: number;
  status: EdgeStatus; lastSyncMinsAgo: number;
}
export interface FleetHealth {
  tenants: number; sites: number; edgeNodes: number; edgeHealthy: number;
  devices: number; devicesOnline: number; decisions: number;
  byVertical: Array<{ vertical: Vertical; sites: number; devices: number; decisions: number }>;
}
export interface SyncPlan {
  nodeId: string; currentBundleVersion: number; targetBundleVersion: number;
  updateAvailable: boolean; checksum: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const controlPlane = {
  health: (tenant?: string) => get<FleetHealth>(`/api/cp/v1/health${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  tenants: () => get<{ tenants: Tenant[] }>(`/api/cp/v1/tenants`).then((r) => r.tenants),
  edgeNodes: (tenant?: string) => get<{ edgeNodes: EdgeNode[] }>(`/api/cp/v1/edge-nodes${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`).then((r) => r.edgeNodes),
  sites: (tenant?: string) => get<{ sites: Site[] }>(`/api/cp/v1/sites${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`).then((r) => r.sites),
  sync: (nodeId: string) => get<SyncPlan>(`/api/cp/v1/sync/${encodeURIComponent(nodeId)}`),
};

export const VERTICAL_LABEL: Record<Vertical, string> = {
  healthcare: "Healthcare",
  warehouse: "Warehouse",
  global_fleet: "Global fleet",
};
