import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type FlowHealthRow, type DiscoveredSignal } from "@/lib/control-plane";

// Design law (docs/ADMIN_DESIGN_PRINCIPLE.md): exceptions first, calm by default,
// only necessary data, one source of truth (all read live from /cp/v1).

const STATUS_DOT: Record<string, string> = { healthy: "bg-emerald-400", degraded: "bg-amber-400", broken: "bg-red-400" };
const COV_DOT: Record<string, string> = { auto_handled: "bg-emerald-400", partial: "bg-amber-400", blind_spot: "bg-red-400" };
const COV_TEXT: Record<string, string> = { auto_handled: "text-emerald-400", partial: "text-amber-400", blind_spot: "text-red-400" };

// Coverage wording, derived from `coverage.basis` rather than written into the markup.
//
// `/cp/v1/grid/coverage` serves a PROJECTION: the signal states are inferred from each
// source's acquisition method, so nothing was contacted and the figures are a ceiling.
// This panel used to be titled "situations handled autonomously" and paint 100%
// emerald — an operator reading it would believe the Grid was running responses it had
// never been asked to run. Green now requires an OBSERVED basis, because green means
// measured, and "auto handled" becomes "could handle" when nothing was measured.
const projected = (b: string | undefined) => b === "projected_from_sourcing";
const covTitle = (b: string | undefined) =>
  projected(b) ? "Build the grid · situations this sourcing posture could handle" : "Build the grid · situations handled autonomously";
const covLabel = (b: string | undefined) => (projected(b) ? "Coverage ceiling" : "Coverage");
const covRowText = (status: string, b: string | undefined) =>
  (projected(b) && status === "auto_handled" ? "could handle" : status.replace(/_/g, " "));
const covAccent = (pct: number | undefined, b: string | undefined) =>
  pct === 100 && !projected(b) ? "text-emerald-400" : "text-amber-400";
const CLASS_STYLE: Record<string, string> = {
  evaluated: "border-emerald-400/30 text-emerald-400",
  candidate: "border-amber-400/30 text-amber-400",
  novel: "border-primary/30 text-primary",
};

export function Intelligence() {
  const flows = useQuery({ queryKey: ["cp-flows-health"], queryFn: () => controlPlane.flowsHealth() });
  const recs = useQuery({ queryKey: ["cp-recs"], queryFn: () => controlPlane.recommendations() });
  const disc = useQuery({ queryKey: ["cp-discovery"], queryFn: () => controlPlane.signalDiscovery() });
  const covQ = useQuery({ queryKey: ["cp-grid-coverage"], queryFn: () => controlPlane.gridCoverage() });
  const cfgQ = useQuery({ queryKey: ["cp-grid-config"], queryFn: () => controlPlane.gridConfig() });
  const provQ = useQuery({ queryKey: ["cp-provisioning"], queryFn: () => controlPlane.provisioning() });
  const resQ = useQuery({ queryKey: ["cp-app-resilience"], queryFn: () => controlPlane.appResilience() });

  const cov = covQ.data;
  const cfg = cfgQ.data;
  const prov = provQ.data;
  const appRes = resQ.data;

  const grid = flows.data?.grid;
  const attention = (flows.data?.flows ?? []).filter((f) => f.health.status !== "healthy");
  const recList = recs.data ?? [];
  const discovered = disc.data?.discovered ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Grid intelligence</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">FLOW HEALTH · RECOMMENDATIONS · SIGNAL DISCOVERY (FIXTURE)</p>
      </div>

      {/* Build the grid — the decision-fabric layer, live from /cp/v1 */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-primary">{covTitle(cov?.coverage.basis)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label={covLabel(cov?.coverage.basis)} value={cov ? `${cov.coverage.coveragePct}%` : "-"} sub={cov ? `${cov.coverage.handled}/${cov.coverage.total} situations` : ""} accent={cov ? covAccent(cov.coverage.coveragePct, cov.coverage.basis) : undefined} />
            <Metric label="Signals sourced" value={cov ? `${cov.sourcing.wireable}/${cov.sourcing.total}` : "-"} sub={cov ? `${cov.sourcing.vendorIntegrated} vendor · ${cov.sourcing.gridCollected} grid-lifted` : ""} />
            <Metric label="Config" value={cfg ? (cfg.valid ? "valid" : "invalid") : "-"} sub={cfg ? `${cfg.summary.errors} errors · ${cfg.summary.warnings} warnings` : ""} accent={cfg ? (cfg.valid ? "text-emerald-400" : "text-red-400") : undefined} />
            <Metric label="Apps workable" value={appRes ? `${appRes.fleet.workable}/${appRes.fleet.total}` : "-"} sub={appRes ? (appRes.fleet.blocked ? `${appRes.fleet.blocked} blocked` : "all workable") : ""} accent={appRes ? (appRes.fleet.blocked ? "text-amber-400" : "text-emerald-400") : undefined} />
          </div>
          <div className="space-y-1.5">
            {(cov?.coverage.situations ?? []).map((s) => (
              <div key={s.situationId} className="flex items-center justify-between gap-3 text-xs font-mono">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${COV_DOT[s.status] ?? "bg-muted"}`} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={`shrink-0 uppercase ${COV_TEXT[s.status] ?? "text-muted-foreground"}`}>
                  {covRowText(s.status, cov?.coverage.basis)}{s.missingSignals.length > 0 ? ` · needs ${s.missingSignals.join(", ")}` : ""}
                </span>
              </div>
            ))}
            {!cov && <div className="text-sm text-muted-foreground">Loading…</div>}
          </div>
          <p className="text-[0.68rem] text-muted-foreground font-mono">
            Add a signal and the Grid sees more; add a workflow and it does more. Provisioning is simulated{prov ? ` (${prov.plan.requiresApproval} step${prov.plan.requiresApproval === 1 ? "" : "s"} would await approval)` : ""}; enforcement stays off until an owner enables it. Read live from <span className="text-muted-foreground">/cp/v1</span> — nothing is enforced.
          </p>
        </CardContent>
      </Card>

      {/* Rollup — the few numbers that matter */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Grid smartness" value={grid ? `${grid.smartnessScore}` : "-"} sub={grid ? `${grid.signalsHealthy}/${grid.signalsWired} signals healthy` : ""} accent={!grid ? undefined : grid.smartnessScore >= 66 ? "text-emerald-400" : "text-amber-400"} />
        {/* "all clear" is EARNED, not defaulted: with flows.data absent (error or
            loading) the emerald branch is unreachable — a failed flow-health query
            must never read as a healthy grid. */}
        <Metric label="Flows healthy" value={grid ? `${grid.flowsHealthy}/${grid.flowsTotal}` : "-"} sub={!flows.data ? (flows.isError ? "unavailable" : "…") : attention.length ? `${attention.length} need attention` : "all clear"} accent={!flows.data ? undefined : attention.length ? "text-amber-400" : "text-emerald-400"} />
        <Metric label="Recommendations" value={String(recList.length)} sub="ranked by confidence" />
        <Metric label="New signals" value={disc.data ? `${disc.data.summary.autoOnboardable}` : "-"} sub={disc.data ? `auto-onboardable · ${disc.data.summary.needsAdmin} need admin` : ""} />
      </div>

      {/* Needs attention — the loud part, only when there's something */}
      {attention.length > 0 && (
        <Card className="border-red-400/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-red-400">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map((f) => <FlowAttentionRow key={f.flow.id} row={f} />)}
          </CardContent>
        </Card>
      )}

      {/* A failed flow-health read is surfaced, never swallowed into "all clear". */}
      {flows.isError && (
        <Card className="border-red-400/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-red-400">Flow health unavailable</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xs text-muted-foreground">
            {String(flows.error instanceof Error ? flows.error.message : flows.error)}
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Recommendations · the Grid learned</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recList.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
              <span className="font-mono text-xs w-10 shrink-0 text-primary">{Math.round(r.confidence * 100)}%</span>
              <div className="min-w-0">
                <div className="text-sm">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.suggestedChange}</div>
              </div>
            </div>
          ))}
          {recs.data && recList.length === 0 && <div className="text-sm text-muted-foreground">No recommendations — nothing to change right now.</div>}
          {!recs.data && <div className="text-sm text-muted-foreground">Loading…</div>}
          <p className="text-[0.68rem] text-muted-foreground font-mono pt-1">Advisory only — an admin reviews and applies. The Grid changes nothing on its own.</p>
        </CardContent>
      </Card>

      {/* Signal discovery */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Signal discovery · what was detected</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-1.5 font-medium">SIGNAL</th>
                  <th className="text-left pb-1.5 font-medium">SOURCE</th>
                  <th className="text-left pb-1.5 font-medium">CLASS</th>
                  <th className="text-left pb-1.5 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {discovered.map((s: DiscoveredSignal) => (
                  <tr key={`${s.sourceId}:${s.category}`} className="hover:bg-muted/20">
                    <td className="py-1.5">{s.category}</td>
                    <td className="py-1.5 text-muted-foreground">{s.sourceName}</td>
                    <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded border ${CLASS_STYLE[s.class]}`}>{s.class}</span></td>
                    <td className="py-1.5">
                      {s.lifecycle === "active" ? (
                        <span className="text-emerald-400">active</span>
                      ) : s.autoOnboardable ? (
                        <span className="text-primary">proposed · will auto-onboard</span>
                      ) : (
                        <span className="text-amber-400">proposed · needs admin</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!disc.data && <tr><td colSpan={4} className="py-2 text-muted-foreground">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[0.68rem] text-muted-foreground font-mono pt-2">Detected, not yet applied — the more sources/APIs you open, the more the Grid detects. An unrecognized signal from an API source is proposed to be onboarded automatically (a plan you see before it runs); others wait for an admin. Nothing is added to a source here.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FlowAttentionRow({ row }: { row: FlowHealthRow }) {
  const r = row.resolution;
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-mono">
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[row.health.status]}`} />
        <span className="truncate">{row.flow.name}</span>
        {row.health.brokenSignals.length > 0 && <span className="text-muted-foreground truncate">· {row.health.brokenSignals.join(", ")}</span>}
      </span>
      <span className="shrink-0">
        {r.kind === "self_heal" ? (
          <span className="text-primary">self-heal · {r.plan.agent}{r.plan.autoResolves ? "" : " (+ incident)"}</span>
        ) : r.kind === "incident" ? (
          <span className="text-red-400 uppercase">{r.incident.severity} → {r.incident.supportTeam}</span>
        ) : null}
      </span>
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
