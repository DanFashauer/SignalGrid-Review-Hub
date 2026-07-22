/**
 * Client for the `/cp/v1` **control-plane** surface (the cloud management plane).
 * Separate from the `/v1` decision core and the `/api/*` monitoring fixtures.
 * Honors VITE_API_BASE_URL like the generated client (see main.tsx).
 */

const BASE = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

export type Vertical = "healthcare" | "warehouse" | "global_fleet" | "retail" | "industrial" | "data_center";
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
export interface PolicyBundle {
  tenantId: string; version: number; workflows: string[];
  checksum: string; signature: string;
}
export interface FrictionHotspot {
  nodeId: string; siteId: string; siteName: string; vertical: Vertical;
  decisions: number; frictionRate: number; stepUpRate: number; restrictRate: number; denyRate: number;
}
export interface PostureDrift {
  nodeId: string; siteName: string; vertical: Vertical;
  currentBundleVersion: number; targetBundleVersion: number; behindBy: number;
}
export interface CustodyGap {
  nodeId: string; siteName: string; vertical: Vertical;
  status: EdgeStatus; lastSyncMinsAgo: number; reason: string;
}
export interface OpsIntelligence {
  hotspots: FrictionHotspot[];
  postureDrift: PostureDrift[];
  custodyGaps: CustodyGap[];
  summary: { nodesWithTelemetry: number; avgFrictionRate: number; hotspotCount: number; driftCount: number; gapCount: number };
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
  policyBundle: (tenant: string) => get<PolicyBundle>(`/api/cp/v1/policy-bundle?tenant=${encodeURIComponent(tenant)}`),
  opsIntelligence: (tenant?: string) => get<OpsIntelligence>(`/api/cp/v1/ops-intelligence${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  flowsHealth: () => get<FlowsHealth>(`/api/cp/v1/flows/health`),
  recommendations: () => get<{ recommendations: Recommendation[] }>(`/api/cp/v1/recommendations`).then((r) => r.recommendations),
  signalDiscovery: () => get<SignalDiscovery>(`/api/cp/v1/signal-discovery`),
  gridCoverage: () => get<GridCoverageResp>(`/api/cp/v1/grid/coverage`),
  gridSourcing: () => get<GridSourcingResp>(`/api/cp/v1/grid/sourcing`),
  gridConfig: () => get<GridConfigResp>(`/api/cp/v1/grid/config`),
  provisioning: (serial?: string) => get<ProvisioningResp>(`/api/cp/v1/grid/provisioning${serial ? `?serial=${encodeURIComponent(serial)}` : ""}`),
  appResilience: () => get<AppResilienceResp>(`/api/cp/v1/apps/resilience`),
};

// ── Build-the-grid surface (decision-fabric layer) ──────────────────────────────
export interface SourcingSummary { total: number; api: number; native: number; gridCollected: number; unavailable: number; wireable: number; vendorIntegrated: number }
export interface SituationCoverageRow { situationId: string; label: string; workflowId: string; status: "auto_handled" | "partial" | "blind_spot"; missingSignals: string[]; reason: string }
export interface GridCoverageResp {
  sourcing: SourcingSummary;
  coverage: { situations: SituationCoverageRow[]; handled: number; partial: number; blindSpots: number; total: number; coveragePct: number };
}
export type AcquisitionMethod = "api" | "native" | "grid_collected" | "unavailable";
export type Fidelity = "high" | "medium" | "low" | "none";
export interface SignalSourceRow { id: string; name: string; system: string; method: AcquisitionMethod; fidelity: Fidelity; wireable: boolean; gridLifted: boolean }
export interface GridSourcingResp { summary: SourcingSummary; signals: SignalSourceRow[] }
export interface GridConfigSignal { id: string; name: string; system: string; method: AcquisitionMethod }
export interface GridConfigAction { key: string; label: string; approval: string }
export interface GridConfigWorkflow { id: string; name: string; requiredSignals: string[]; actions: GridConfigAction[]; supportTeam: string; severityOnBreak: string }
export interface GridConfigSituation { id: string; label: string; workflowId: string }
export interface GridDeclarativeConfig { signals: GridConfigSignal[]; workflows: GridConfigWorkflow[]; situations: GridConfigSituation[] }
export interface GridConfigResp {
  valid: boolean;
  summary: { signals: number; workflows: number; situations: number; errors: number; warnings: number; coveragePctAtFullHealth: number | null };
  issues: Array<{ severity: "error" | "warning"; code: string; subject: string; message: string }>;
  config: GridDeclarativeConfig;
}
export type StepDisposition = "auto_apply" | "approval_required" | "held_simulated";
export interface ProvisioningStep { key: string; label: string; kind: string; disposition: StepDisposition; reason: string }
export interface RecordingStep { key: string; label: string; kind: string; sensitive?: boolean; gridLifted?: boolean }
export interface DeviceSetupRecording {
  id: string; name: string;
  match: { serialPrefix?: string; model?: string };
  triggers: string[];
  steps: RecordingStep[];
}
export interface ProvisioningDevice { serial: string; model?: string; onNetwork?: boolean }
export interface ProvisioningResp {
  recording: DeviceSetupRecording;
  recordingValid: boolean;
  issues: Array<{ severity: "error" | "warning"; code: string; subject: string; message: string }>;
  device: ProvisioningDevice;
  devices: ProvisioningDevice[];
  plan: { recordingId: string; deviceSerial: string; matched: boolean; mode: "simulated" | "enforced"; steps: ProvisioningStep[]; requiresApproval: number; willApplyAnything: boolean; reason: string };
}
export interface AppResilienceRow { appId: string; name: string; availability: string; mode: string; canProceed: boolean; requiredSafetyNets: string[]; reason: string }
export interface AppResilienceResp {
  fleet: { apps: AppResilienceRow[]; total: number; normal: number; degraded: number; onFallback: number; blocked: number; workable: number; allWorkable: boolean };
}

export interface FlowHealthRow {
  flow: { id: string; name: string; supportTeam: string; itsm: string; severityOnBreak: string; autoHeal: { agent: string; autoResolves: boolean } | null };
  health: { flowId: string; status: "healthy" | "degraded" | "broken"; brokenSignals: string[]; staleSignals: string[] };
  resolution:
    | { kind: "healthy" }
    | { kind: "self_heal"; plan: { agent: string; autoResolves: boolean; steps: string[]; fallbackIncident: unknown } }
    | { kind: "incident"; incident: { severity: string; supportTeam: string; itsm: string; summary: string } };
}
export interface FlowsHealth {
  observedAt: string;
  flows: FlowHealthRow[];
  grid: { signalsWired: number; signalsHealthy: number; flowsTotal: number; flowsHealthy: number; meanSignalsPerFlow: number; smartnessScore: number };
}
export interface Recommendation {
  id: string; kind: string; target: string; title: string; rationale: string; confidence: number; suggestedChange: string;
}
export interface DiscoveredSignal {
  category: string; sourceId: string; sourceName: string; class: "evaluated" | "candidate" | "novel"; lifecycle: string; autoOnboardable: boolean; recommendation: string;
}
export interface SignalDiscovery {
  summary: { sources: number; detected: number; recognized: number; candidate: number; novel: number; autoOnboardable: number; needsAdmin: number };
  discovered: DiscoveredSignal[];
}

export const VERTICAL_LABEL: Record<Vertical, string> = {
  healthcare: "Healthcare",
  warehouse: "Warehouse",
  global_fleet: "Global fleet",
  retail: "Retail",
  industrial: "Industrial",
  data_center: "Data center / NOC",
};
