import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  controlPlane,
  VERTICAL_LABEL,
  type EdgeNode,
  type Tenant,
  type Site,
  type SyncPlan,
  type EdgeStatus,
} from "@/lib/control-plane";

const STATUS_STYLE: Record<EdgeStatus, { dot: string; text: string; label: string }> = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-400", label: "HEALTHY" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", label: "DEGRADED" },
  unreachable: { dot: "bg-red-400", text: "text-red-400", label: "UNREACHABLE" },
};

export function Fleet() {
  const health = useQuery({ queryKey: ["cp-health"], queryFn: () => controlPlane.health() });
  const tenants = useQuery({ queryKey: ["cp-tenants"], queryFn: () => controlPlane.tenants() });
  const nodes = useQuery({ queryKey: ["cp-nodes"], queryFn: () => controlPlane.edgeNodes() });
  const sites = useQuery({ queryKey: ["cp-sites"], queryFn: () => controlPlane.sites() });

  const nodeList = nodes.data ?? [];
  const sync = useQuery({
    queryKey: ["cp-sync", nodeList.map((n) => n.id).join(",")],
    queryFn: () => Promise.all(nodeList.map((n) => controlPlane.sync(n.id))),
    enabled: nodeList.length > 0,
  });

  const tenantList = tenants.data ?? [];
  const bundles = useQuery({
    queryKey: ["cp-bundles", tenantList.map((t) => t.id).join(",")],
    queryFn: () => Promise.all(tenantList.map((t) => controlPlane.policyBundle(t.id))),
    enabled: tenantList.length > 0,
  });
  const ops = useQuery({ queryKey: ["cp-ops"], queryFn: () => controlPlane.opsIntelligence() });

  const syncByNode = new Map<string, SyncPlan>((sync.data ?? []).map((s) => [s.nodeId, s]));
  const siteById = new Map<string, Site>((sites.data ?? []).map((s) => [s.id, s]));
  const bundleByTenant = new Map((bundles.data ?? []).map((b) => [b.tenantId, b]));

  const h = health.data;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fleet &amp; tenants</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">CONTROL PLANE · ONE PANE OF GLASS (FIXTURE)</p>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Tenants" value={h ? String(h.tenants) : "-"} sub={h ? `${h.sites} sites` : ""} />
        <Metric label="Edge nodes" value={h ? `${h.edgeHealthy}/${h.edgeNodes}` : "-"} sub="healthy / total" />
        <Metric label="Devices online" value={h ? `${pct(h.devicesOnline, h.devices)}%` : "-"} sub={h ? `${h.devicesOnline.toLocaleString()} / ${h.devices.toLocaleString()}` : ""} />
        <Metric label="Decisions · 24h" value={h ? h.decisions.toLocaleString() : "-"} sub="across all sites" />
      </div>

      {/* Per-vertical */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">By vertical</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(h?.byVertical ?? []).map((v) => (
              <div key={v.vertical} className="border border-border rounded-lg p-4">
                <div className="font-mono text-xs uppercase tracking-wider text-primary">{VERTICAL_LABEL[v.vertical]}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <Stat n={v.sites} label="sites" />
                  <Stat n={v.devices} label="devices" />
                  <Stat n={v.decisions} label="decisions" />
                </div>
              </div>
            ))}
            {!h && <div className="text-sm text-muted-foreground p-4">Loading fleet health…</div>}
          </div>
        </CardContent>
      </Card>

      {/* Operational intelligence (Phase 3 rollup) */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Operational intelligence</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Friction hotspots */}
            <div className="border border-border rounded-lg p-4">
              <div className="font-mono text-xs uppercase tracking-wider text-amber-400 mb-2">Friction hotspots</div>
              {(ops.data?.hotspots ?? []).slice(0, 4).map((h) => (
                <div key={h.nodeId} className="flex items-center justify-between text-xs font-mono py-1 border-b border-border/30 last:border-0">
                  <span className="text-muted-foreground truncate mr-2" title={h.nodeId}>{h.siteName}</span>
                  <span className={h.frictionRate >= 0.2 ? "text-amber-400" : "text-muted-foreground"}>{Math.round(h.frictionRate * 100)}%</span>
                </div>
              ))}
              {ops.data && ops.data.hotspots.length === 0 && <div className="text-xs text-muted-foreground">No telemetry yet</div>}
            </div>
            {/* Posture / config drift */}
            <div className="border border-border rounded-lg p-4">
              <div className="font-mono text-xs uppercase tracking-wider text-primary mb-2">Posture / config drift</div>
              {(ops.data?.postureDrift ?? []).slice(0, 4).map((d) => (
                <div key={d.nodeId} className="flex items-center justify-between text-xs font-mono py-1 border-b border-border/30 last:border-0">
                  <span className="text-muted-foreground truncate mr-2" title={d.nodeId}>{d.siteName}</span>
                  <span className="text-amber-400">v{d.currentBundleVersion} → v{d.targetBundleVersion}</span>
                </div>
              ))}
              {ops.data && ops.data.postureDrift.length === 0 && <div className="text-xs text-muted-foreground">All nodes on target bundle</div>}
            </div>
            {/* Custody gaps */}
            <div className="border border-border rounded-lg p-4">
              <div className="font-mono text-xs uppercase tracking-wider text-red-400 mb-2">Custody gaps</div>
              {(ops.data?.custodyGaps ?? []).slice(0, 4).map((g) => (
                <div key={g.nodeId} className="flex items-center justify-between text-xs font-mono py-1 border-b border-border/30 last:border-0">
                  <span className="text-muted-foreground truncate mr-2" title={g.reason}>{g.siteName}</span>
                  <span className="text-red-400 uppercase">{g.status}</span>
                </div>
              ))}
              {ops.data && ops.data.custodyGaps.length === 0 && <div className="text-xs text-muted-foreground">No custody gaps</div>}
            </div>
          </div>
          {!ops.data && <div className="text-sm text-muted-foreground mt-2">Loading operational intelligence…</div>}
        </CardContent>
      </Card>

      {/* Tenants → edge nodes with sync status */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Tenants &amp; edge nodes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {(tenants.data ?? []).map((t: Tenant) => {
            const tNodes = nodeList.filter((n) => siteById.get(n.siteId)?.tenantId === t.id);
            const bundle = bundleByTenant.get(t.id);
            return (
              <div key={t.id}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{t.name}</span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/30 text-primary">{VERTICAL_LABEL[t.vertical]}</span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground">tier {t.tier}</span>
                  {bundle && (
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-400/30 text-emerald-400 inline-flex items-center gap-1" title={`checksum ${bundle.checksum.slice(0, 12)}… · signature ${bundle.signature.slice(0, 12)}…`}>
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                      bundle v{bundle.version} · signed
                    </span>
                  )}
                </div>
                {bundle && (
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">workflows</span>
                    {bundle.workflows.map((w) => (
                      <span key={w} className="font-mono text-[0.6rem] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">{w}</span>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left pb-1.5 font-medium">EDGE NODE</th>
                        <th className="text-left pb-1.5 font-medium">SITE</th>
                        <th className="text-left pb-1.5 font-medium">CORE</th>
                        <th className="text-left pb-1.5 font-medium">BUNDLE</th>
                        <th className="text-left pb-1.5 font-medium">SYNC</th>
                        <th className="text-left pb-1.5 font-medium">STATUS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {tNodes.map((n: EdgeNode) => {
                        const st = STATUS_STYLE[n.status];
                        const sp = syncByNode.get(n.id);
                        return (
                          <tr key={n.id} className="hover:bg-muted/20">
                            <td className="py-1.5">{n.id}</td>
                            <td className="py-1.5 text-muted-foreground">{siteById.get(n.siteId)?.name ?? n.siteId}</td>
                            <td className="py-1.5 text-muted-foreground">v{n.coreVersion}</td>
                            <td className="py-1.5">
                              {sp && sp.updateAvailable ? (
                                <span className="text-amber-400">v{n.bundleVersion} → v{sp.targetBundleVersion}</span>
                              ) : (
                                <span className="text-muted-foreground">v{n.bundleVersion}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-muted-foreground">{n.lastSyncMinsAgo}m ago</td>
                            <td className="py-1.5">
                              <span className={`inline-flex items-center gap-1.5 ${st.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {tNodes.length === 0 && (
                        <tr><td colSpan={6} className="py-2 text-muted-foreground">No edge nodes</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {!tenants.data && <div className="text-sm text-muted-foreground p-4">Loading tenants…</div>}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground font-mono">
        The control plane distributes policy and aggregates health; decisions are made by the local decision plane at each site. Data is deterministic public-safe fixtures.
      </p>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl md:text-3xl font-mono font-bold tracking-tight">{value}</div>
        {sub && <div className="text-xs font-mono text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-lg font-mono font-bold">{n.toLocaleString()}</div>
      <div className="text-[0.6rem] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
