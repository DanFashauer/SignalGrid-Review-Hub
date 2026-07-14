import React, { useState } from "react";
import { useListDecisions } from "@workspace/api-client-react";

const OUTCOMES = ["all", "allow", "step-up", "restrict", "deny"] as const;
type Filter = typeof OUTCOMES[number];

const OUTCOME_COLOR: Record<string, string> = {
  allow: "text-green-400", deny: "text-red-400",
  "step-up": "text-yellow-400", restrict: "text-orange-400",
};

type DecRow = { id: string; identityId: string; deviceId: string; workflowId: string; outcome: string; latencyMs: number; evaluatedAt: string };

function exportCSV(rows: DecRow[]) {
  if (!rows.length) return;
  const header = ["id", "identity", "device", "workflow", "outcome", "latency_ms", "evaluated_at"];
  const body = rows.map(d =>
    [d.id, d.identityId, d.deviceId, d.workflowId, d.outcome, d.latencyMs, d.evaluatedAt].join(",")
  );
  const csv = [header.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `decisions-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function DecisionsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading } = useListDecisions({
    limit: 200,
    outcome: filter === "all" ? undefined : filter as any,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Decisions</h1>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">RUNTIME ACCESS DECISION LOG</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {OUTCOMES.map(o => (
              <button
                key={o}
                onClick={() => setFilter(o)}
                className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                  filter === o
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {o.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={() => exportCSV(data?.decisions ?? [])}
            className="px-3 py-1 text-xs font-mono rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          >
            EXPORT CSV
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[120px_1fr_1fr_160px_80px_120px] text-xs font-mono text-muted-foreground border-b border-border bg-background/50 px-3 py-2">
          <span>OUTCOME</span>
          <span>IDENTITY</span>
          <span>DEVICE ID</span>
          <span>WORKFLOW</span>
          <span className="text-right">LATENCY</span>
          <span className="text-right">TIME</span>
        </div>
        <div className="divide-y divide-border/50 max-h-[calc(100vh-16rem)] overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-9 bg-muted/10 animate-pulse mx-3 my-1 rounded" />
            ))
          ) : data?.decisions.map(d => (
            <div key={d.id} className="grid grid-cols-[120px_1fr_1fr_160px_80px_120px] px-3 py-2 hover:bg-muted/20 transition-colors text-xs font-mono decision-row">
              <span className={`font-semibold ${OUTCOME_COLOR[d.outcome] ?? "text-muted-foreground"}`}>{d.outcome.toUpperCase()}</span>
              <span className="text-foreground/80 truncate pr-2">{d.identityId}</span>
              <span className="text-muted-foreground truncate pr-2">{d.deviceId}</span>
              <span className="text-muted-foreground truncate pr-2">{d.workflowId}</span>
              <span className="text-right text-muted-foreground">{d.latencyMs}ms</span>
              <span className="text-right text-muted-foreground">{new Date(d.evaluatedAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-xs font-mono text-muted-foreground">
        {data?.total.toLocaleString() ?? 0} total decisions · {data?.decisions.length ?? 0} shown
      </div>
    </div>
  );
}
