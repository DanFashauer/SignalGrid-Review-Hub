import React from "react";
import { Link } from "wouter";
import {
  useGetDashboardMetrics,
  useGetDecisionSeries,
  useListIntegrations,
  useListLatestSignals,
  IntegrationHealthStatus,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { getContextV1, listConnectorsV1, listDecisionsV1 } from "@/lib/v1";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { OutcomeBadge, IntegrationStatusBadge, SignalStatusBadge } from "@/components/StatusBadge";
import { LiveDecisionPanel } from "@/components/LiveDecisionPanel";
import { formatTimeAgo, formatDate } from "@/lib/format";

// Integration-health buckets, derived from the wire enum (lib/api-zod's generated
// IntegrationHealthStatus, re-exported by the client) rather than three literals.
// `Record<IntegrationHealthStatus, …>` is exhaustive by construction — add a member
// to the enum and this fails to compile until it has a tile. The literal list this
// replaces knew connected/degraded/disconnected only, so the served payload's 88
// `not-configured` integrations had no tile anywhere, and DOWN was structurally 0.
// `rank` orders the not-connected list worst-first so a slice never hides a
// disconnected integration behind an unconfigured one.
const HEALTH_BUCKET: Record<IntegrationHealthStatus, { label: string; text: string; dot: string; rank: number }> = {
  disconnected: { label: "DOWN", text: "text-red-400", dot: "bg-red-400", rank: 0 },
  degraded: { label: "DEGRADED", text: "text-yellow-400", dot: "bg-yellow-400", rank: 1 },
  "not-configured": { label: "NOT CONFIGURED", text: "text-muted-foreground", dot: "bg-gray-500", rank: 2 },
  connected: { label: "CONNECTED", text: "text-green-400", dot: "bg-green-400", rank: 3 },
};
const HEALTH_STATUSES = Object.values(IntegrationHealthStatus);
// A status the enum does not know is treated as the worst bucket, never dropped.
const bucketOf = (status: string) => HEALTH_BUCKET[status as IntegrationHealthStatus] ?? HEALTH_BUCKET.disconnected;

export function Dashboard() {
  const { data: metrics, isLoading: isLoadingMetrics } = useGetDashboardMetrics({ window: "24h" });
  const { data: seriesData, isError: seriesError } = useGetDecisionSeries({ window: "24h", granularity: "hour" });
  // The recent-decisions card reads the REAL /v1 ledger; the charts above it
  // remain labelled fixture telemetry until their own /v1 series exists.
  const { data: v1Decisions } = useQuery({ queryKey: ["v1-decisions"], queryFn: listDecisionsV1, refetchInterval: 15_000 });
  const { data: integrationsData, isError: integrationsError } = useListIntegrations();
  const { data: signalsData, isLoading: isLoadingSignals, error: signalsError } = useListLatestSignals({ limit: 10 });
  // Screen 2's summary embed (wireframe screen 1's named gap): launch-family
  // health from the same truth sources the setup page uses — the server's own
  // mode resolution off /v1/context and the real connector records off
  // /v1/connectors. Never a hopeful status.
  const { data: ctx, error: ctxError } = useQuery({ queryKey: ["v1-context"], queryFn: getContextV1 });
  const { data: v1Connectors } = useQuery({ queryKey: ["v1-connectors"], queryFn: listConnectorsV1 });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">24H SYSTEM TELEMETRY (FIXTURE)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total Decisions" value={metrics?.totalDecisions?.toLocaleString() || "-"} />
        <MetricCard title="Allow Rate" value={metrics ? `${(metrics.allowRate * 100).toFixed(1)}%` : "-"} />
        <MetricCard title="Restrict/Deny Rate" value={metrics ? `${(metrics.restrictDenyRate * 100).toFixed(1)}%` : "-"} />
        <MetricCard title="Avg Latency" value={metrics ? `${Math.round(metrics.avgLatencyMs)}ms` : "-"} />
      </div>

      <LiveDecisionPanel />

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
                    <stop offset="5%" stopColor="hsl(var(--decision-allow))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--decision-allow))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDeny" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--decision-deny))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--decision-deny))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(t) => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  tickMargin={10}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))' }}
                  labelFormatter={(t) => new Date(t).toLocaleString()}
                />
                <Area type="monotone" dataKey="allow" stroke="hsl(var(--decision-allow))" fillOpacity={1} fill="url(#colorAllow)" stackId="1" />
                <Area type="monotone" dataKey="stepUp" stroke="hsl(var(--decision-review))" fillOpacity={0.5} fill="hsl(var(--decision-review))" stackId="1" />
                <Area type="monotone" dataKey="restrict" stroke="hsl(var(--decision-deny))" strokeDasharray="4 2" fillOpacity={0.3} fill="hsl(var(--decision-deny))" stackId="1" />
                {/* Legend added 2026-08-25: this chart had none, so colour was the SOLE channel
                    distinguishing four verdicts — and restrict/deny share the ratified deny
                    tone, distinguished by a dash rather than an invented fourth colour. */}
                <Area type="monotone" dataKey="deny" stroke="hsl(var(--decision-deny))" fillOpacity={1} fill="url(#colorDeny)" stackId="1" />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">{seriesError ? "Decision series unavailable — the control plane did not answer." : "Loading chart..."}</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Recent decisions · /v1 core</CardTitle>
            <Link href="/decisions" className="text-xs text-primary hover:underline">View All</Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(v1Decisions ?? []).slice(0, 5).map(d => (
                <Link key={d.id} href={`/decisions/${d.id}`} className="flex items-center justify-between p-3 border border-border rounded bg-card/50 hover:bg-card/80 transition-colors">
                  <div className="flex items-center gap-3">
                    <OutcomeBadge outcome={d.outcome} />
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">{d.identityId}</span>
                      <span className="text-xs text-muted-foreground font-mono">{d.deviceId}</span>
                    </div>
                  </div>
                  <div className="text-right flex flex-col">
                    <span className="text-xs text-muted-foreground font-mono">{formatTimeAgo(d.createdAt)}</span>
                    <span className="text-xs font-mono text-muted-foreground">{Math.round(d.latencyMs)}ms</span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-8">
          <ConnectorHealthCard
            assurance={ctx?.assurance}
            error={ctxError}
            lastSync={v1Connectors?.find((c) => c.kind === "microsoft-entra-intune")?.lastSyncAt ?? null}
          />

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Integration Health</CardTitle>
              <Link href="/integrations" className="text-xs text-primary hover:underline">View All</Link>
            </CardHeader>
            <CardContent>
              {integrationsData ? (
                <div className="space-y-3">
                  {/* Summary counts */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {HEALTH_STATUSES.map((status) => {
                      const b = HEALTH_BUCKET[status];
                      const count = integrationsData.integrations.filter(i => i.status === status).length;
                      return (
                        <div key={status} className="p-3 border border-border rounded text-center">
                          <div className={`text-2xl font-mono font-bold ${b.text}`}>{count}</div>
                          <div className="text-xs font-mono text-muted-foreground mt-0.5">{b.label}</div>
                        </div>
                      );
                    })}
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
                  {/* Everything that is NOT connected belongs here — the alert filter
                      used to name two literals, so `not-configured` was neither a tile
                      nor an alert and read as fine by omission. Worst-first. */}
                  {(() => {
                    const notConnected = integrationsData.integrations
                      .filter(i => i.status !== "connected")
                      .slice()
                      .sort((a, b) => bucketOf(a.status).rank - bucketOf(b.status).rank);
                    if (notConnected.length === 0) return null;
                    return (
                      <div className="space-y-1.5 border-t border-border pt-2">
                        {notConnected.slice(0, 3).map(i => {
                          const b = bucketOf(i.status);
                          return (
                            <div key={i.id} className="flex items-center justify-between p-2 rounded bg-red-500/5 border border-red-500/10">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.dot}`} />
                                <span className="font-mono text-xs font-medium">{i.vendor}</span>
                              </div>
                              <span className={`text-xs font-mono ${b.text}`}>{b.label}</span>
                            </div>
                          );
                        })}
                        {notConnected.length > 3 && (
                          <div className="text-[10px] font-mono text-muted-foreground px-2">
                            +{notConnected.length - 3} more not connected
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-4 text-center">
                  {integrationsError ? "Integration health unavailable — the control plane did not answer." : "Loading…"}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Stale / non-compliant</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Unknown never renders as the good state: loading and error are
                  their own arms; "No stale…" shows only once the query has
                  RETURNED and nothing anomalous was in it. */}
              {isLoadingSignals ? (
                <div className="text-sm text-muted-foreground p-4 text-center">Loading…</div>
              ) : signalsError ? (
                <div className="text-sm text-muted-foreground font-mono p-4 text-center border border-dashed border-border rounded">
                  {String(signalsError instanceof Error ? signalsError.message : signalsError)}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Everything that is NOT known-good belongs here: `unknown` (an
                      unreachable connector) used to be excluded from both the list
                      and the emptiness test, so the "Stale / non-compliant" card read
                      "No stale or non-compliant signals" over a dark connector. */}
                  {(signalsData?.signals ?? []).filter(s => s.status !== 'nominal').slice(0, 3).map(s => (
                    <div key={s.id} className="p-2 text-sm border border-border rounded flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SignalStatusBadge status={s.status} />
                        <span className="font-mono">{s.platform}</span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">{formatTimeAgo(s.receivedAt)}</span>
                    </div>
                  ))}
                  {(signalsData?.signals ?? []).filter(s => s.status !== 'nominal').length === 0 && (
                    <div className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded">
                      No stale or non-compliant signals
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Shift Handoff Status */}
      <ShiftHandoffPanel />

    </div>
  );
}

// Static demo mock for a DEFERRED capability (device custody + shift handoff);
// the zones and custody state here are illustrative fixture data, not evaluated
// by the decision core.
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
          <p className="text-xs text-muted-foreground font-mono mt-0.5">DEVICE CUSTODY — DEFERRED capability · static demo mock, illustrative, not from the decision core</p>
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

// The three launch connector families, pinned by scripts/launch-profile.mjs.
// A static list is correct here: family membership is a declared, gated fact,
// not runtime data — checked by scripts/check-console-launch-families.mjs.
const LAUNCH_FAMILIES = [
  { id: "graph", reads: "Entra/Intune identity + device posture" },
  { id: "device-management-health", reads: "management-plane health rollup" },
  { id: "local-authority", reads: "offline local-authority grant state" },
];

function ConnectorHealthCard({ assurance, error, lastSync }: {
  assurance?: { tier: string; signalSource: "live" | "fixtures" };
  error: unknown;
  lastSync: string | null;
}) {
  const live = assurance?.signalSource === "live";
  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Connector health · launch families</CardTitle>
        <Link href="/connectors/setup" className="text-xs text-primary hover:underline">Setup</Link>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-xs text-muted-foreground font-mono p-2">{String(error instanceof Error ? error.message : error)}</div>
        ) : (
          <div className="space-y-1.5">
            {LAUNCH_FAMILIES.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 p-2 border border-border rounded bg-card/50">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold">{f.id}</span>
                  <span className="text-[10px] text-muted-foreground font-mono block truncate">{f.reads}</span>
                </div>
                <Badge variant="outline" className={`font-mono uppercase text-[10px] border-transparent shrink-0 ${live ? "bg-signal-nominal" : "bg-signal-unknown"}`}>
                  {assurance ? (live ? "live" : "fixture") : "…"}
                </Badge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground font-mono pt-1">
              {assurance
                ? live
                  ? "live read-only vendor reads — the connector refuses any non-GET by construction"
                  : `SIGNALGRID_TIER=${assurance.tier} — fixture-backed, working connectors; nothing leaves this process`
                : "resolving mode from /v1/context…"}
              {lastSync ? ` · last sync ${formatTimeAgo(lastSync)}` : ""}
            </p>
          </div>
        )}
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
