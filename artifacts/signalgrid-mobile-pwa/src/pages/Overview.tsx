import React, { useState, useEffect } from "react";
import { useGetDashboardMetrics, useGetDecisionSeries, useListIntegrations } from "@workspace/api-client-react";
import { formatNumber, formatLatency, formatRate } from "@/lib/format";
import { ResponsiveContainer, BarChart, Bar, Legend, Tooltip, XAxis } from "recharts";
import { StatusDot } from "@/components/StatusDot";
import { FixtureLabel } from "@/components/FixtureLabel";
import { OUTCOME_CHART_MARK, OUTCOME_ORDER, chartFill, hatchPatternId, type Outcome } from "@/lib/outcome-tone";

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
        <FixtureLabel className="mt-1" />
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
          <h2 className="text-sm font-medium text-muted-foreground">Decision Volume (24h, fixture)</h2>
          {/* Verdict fills, labels and patterns come from lib/outcome-tone.ts.
              Restrict and deny share the deny tone; restrict is hatched, so the
              two bands differ by more than colour, and the legend reproduces the
              hatch rather than a colour-only swatch. */}
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.series}>
                <defs>
                  {OUTCOME_ORDER.filter(o => OUTCOME_CHART_MARK[o].pattern === "hatch").map(o => (
                    <HatchPattern key={o} outcome={o} />
                  ))}
                </defs>
                <XAxis dataKey="timestamp" hide />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", fontSize: 12 }}
                  labelFormatter={(t) => new Date(String(t)).toLocaleTimeString()}
                />
                <Legend content={() => <ChartLegend />} />
                {OUTCOME_ORDER.map(o => (
                  <Bar
                    key={o}
                    dataKey={OUTCOME_CHART_MARK[o].dataKey}
                    name={OUTCOME_CHART_MARK[o].label}
                    stackId="a"
                    fill={chartFill(o)}
                    stroke="hsl(var(--card))"
                    strokeWidth={1}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {integrationsData && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Integration Health (fixture)</h2>
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

/** Diagonal stripes of the verdict's tone over the card — the non-colour channel. */
function HatchPattern({ outcome, scope = "chart" }: { outcome: Outcome; scope?: string }) {
  const color = `hsl(var(${OUTCOME_CHART_MARK[outcome].token}))`;
  return (
    <pattern id={hatchPatternId(outcome, scope)} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="4" fill="hsl(var(--card))" />
      <rect width="2" height="4" fill={color} />
    </pattern>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
      {OUTCOME_ORDER.map(o => (
        <div key={o} className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            {OUTCOME_CHART_MARK[o].pattern === "hatch" && (
              <defs><HatchPattern outcome={o} scope="legend" /></defs>
            )}
            <rect width="10" height="10" rx="2" fill={chartFill(o, "legend")} />
          </svg>
          <span className="text-xs font-mono text-muted-foreground uppercase">{OUTCOME_CHART_MARK[o].label}</span>
        </div>
      ))}
    </div>
  );
}
