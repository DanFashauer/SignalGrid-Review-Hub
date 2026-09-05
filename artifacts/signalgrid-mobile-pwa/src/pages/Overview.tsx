import React, { useState, useEffect } from "react";
import { useGetDashboardMetrics, useGetDecisionSeries, useListIntegrations } from "@workspace/api-client-react";
import { formatNumber, formatLatency, formatRate } from "@/lib/format";
import { ResponsiveContainer, BarChart, Bar } from "recharts";
import { StatusDot } from "@/components/StatusDot";

export default function Overview() {
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: metrics, isLoading: metricsLoading, isError: metricsUnreachable } = useGetDashboardMetrics();
  const { data: series } = useGetDecisionSeries({ window: "24h", granularity: "hour" });
  const { data: integrationsData } = useListIntegrations();

  return (
    <div className="h-full w-full flex flex-col scroll-area p-4 space-y-6 pt-safe">
      <header className="flex flex-col pt-2">
        <h1 className="text-2xl font-bold tracking-tight">SignalGrid</h1>
        <p className="text-sm font-mono text-muted-foreground">{time}</p>
      </header>

      {metricsLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-card border rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {metricsUnreachable && (
            <p className="text-xs font-mono text-status-restrict">
              Metrics unreachable — the figures below are absent, not zero.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <MetricCard title="Total Decisions" value={formatNumber(metrics?.totalDecisions)} />
            <MetricCard title="Allow Rate" value={formatRate(metrics?.allowRate)} />
            <MetricCard title="Restrict/Deny" value={formatRate(metrics?.restrictDenyRate)} />
            <MetricCard title="Avg Latency" value={formatLatency(metrics?.avgLatencyMs)} />
          </div>
        </>
      )}

      {series && (
        <div className="bg-card border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Decision Volume (24h)</h2>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.series}>
                <Bar dataKey="allow" stackId="a" fill="hsl(var(--chart-2))" />
                <Bar dataKey="stepUp" stackId="a" fill="hsl(var(--chart-3))" />
                <Bar dataKey="restrict" stackId="a" fill="hsl(var(--chart-4))" />
                <Bar dataKey="deny" stackId="a" fill="hsl(var(--destructive))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {integrationsData && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Integration Health</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scroll-area">
            {integrationsData.integrations.map(int => (
              <div key={int.id} className="shrink-0 w-40 bg-card border rounded-xl p-3 flex flex-col space-y-2">
                <div className="flex justify-between items-start">
                  <StatusDot status={int.status} />
                  <span className="text-xs font-mono text-muted-foreground">{formatLatency(int.latencyMs)}</span>
                </div>
                <div>
                  <div className="text-sm font-medium truncate">{int.vendor}</div>
                  <div className="text-xs text-muted-foreground truncate">{int.product}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value }: { title: string, value: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex flex-col active:scale-95 transition-transform">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <span className="text-xl font-mono font-semibold mt-1">{value}</span>
    </div>
  );
}
