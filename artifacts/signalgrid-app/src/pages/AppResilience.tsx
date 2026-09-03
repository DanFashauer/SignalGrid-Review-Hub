import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type AppResilienceRow } from "@/lib/control-plane";

// Application resilience (docs/APP_RESILIENCE.md): keep clinical staff working when
// a cloud app wobbles. Each app's availability becomes a resilience decision —
// normal, degraded-monitor, downtime-fallback, or (fail-safe) blocked. PHI is
// non-negotiable: a regulated app is never put on a fallback without its DR safety
// nets — it is blocked and surfaced, never dressed up as a workaround. Read-only.

const AVAIL_LABEL: Record<string, string> = {
  available: "available", degraded: "degraded", planned_maintenance: "maintenance",
  unplanned_outage: "outage", unknown: "unverified",
};

const MODE: Record<string, { dot: string; text: string; label: string }> = {
  normal: { dot: "bg-emerald-400", text: "text-emerald-400", label: "working normally" },
  degraded_monitor: { dot: "bg-amber-400", text: "text-amber-400", label: "proceed · watched" },
  downtime_fallback: { dot: "bg-sky-400", text: "text-sky-400", label: "on downtime fallback" },
  blocked_no_fallback: { dot: "bg-red-400", text: "text-red-400", label: "blocked · escalate" },
};

export function AppResilience() {
  const q = useQuery({ queryKey: ["cp-app-resilience-page"], queryFn: () => controlPlane.appResilience() });
  const fleet = q.data?.fleet;
  const apps = fleet?.apps ?? [];
  const blocked = apps.filter((a) => a.mode === "blocked_no_fallback");
  const working = apps.filter((a) => a.mode !== "blocked_no_fallback");

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">App resilience</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">WORK THROUGH CLOUD DOWNTIME · PHI-SAFE · FIXTURE</p>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Apps workable" value={fleet ? `${fleet.workable}/${fleet.total}` : "-"} accent={fleet ? (fleet.blocked ? "text-amber-400" : "text-emerald-400") : undefined} sub={fleet ? (fleet.allWorkable ? "all have a safe path" : `${fleet.blocked} blocked`) : ""} />
        <Metric label="On fallback" value={fleet ? String(fleet.onFallback) : "-"} accent={fleet && fleet.onFallback ? "text-sky-400" : undefined} sub="downtime path" />
        <Metric label="Degraded" value={fleet ? String(fleet.degraded) : "-"} accent={fleet && fleet.degraded ? "text-amber-400" : undefined} sub="proceed · watched" />
        <Metric label="Blocked" value={fleet ? String(fleet.blocked) : "-"} accent={fleet ? (fleet.blocked ? "text-red-400" : "text-emerald-400") : undefined} sub="no safe path" />
      </div>

      {/* Blocked — the loud part, only when something has no safe path */}
      {blocked.length > 0 && (
        <Card className="border-red-400/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-red-400">Blocked · escalate, do not improvise</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blocked.map((a) => <AppRow key={a.appId} app={a} />)}
          </CardContent>
        </Card>
      )}

      {/* The suite */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Clinical app suite · resilience posture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {working.map((a) => <AppRow key={a.appId} app={a} />)}
          {!q.data && <div className="text-sm text-muted-foreground">Loading…</div>}
          <p className="text-[0.68rem] text-muted-foreground font-mono pt-1">
            Availability is a sourced signal, not a vendor call. A PHI app is never placed on a fallback without its DR safety nets — it is blocked and surfaced. Nothing here is enforced; fallbacks are described, not executed. Read live from <span className="text-muted-foreground">/cp/v1/apps/resilience</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AppRow({ app }: { app: AppResilienceRow }) {
  const m = MODE[app.mode] ?? { dot: "bg-muted", text: "text-muted-foreground", label: app.mode };
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 text-sm font-mono">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
          <span className="truncate">{app.name}</span>
          <span className="text-muted-foreground text-xs shrink-0">· {AVAIL_LABEL[app.availability] ?? app.availability}</span>
        </div>
        <div className="text-xs text-muted-foreground pl-3.5">{app.reason}</div>
        {app.requiredSafetyNets.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-3.5 pt-0.5">
            {app.requiredSafetyNets.map((n) => (
              <span key={n} className="text-[0.62rem] font-mono px-1.5 py-0.5 rounded border border-sky-400/30 text-sky-400">{n}</span>
            ))}
          </div>
        )}
      </div>
      <span className={`shrink-0 text-xs font-mono uppercase ${m.text}`}>{m.label}</span>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl md:text-3xl font-mono font-bold tracking-tight ${accent ?? ""}`}>{value}</div>
        {sub && <div className="text-xs font-mono text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default AppResilience;
