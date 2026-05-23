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
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {integrationsData?.integrations.map(i => (
                  <div key={i.id} className="p-3 border border-border rounded flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-sm">{i.vendor} {i.product}</span>
                      <IntegrationStatusBadge status={i.status} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground font-mono">
                      <span>{i.signalsIngested24h.toLocaleString()} sigs</span>
                      <span>{Math.round(i.latencyMs)}ms</span>
                    </div>
                  </div>
                ))}
              </div>
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
    </div>
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
