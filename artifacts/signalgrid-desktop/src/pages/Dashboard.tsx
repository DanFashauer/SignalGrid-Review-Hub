import React from "react";
import { useGetDashboardMetrics, useGetDecisionSeries, useListDecisions, useListLatestSignals } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function DashboardPage() {
  const { data: metrics, isLoading } = useGetDashboardMetrics({ window: "24h" });
  const { data: series } = useGetDecisionSeries({ window: "24h", granularity: "hour" });
  const { data: decisions } = useListDecisions({ limit: 10 });
  const { data: signals } = useListLatestSignals({ limit: 8 });

  const METRICS = [
    { label: "TOTAL DECISIONS", value: metrics?.totalDecisions.toLocaleString() ?? "–" },
    { label: "ALLOW RATE", value: metrics ? `${(metrics.allowRate * 100).toFixed(1)}%` : "–", color: "text-green-400" },
    { label: "DENY / RESTRICT", value: metrics ? `${(metrics.restrictDenyRate * 100).toFixed(1)}%` : "–", color: "text-red-400" },
    { label: "AVG LATENCY", value: metrics ? `${Math.round(metrics.avgLatencyMs)}ms` : "–", color: "text-primary" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Overview</h1>
        <p className="text-xs font-mono text-muted-foreground mt-0.5">24H SYSTEM TELEMETRY (FIXTURE)</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        {METRICS.map(m => (
          <div key={m.label} className="bg-card border border-border rounded p-4">
            <div className="text-xs font-mono text-muted-foreground mb-1">{m.label}</div>
            <div className={`text-2xl font-mono font-bold tracking-tight ${m.color ?? "text-foreground"}`}>
              {isLoading ? <div className="h-8 w-16 bg-muted/40 rounded animate-pulse" /> : m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded p-4">
        <div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wider">Decision Volume (24h)</div>
        <div className="h-48">
          {series?.series ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series.series}>
                <defs>
                  <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--decision-allow))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--decision-allow))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--decision-deny))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--decision-deny))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="timestamp" tickFormatter={t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", fontSize: 12 }} labelFormatter={t => new Date(t).toLocaleString()} />
                <Area type="monotone" dataKey="allow" stroke="hsl(var(--decision-allow))" fillOpacity={1} fill="url(#ga)" stackId="1" />
                <Area type="monotone" dataKey="stepUp" stroke="hsl(var(--decision-review))" fillOpacity={0.4} fill="hsl(var(--decision-review))" stackId="1" />
                <Area type="monotone" dataKey="restrict" stroke="hsl(var(--decision-deny))" strokeDasharray="4 2" fillOpacity={0.25} fill="hsl(var(--decision-deny))" stackId="1" />
                <Area type="monotone" dataKey="deny" stroke="hsl(var(--decision-deny))" fillOpacity={1} fill="url(#gd)" stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
          )}
        </div>
        <div className="flex gap-4 mt-2">
          {/*
            RESTRICT and DENY are both painted from `--decision-deny` on purpose —
            only three decision tones are ratified, and the chart separates the two
            bands with a dash pattern rather than inventing a fourth colour.

            The legend used to reproduce the COLOUR and drop the PATTERN, so the two
            swatches were byte-identical: a computed 1.0000:1, no rendered boundary,
            on the only key the chart has. A reader could not tell which band was
            which, and restrict and deny are different operational outcomes.

            `dashed: true` gives RESTRICT the chart's own differentiator, so the key
            reproduces what the chart does instead of contradicting it.
          */}
          {[
            { c: "hsl(var(--decision-allow))", l: "ALLOW", dashed: false },
            { c: "hsl(var(--decision-review))", l: "STEP-UP", dashed: false },
            { c: "hsl(var(--decision-deny))", l: "RESTRICT", dashed: true },
            { c: "hsl(var(--decision-deny))", l: "DENY", dashed: false },
          ].map(({ c, l, dashed }) => (
            <div key={l} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-sm"
                style={
                  dashed
                    ? { border: `1px dashed ${c}`, background: "transparent" }
                    : { background: c }
                }
              />
              <span className="text-xs font-mono text-muted-foreground">{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Decision feed */}
        <div className="bg-card border border-border rounded p-4">
          <div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wider">Recent decisions (fixture)</div>
          <div className="space-y-1.5">
            {decisions?.decisions.slice(0, 8).map(d => (
              <div key={d.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/30 transition-colors decision-row">
                <span className={`text-xs font-mono font-semibold w-14 shrink-0 ${
                  d.outcome === "allow" ? "text-status-allow" :
                  d.outcome === "deny" ? "text-status-deny" :
                  d.outcome === "step-up" ? "text-status-step-up" : "text-status-restrict"
                }`}>{d.outcome.toUpperCase()}</span>
                <span className="text-xs font-mono text-foreground/80 truncate flex-1">{d.identityId}</span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">{d.latencyMs}ms</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signal feed */}
        <div className="bg-card border border-border rounded p-4">
          <div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wider">Signal Feed</div>
          <div className="space-y-1.5">
            {signals?.signals.slice(0, 8).map(s => (
              <div key={s.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                <span className={`text-xs font-mono font-semibold w-16 shrink-0 ${
                  s.status === "critical" ? "text-red-400" :
                  s.status === "anomalous" ? "text-orange-400" :
                  s.status === "nominal" ? "text-green-400" : "text-muted-foreground"
                }`}>{s.status.toUpperCase()}</span>
                <span className="text-xs font-mono text-foreground/80 truncate flex-1">{s.platform}</span>
                <span className="text-xs font-mono text-muted-foreground shrink-0 capitalize">{s.signalType.replace(/-/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
