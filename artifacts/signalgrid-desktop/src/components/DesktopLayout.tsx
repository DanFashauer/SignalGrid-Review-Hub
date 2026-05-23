import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetDashboardMetrics, useListLatestSignals } from "@workspace/api-client-react";
import {
  LayoutDashboard, Activity, Shield, Puzzle, Settings, Bell,
  ChevronRight, Wifi, Database, Clock, AlertTriangle, CheckCircle2,
  GitBranch, Monitor
} from "lucide-react";

const NAV = [
  { path: "/", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/decisions", icon: Shield, label: "Decisions" },
  { path: "/signals", icon: Activity, label: "Signals" },
  { path: "/handoff", icon: GitBranch, label: "Shift Handoff" },
  { path: "/integrations", icon: Puzzle, label: "Integrations" },
  { path: "/policies", icon: Settings, label: "Policies" },
];

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [time, setTime] = useState(new Date());
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: metrics } = useGetDashboardMetrics({ window: "1h" });
  const { data: signals } = useListLatestSignals({ limit: 5 });

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const anomalous = signals?.signals.filter(s => s.status === "anomalous" || s.status === "critical") ?? [];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">

      {/* Title bar */}
      <div className="titlebar h-9 bg-[hsl(222.2_84%_3.2%)] border-b border-border flex items-center px-3 gap-3 shrink-0 select-none">
        {/* macOS window controls style */}
        <div className="flex gap-1.5 shrink-0">
          <div className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 cursor-default transition-colors" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 cursor-default transition-colors" />
          <div className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 cursor-default transition-colors" />
        </div>

        <div className="flex items-center gap-2 flex-1">
          <div className="h-4 w-4 rounded-sm bg-primary flex items-center justify-center shrink-0">
            <div className="h-1.5 w-1.5 rounded-full bg-background" />
          </div>
          <span className="text-xs font-bold tracking-widest text-foreground/70 font-mono">SIGNALGRID DESKTOP</span>
          <span className="text-xs font-mono text-muted-foreground">v2.1.0</span>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot" />
            <span className="text-xs font-mono text-muted-foreground">ENGINE LIVE</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
            <Wifi className="w-3 h-3" />
            <span>{metrics?.activeIntegrations ?? "–"}/{metrics?.totalIntegrations ?? "–"} CONNECTED</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>

          {/* Notification bell */}
          <button
            onClick={() => setNotifOpen(o => !o)}
            className="relative p-1 rounded hover:bg-muted/50 transition-colors"
          >
            <Bell className="w-3.5 h-3.5 text-muted-foreground" />
            {anomalous.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                {anomalous.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className="w-48 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 overflow-hidden">
          <div className="px-3 pt-4 pb-2">
            <div className="text-xs font-mono text-muted-foreground/60 uppercase tracking-widest mb-3 px-2">Navigation</div>
            <nav className="space-y-0.5">
              {NAV.map(({ path, icon: Icon, label }) => {
                const active = path === "/" ? location === "/" : location.startsWith(path);
                return (
                  <Link
                    key={path}
                    href={path}
                    className={`flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors ${
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                    {active && <ChevronRight className="w-3 h-3 ml-auto" />}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-auto border-t border-sidebar-border p-3 space-y-2">
            <div className="text-xs font-mono text-muted-foreground/60 uppercase tracking-widest mb-2">System</div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Decision Engine</span>
              <span className="text-green-400">HEALTHY</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">DB Pool</span>
              <span className="text-green-400">OK</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Signal Queue</span>
              <span className="text-primary">LIVE</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Avg Latency</span>
              <span className="text-foreground">{metrics ? `${Math.round(metrics.avgLatencyMs)}ms` : "–"}</span>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto min-w-0">
          {children}
        </main>

        {/* Notification panel */}
        {notifOpen && (
          <div className="absolute right-0 top-0 w-80 h-full bg-card border-l border-border flex flex-col z-50">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="text-sm font-semibold">Alerts</span>
              <button onClick={() => setNotifOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {anomalous.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                  <span className="text-sm">No active alerts</span>
                </div>
              ) : (
                anomalous.map(s => (
                  <div key={s.id} className="p-3 rounded border border-red-500/20 bg-red-500/5 space-y-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="text-xs font-mono font-semibold text-red-300">{s.status.toUpperCase()}</span>
                      <span className="text-xs font-mono text-muted-foreground ml-auto">{s.platform}</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{s.deviceId}</div>
                    <div className="text-xs font-mono text-muted-foreground">{s.signalType}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[hsl(222.2_84%_3.2%)] border-t border-border flex items-center px-4 gap-6 shrink-0">
        <div className="flex items-center gap-1.5">
          <Monitor className="w-3 h-3 text-muted-foreground/60" />
          <span className="text-xs font-mono text-muted-foreground/60">SignalGrid Desktop · macOS / Windows / Linux</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Database className="w-3 h-3 text-muted-foreground/60" />
          <span className="text-xs font-mono text-muted-foreground/60">PostgreSQL · Connected</span>
        </div>
        {metrics && (
          <span className="text-xs font-mono text-muted-foreground/60">
            {metrics.totalDecisions.toLocaleString()} decisions · {(metrics.allowRate * 100).toFixed(1)}% allow
          </span>
        )}
      </div>
    </div>
  );
}
