import { useState } from "react";
import {
  integrationTargets,
  integrationStatusMeta,
  type IntegrationStatus,
} from "@/data/integrationData";

const categoryFilters = ["All", "Identity Provider", "MDM / UEM", "ITSM / Workflow", "SIEM / Analytics"] as const;

const priorityColors: Record<string, string> = {
  P1: "text-red-400 bg-red-900/30 border-red-800/50",
  P2: "text-amber-400 bg-amber-900/30 border-amber-800/50",
  P3: "text-stone-400 bg-stone-800/50 border-stone-700/50",
};

export default function IntegrationTrackerSection() {
  const [filter, setFilter] = useState<string>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = filter === "All"
    ? integrationTargets
    : integrationTargets.filter((t) => t.category === filter);

  const statusCounts = integrationTargets.reduce<Record<IntegrationStatus, number>>(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    },
    { "not-started": 0, "in-progress": 0, "sandbox-validated": 0, "demo-ready": 0 }
  );

  return (
    <div className="space-y-5">
      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["demo-ready", "sandbox-validated", "in-progress", "not-started"] as IntegrationStatus[]).map((s) => {
          const meta = integrationStatusMeta[s];
          return (
            <div key={s} className={`border border-border rounded-lg px-4 py-3 ${meta.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{statusCounts[s]}</p>
              <p className="text-xs text-muted-foreground">of {integrationTargets.length} targets</p>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        The runtime decision layer is only as good as the signals it can receive. Track integration progress against each target stack. First Intune/Entra proof is Priority 1 — it advances both product credibility and the integration surface coverage score.
      </p>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        {categoryFilters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Integration table */}
      <div className="space-y-2">
        {filtered.map((target) => {
          const meta = integrationStatusMeta[target.status];
          const isExpanded = expanded === target.id;
          return (
            <div key={target.id} className="border border-border bg-card rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : target.id)}
                className="w-full text-left px-5 py-3.5 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div className={`w-2 h-2 rounded-full ${meta.dot} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{target.vendor}</span>
                      <span className="text-sm text-muted-foreground">·</span>
                      <span className="text-sm text-muted-foreground">{target.product}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${priorityColors[target.priority]}`}>
                      {target.priority}
                    </span>
                    <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                    <div className="flex gap-1 ml-1">
                      {target.signalTypes.map((st) => (
                        <span key={st} className="text-xs px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                          {st}
                        </span>
                      ))}
                    </div>
                    <span className="text-muted-foreground text-sm ml-2">{isExpanded ? "−" : "+"}</span>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-5 py-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Integration Notes</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{target.notes}</p>
                  </div>
                  {target.blockers && (
                    <div>
                      <p className="text-xs font-semibold text-amber-400 tracking-wider uppercase mb-1">Current Blockers</p>
                      <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-amber-700 pl-3">
                        {target.blockers}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Category</p>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                      {target.category}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
