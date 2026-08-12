import React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane } from "@/lib/control-plane";

// Grid overview — the whole grid at a glance (the capstone of the Build-the-grid
// surfaces). Composes the five read-only rollups the mobile PWA already exposes —
// coverage, signal sourcing, config, provisioning, app resilience — into one
// status, so "the grid which is the entire infrastructure" reads in a single
// screen. It is a composition of existing /cp/v1 reads; it adds no new authority
// and enforces nothing.

export function GridOverview() {
  const cov = useQuery({ queryKey: ["cp-grid-coverage"], queryFn: () => controlPlane.gridCoverage() });
  const src = useQuery({ queryKey: ["cp-grid-sourcing"], queryFn: () => controlPlane.gridSourcing() });
  const cfg = useQuery({ queryKey: ["cp-grid-config-page"], queryFn: () => controlPlane.gridConfig() });
  const prov = useQuery({ queryKey: ["cp-provisioning"], queryFn: () => controlPlane.provisioning() });
  const res = useQuery({ queryKey: ["cp-app-resilience-page"], queryFn: () => controlPlane.appResilience() });

  const coverage = cov.data?.coverage;
  // `/cp/v1/grid/coverage` serves a projection — states inferred from acquisition
  // method, nothing contacted — so these figures are a ceiling, not a reading. The
  // hero metric used to paint 100% emerald and the pillar card used to say "handled".
  // Green is reserved for an observed basis, because green means measured.
  const covProjected = coverage?.basis === "projected_from_sourcing";
  const sourcing = src.data?.summary;
  const config = cfg.data;
  const plan = prov.data?.plan;
  const fleet = res.data?.fleet;

  const gaps = sourcing?.unavailable ?? 0;
  const blocked = fleet?.blocked ?? 0;
  const configOk = config?.valid ?? false;

  // The honest headline: autonomous where every dependency holds; the caveats are
  // named, never hidden (gaps in sourcing, blocked apps, config errors).
  const caveats: string[] = [];
  // The caveat that was missing, and the one that gates the green line below.
  //
  // "The grid is handling its situations on its own" is a claim about now. Coverage
  // from a projection is a claim about a ceiling — no signal was observed, nothing was
  // contacted. The old caveat list named signal gaps, blocked apps and config errors,
  // all real; it had no entry for "this number was never measured", so an estate with
  // no `unavailable` signals would show a full green all-clear computed entirely from
  // acquisition method.
  //
  // This makes the green branch unreachable while /cp/v1 serves a projection, which is
  // the correct outcome rather than a regression: that sentence cannot be earned by a
  // ceiling. It becomes reachable again the moment coverage is computed from observed
  // signal states, which is exactly when it would be true.
  if (covProjected) caveats.push("coverage is a ceiling, not a reading — no signal was observed");
  if (gaps > 0) caveats.push(`${gaps} signal gap${gaps === 1 ? "" : "s"}`);
  if (blocked > 0) caveats.push(`${blocked} app${blocked === 1 ? "" : "s"} blocked`);
  if (config && !configOk) caveats.push(`${config.summary.errors} config error${config.summary.errors === 1 ? "" : "s"}`);
  // Fail-safe honesty: only claim "all clear" once EVERY surface has loaded.
  // Caveats accumulate only from data already in hand, so gating the green state
  // on `anyLoaded` would read false-green while a slow/errored surface (whose
  // gaps/blocked default to 0) is still pending. Require all five.
  const anyLoaded = cov.data || src.data || cfg.data || prov.data || res.data;
  const allLoaded = cov.data && src.data && cfg.data && prov.data && res.data;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Grid</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">THE WHOLE GRID AT A GLANCE · READ-ONLY · FIXTURE</p>
      </div>

      {/* Hero status */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-primary">Grid status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label={covProjected ? "Coverage ceiling" : "Coverage"} value={coverage ? `${coverage.coveragePct}%` : "-"} accent={coverage && coverage.coveragePct === 100 && !covProjected ? "text-emerald-400" : "text-amber-400"} sub={coverage ? `${coverage.handled}/${coverage.total} situations` : ""} />
            <Metric label="Signals sourced" value={sourcing ? `${sourcing.wireable}/${sourcing.total}` : "-"} accent={sourcing ? (sourcing.unavailable ? "text-amber-400" : "text-emerald-400") : undefined} sub={sourcing ? `${sourcing.vendorIntegrated} vendor · ${sourcing.gridCollected} grid-lifted` : ""} />
            <Metric label="Config" value={config ? (configOk ? "valid" : "invalid") : "-"} accent={config ? (configOk ? "text-emerald-400" : "text-red-400") : undefined} sub={config ? `${config.summary.errors} err · ${config.summary.warnings} warn` : ""} />
            <Metric label="Apps workable" value={fleet ? `${fleet.workable}/${fleet.total}` : "-"} accent={fleet ? (fleet.blocked ? "text-amber-400" : "text-emerald-400") : undefined} sub={fleet ? (fleet.blocked ? `${fleet.blocked} blocked` : "all workable") : ""} />
          </div>
          <p className="text-sm">
            {!anyLoaded ? (
              <span className="text-muted-foreground">Loading the grid…</span>
            ) : caveats.length > 0 ? (
              <span className="text-amber-400">The grid runs, with named caveats: {caveats.join(" · ")}. Nothing is papered over.</span>
            ) : !allLoaded ? (
              <span className="text-muted-foreground">Reading the grid… (no issues in what has loaded so far)</span>
            ) : (
              <span className="text-emerald-400">The grid is handling its situations on its own — every dependency holds.</span>
            )}
          </p>
          <p className="text-[0.68rem] text-muted-foreground font-mono">
            Add a signal and the grid sees more; add a workflow and it does more. Provisioning is simulated{plan ? ` (${plan.requiresApproval} step${plan.requiresApproval === 1 ? "" : "s"} would await approval)` : ""}; enforcement stays off until an owner enables it. Composed live from <span className="text-muted-foreground">/cp/v1</span> — nothing is enforced.
          </p>
        </CardContent>
      </Card>

      {/* Pillars — each links to its surface */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PillarCard href="/intelligence" title="Grid intelligence" line={coverage ? `${coverage.coveragePct}% ${covProjected ? "ceiling" : "coverage"} · ${coverage.handled}/${coverage.total} ${covProjected ? "reachable" : "handled"}` : "flow health · recommendations"} />
        <PillarCard href="/signal-sourcing" title="Signal sourcing" line={sourcing ? `${sourcing.wireable}/${sourcing.total} wireable · ${gaps} gap${gaps === 1 ? "" : "s"}` : "how each signal reaches the grid"} tone={gaps > 0 ? "warn" : "ok"} />
        <PillarCard href="/grid-config" title="Grid config" line={config ? `${config.summary.workflows} workflows · ${config.summary.signals} signals · ${configOk ? "valid" : "invalid"}` : "workflows as code"} tone={config ? (configOk ? "ok" : "bad") : undefined} />
        <PillarCard href="/provisioning" title="Device recorder" line={plan ? `${plan.steps.length} steps · ${plan.matched ? "matched" : "no match"} · simulated` : "zero-touch provisioning"} />
        <PillarCard href="/app-resilience" title="App resilience" line={fleet ? `${fleet.workable}/${fleet.total} workable · ${blocked} blocked` : "work through cloud downtime"} tone={blocked > 0 ? "warn" : "ok"} />
      </div>
    </div>
  );
}

function PillarCard({ href, title, line, tone }: { href: string; title: string; line: string; tone?: "ok" | "warn" | "bad" }) {
  const dot = tone === "bad" ? "bg-red-400" : tone === "warn" ? "bg-amber-400" : tone === "ok" ? "bg-emerald-400" : "bg-muted";
  return (
    <Link href={href}>
      <Card className="border-border hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
              {title}
            </div>
            <div className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{line}</div>
          </div>
          <span className="text-muted-foreground shrink-0 font-mono text-xs">→</span>
        </CardContent>
      </Card>
    </Link>
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

export default GridOverview;
