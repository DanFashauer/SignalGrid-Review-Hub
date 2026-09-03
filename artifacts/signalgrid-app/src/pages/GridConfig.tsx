import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type GridConfigWorkflow } from "@/lib/control-plane";

// Workflows as code (docs/OPEN_ORCHESTRATION_VISION.md): the grid an organization
// commits to Git — signals, workflows, situations — as one declarative artifact.
// The CI/CD pipeline validates it (like this, fail-safe) BEFORE the Grid runs it,
// so a misconfiguration is a failed check, not a silent gap in production. This
// view renders that artifact and its validation, read-only.

const METHOD_STYLE: Record<string, string> = {
  api: "text-emerald-400", native: "text-emerald-400", grid_collected: "text-primary", unavailable: "text-red-400",
};
const APPROVAL_STYLE: Record<string, string> = {
  automated: "border-emerald-400/30 text-emerald-400",
  admin_approval: "border-amber-400/30 text-amber-400",
  dual_approval: "border-orange-400/30 text-orange-400",
  user_override_on_downtime: "border-sky-400/30 text-sky-400",
};

export function GridConfig() {
  const q = useQuery({ queryKey: ["cp-grid-config-page"], queryFn: () => controlPlane.gridConfig() });
  const data = q.data;
  const cfg = data?.config;
  const errors = (data?.issues ?? []).filter((i) => i.severity === "error");
  const warnings = (data?.issues ?? []).filter((i) => i.severity === "warning");

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Grid config</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">WORKFLOWS AS CODE · COMMIT TO GIT · CI VALIDATES · FIXTURE</p>
      </div>

      {/* Validation banner */}
      <Card className={data ? (data.valid ? "border-emerald-400/30" : "border-red-400/30") : "border-border"}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm font-mono uppercase tracking-wider ${data ? (data.valid ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"}`}>
            {data ? (data.valid ? "Config valid · the pipeline would let this merge" : "Config invalid · the pipeline would block this") : "Validating…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Signals" value={data ? String(data.summary.signals) : "-"} />
            <Metric label="Workflows" value={data ? String(data.summary.workflows) : "-"} />
            <Metric label="Errors" value={data ? String(data.summary.errors) : "-"} accent={data ? (data.summary.errors ? "text-red-400" : "text-emerald-400") : undefined} />
            <Metric label="Warnings" value={data ? String(data.summary.warnings) : "-"} accent={data && data.summary.warnings ? "text-amber-400" : undefined} />
          </div>
          {(errors.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {errors.map((e, i) => <div key={`e${i}`} className="text-xs font-mono text-red-400">✕ {e.code} · {e.subject}: {e.message}</div>)}
              {warnings.map((w, i) => <div key={`w${i}`} className="text-xs font-mono text-amber-400">! {w.code} · {w.subject}: {w.message}</div>)}
            </div>
          )}
          {data?.governance && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className={`px-2 py-0.5 rounded border ${data.governance.complete ? "border-emerald-400/30 text-emerald-400" : "border-amber-400/30 text-amber-400"}`}>
                Governance {data.governance.complete ? "complete" : `${data.governance.governanceGaps} gap${data.governance.governanceGaps === 1 ? "" : "s"}`}
              </span>
              <span className="text-muted-foreground">{data.governance.owned}/{data.governance.workflows} owned · {data.governance.accountable}/{data.governance.workflows} accountable</span>
            </div>
          )}
          <p className="text-[0.68rem] text-muted-foreground font-mono">
            Technology grants access; governance decides who should have it. Coverage at full health: {data?.summary.coveragePctAtFullHealth ?? "—"}{data?.summary.coveragePctAtFullHealth != null ? "%" : ""} · the same declarative config lives at <span className="text-muted-foreground">config/grid/example.grid.config.json</span>.
          </p>
        </CardContent>
      </Card>

      {/* Signals */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Signals · {cfg?.signals.length ?? 0}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(cfg?.signals ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-xs font-mono">
              <span className="min-w-0 truncate"><span className="text-muted-foreground">{s.id}</span> · {s.name}</span>
              <span className="shrink-0 flex items-center gap-2">
                <span className="text-muted-foreground">{s.system}</span>
                <span className={`uppercase ${METHOD_STYLE[s.method] ?? "text-muted-foreground"}`}>{s.method.replace(/_/g, "-")}</span>
              </span>
            </div>
          ))}
          {!data && <div className="text-sm text-muted-foreground">Loading…</div>}
        </CardContent>
      </Card>

      {/* Workflows */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Workflows · {cfg?.workflows.length ?? 0}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(cfg?.workflows ?? []).map((w) => <WorkflowRow key={w.id} w={w} />)}
        </CardContent>
      </Card>

      {/* Situations */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Situations · {cfg?.situations.length ?? 0}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(cfg?.situations ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-xs font-mono">
              <span className="min-w-0 truncate">{s.label}</span>
              <span className="shrink-0 text-muted-foreground">→ {s.workflowId}</span>
            </div>
          ))}
          <p className="text-[0.68rem] text-muted-foreground font-mono pt-1">
            Add a signal and the Grid sees more; add a workflow and it does more. Nothing here is enforced — this is the config the Grid would run, validated before it runs. Read live from <span className="text-muted-foreground">/cp/v1/grid/config</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowRow({ w }: { w: GridConfigWorkflow }) {
  return (
    <div className="border-b border-border/30 last:border-0 pb-3 last:pb-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-mono">
        <span className="min-w-0 truncate"><span className="text-muted-foreground">{w.id}</span> · {w.name}</span>
        <span className="shrink-0 text-muted-foreground uppercase">{w.severityOnBreak} · {w.supportTeam}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-1 text-[0.62rem] font-mono">
        <span className={w.owner ? "text-muted-foreground" : "text-amber-400"}>owner: {w.owner ?? "— unowned"}</span>
        <span className={w.accountable ? "text-muted-foreground" : "text-amber-400"}>accountable: {w.accountable ?? "— none"}</span>
      </div>
      <div className="flex flex-wrap gap-1 pl-1">
        <span className="text-[0.62rem] text-muted-foreground font-mono self-center">needs</span>
        {w.requiredSignals.map((sig) => (
          <span key={sig} className="text-[0.62rem] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">{sig}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 pl-1">
        {w.actions.map((a) => (
          <span key={a.key} className={`text-[0.62rem] font-mono px-1.5 py-0.5 rounded border ${APPROVAL_STYLE[a.approval] ?? "border-border text-muted-foreground"}`}>
            {a.label} · {a.approval.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono font-bold tracking-tight mt-0.5 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

export default GridConfig;
