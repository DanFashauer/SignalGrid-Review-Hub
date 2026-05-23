import React from "react";
import { Link } from "wouter";
import { 
  useGetDashboardMetrics, 
  useGetDecisionSeries, 
  useListDecisions, 
  useListIntegrations,
  useListLatestSignals
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { OutcomeBadge, IntegrationStatusBadge, SignalStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo, formatDate } from "@/lib/format";

export function Dashboard() {
  const { data: metrics, isLoading: isLoadingMetrics } = useGetDashboardMetrics({ window: "24h" });
  const { data: seriesData } = useGetDecisionSeries({ window: "24h", granularity: "hour" });
  const { data: decisionsData } = useListDecisions({ limit: 20 });
  const { data: integrationsData } = useListIntegrations();
  const { data: signalsData } = useListLatestSignals({ limit: 10 });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">24H SYSTEM TELEMETRY</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total Decisions" value={metrics?.totalDecisions?.toLocaleString() || "-"} />
        <MetricCard title="Allow Rate" value={metrics ? `${(metrics.allowRate * 100).toFixed(1)}%` : "-"} />
        <MetricCard title="Restrict/Deny Rate" value={metrics ? `${(metrics.restrictDenyRate * 100).toFixed(1)}%` : "-"} />
        <MetricCard title="Avg Latency" value={metrics ? `${Math.round(metrics.avgLatencyMs)}ms` : "-"} />
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Decision Volume</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {seriesData?.series ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={seriesData.series}>
                <defs>
                  <linearGradient id="colorAllow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDeny" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(t) => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                  stroke="#666" 
                  fontSize={12}
                  tickMargin={10}
                />
                <YAxis stroke="#666" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', borderColor: '#333', color: '#fff' }}
                  labelFormatter={(t) => new Date(t).toLocaleString()}
                />
                <Area type="monotone" dataKey="allow" stroke="#22c55e" fillOpacity={1} fill="url(#colorAllow)" stackId="1" />
                <Area type="monotone" dataKey="stepUp" stroke="#eab308" fillOpacity={0.5} fill="#eab308" stackId="1" />
                <Area type="monotone" dataKey="restrict" stroke="#f97316" fillOpacity={0.5} fill="#f97316" stackId="1" />
                <Area type="monotone" dataKey="deny" stroke="#ef4444" fillOpacity={1} fill="url(#colorDeny)" stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">Loading chart...</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Live Feed</CardTitle>
            <Link href="/decisions" className="text-xs text-primary hover:underline">View All</Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {decisionsData?.decisions.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center justify-between p-3 border border-border rounded bg-card/50 hover:bg-card/80 transition-colors">
                  <div className="flex items-center gap-3">
                    <OutcomeBadge outcome={d.outcome} />
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">{d.identityId}</span>
                      <span className="text-xs text-muted-foreground font-mono">{d.deviceId}</span>
                    </div>
                  </div>
                  <div className="text-right flex flex-col">
                    <span className="text-xs text-muted-foreground font-mono">{formatTimeAgo(d.evaluatedAt)}</span>
                    <span className="text-xs font-mono text-muted-foreground">{d.latencyMs}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-8">
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Integration Health</CardTitle>
              <Link href="/integrations" className="text-xs text-primary hover:underline">View All</Link>
            </CardHeader>
            <CardContent>
              {integrationsData ? (
                <div className="space-y-3">
                  {/* Summary counts */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "CONNECTED", count: integrationsData.integrations.filter(i => i.status === "connected").length, color: "text-green-400" },
                      { label: "DEGRADED", count: integrationsData.integrations.filter(i => i.status === "degraded").length, color: "text-yellow-400" },
                      { label: "DOWN", count: integrationsData.integrations.filter(i => i.status === "disconnected").length, color: "text-red-400" },
                    ].map(m => (
                      <div key={m.label} className="p-3 border border-border rounded text-center">
                        <div className={`text-2xl font-mono font-bold ${m.color}`}>{m.count}</div>
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Active integrations with signals */}
                  <div className="space-y-1.5 mt-2">
                    {integrationsData.integrations
                      .filter(i => i.status === "connected" && i.signalsIngested24h > 0)
                      .sort((a, b) => b.signalsIngested24h - a.signalsIngested24h)
                      .slice(0, 6)
                      .map(i => (
                        <div key={i.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                            <span className="font-mono text-xs font-medium truncate">{i.vendor}</span>
                            <span className="text-xs text-muted-foreground font-mono hidden lg:block truncate">{i.product}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground shrink-0">
                            <span>{i.signalsIngested24h.toLocaleString()} sigs</span>
                            <span>{Math.round(i.latencyMs)}ms</span>
                          </div>
                        </div>
                    ))}
                  </div>
                  {integrationsData.integrations.filter(i => i.status === "degraded" || i.status === "disconnected").length > 0 && (
                    <div className="space-y-1.5 border-t border-border pt-2">
                      {integrationsData.integrations
                        .filter(i => i.status === "degraded" || i.status === "disconnected")
                        .slice(0, 3)
                        .map(i => (
                          <div key={i.id} className="flex items-center justify-between p-2 rounded bg-red-500/5 border border-red-500/10">
                            <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${i.status === "degraded" ? "bg-yellow-400" : "bg-red-400"}`} />
                              <span className="font-mono text-xs font-medium">{i.vendor}</span>
                            </div>
                            <span className={`text-xs font-mono ${i.status === "degraded" ? "text-yellow-400" : "text-red-400"}`}>
                              {i.status.toUpperCase()}
                            </span>
                          </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-4 text-center">Loading...</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Anomalous Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {signalsData?.signals.filter(s => s.status === 'anomalous' || s.status === 'critical').slice(0, 3).map(s => (
                  <div key={s.id} className="p-2 text-sm border border-border rounded flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <SignalStatusBadge status={s.status} />
                      <span className="font-mono">{s.platform}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{formatTimeAgo(s.receivedAt)}</span>
                  </div>
                ))}
                {(!signalsData?.signals || signalsData.signals.filter(s => s.status === 'anomalous' || s.status === 'critical').length === 0) && (
                  <div className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded">
                    No active anomalies detected
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Shift Handoff Status */}
      <ShiftHandoffPanel />

    </div>
  );
}

const HANDOFF_DEVICES = [
  { id: "SG-0847", zone: "ICU", status: "docked" as const, user: "USR1001", next: "USR2001", lastSeen: 3 },
  { id: "SG-0912", zone: "ER", status: "docked" as const, user: "USR1002", next: "USR2002", lastSeen: 7 },
  { id: "SG-0334", zone: "ZONE 3B", status: "overdue" as const, user: "USR1003", next: "USR2003", lastSeen: 47 },
  { id: "SG-1023", zone: "PHARMACY", status: "handing-off" as const, user: "USR1004", next: "USR2004", lastSeen: 2 },
  { id: "SG-0765", zone: "ZONE 1A", status: "docked" as const, user: "USR1005", next: "USR2005", lastSeen: 5 },
  { id: "SG-0289", zone: "LAB", status: "overdue" as const, user: "USR1006", next: "USR2006", lastSeen: 52 },
];

const HANDOFF_STATUS_STYLE = {
  docked: { label: "DOCKED", bar: "bg-green-400", text: "text-green-400" },
  overdue: { label: "OVERDUE", bar: "bg-red-400", text: "text-red-400" },
  "handing-off": { label: "IN PROGRESS", bar: "bg-yellow-400", text: "text-yellow-400" },
};

function ShiftHandoffPanel() {
  const overdue = HANDOFF_DEVICES.filter(d => d.status === "overdue");
  const docked = HANDOFF_DEVICES.filter(d => d.status === "docked");
  const inProgress = HANDOFF_DEVICES.filter(d => d.status === "handing-off");

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Shift Handoff</CardTitle>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">DEVICE CUSTODY STATUS · SHIFT 07:00–19:00</p>
        </div>
        <div className="flex gap-4 text-xs font-mono">
          <span className="text-green-400">{docked.length} DOCKED</span>
          {inProgress.length > 0 && <span className="text-yellow-400">{inProgress.length} IN PROGRESS</span>}
          {overdue.length > 0 && <span className="text-red-400">{overdue.length} OVERDUE</span>}
        </div>
      </CardHeader>
      <CardContent>
        {overdue.length > 0 && (
          <div className="mb-4 p-3 rounded border border-red-500/20 bg-red-500/5 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
            <div className="text-xs font-mono">
              <span className="text-red-300 font-semibold">{overdue.length} device{overdue.length > 1 ? "s" : ""} overdue for checkout: </span>
              <span className="text-muted-foreground">{overdue.map(d => d.id).join(", ")} — shift ended, device not docked</span>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 font-medium">DEVICE</th>
                <th className="text-left pb-2 font-medium">ZONE</th>
                <th className="text-left pb-2 font-medium hidden md:table-cell">CURRENT</th>
                <th className="text-left pb-2 font-medium hidden md:table-cell">NEXT SHIFT</th>
                <th className="text-left pb-2 font-medium">LAST SEEN</th>
                <th className="text-left pb-2 font-medium">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {HANDOFF_DEVICES.map(device => {
                const meta = HANDOFF_STATUS_STYLE[device.status];
                return (
                  <tr key={device.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2 font-semibold">{device.id}</td>
                    <td className="py-2 text-muted-foreground">{device.zone}</td>
                    <td className="py-2 text-muted-foreground hidden md:table-cell">{device.user}</td>
                    <td className="py-2 text-muted-foreground hidden md:table-cell">{device.next}</td>
                    <td className="py-2 text-muted-foreground">{device.lastSeen}m ago</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${meta.bar}`} />
                        <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ title, value }: { title: string, value: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-mono font-bold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
}
