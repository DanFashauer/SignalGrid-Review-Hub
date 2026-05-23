import React, { useState } from "react";
import { useListDecisions, useGetDecision, ListDecisionsOutcome } from "@workspace/api-client-react";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { BottomSheet } from "@/components/BottomSheet";
import { StatusDot } from "@/components/StatusDot";
import { formatTimeAgo, formatLatency } from "@/lib/format";

export default function Decisions() {
  const [filter, setFilter] = useState<ListDecisionsOutcome | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useListDecisions({ 
    limit: 100, 
    outcome: filter === "all" ? undefined : filter 
  });

  const { data: detailData, isLoading: detailLoading } = useGetDecision(selectedId || "", {
    query: { enabled: !!selectedId, queryKey: ["decision", selectedId] },
  });

  const filters = ["all", "allow", "step-up", "restrict", "deny"] as const;

  return (
    <div className="h-full w-full flex flex-col pt-safe bg-background">
      <header className="px-4 py-3 shrink-0 bg-background z-10 border-b border-border/50">
        <h1 className="text-lg font-bold">Decisions</h1>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scroll-area -mx-4 px-4">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider transition-colors border ${
                filter === f 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {f.replace("-", " ")}
            </button>
          ))}
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto scroll-area">
        {/* Pull to refresh target area */}
        <div className="flex justify-center py-2">
          <button 
            onClick={() => refetch()} 
            className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full active:scale-95 transition-transform"
          >
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-card border rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="divide-y divide-border/50 pb-safe">
            {data?.decisions.map(d => (
              <button 
                key={d.id} 
                onClick={() => setSelectedId(d.id)}
                className="w-full text-left p-4 flex flex-col gap-2 active:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col truncate flex-1">
                    <span className="text-sm font-medium truncate">{d.identityId}</span>
                    <span className="text-xs font-mono text-muted-foreground truncate">{d.deviceId}</span>
                  </div>
                  <div className="shrink-0">
                    <OutcomeBadge outcome={d.outcome} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate mr-4">{d.workflowId}</span>
                  <div className="flex gap-3 font-mono shrink-0">
                    <span>{formatLatency(d.latencyMs)}</span>
                    <span>{formatTimeAgo(d.evaluatedAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <BottomSheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        {detailLoading && !detailData ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-muted rounded-xl" />
            <div className="h-32 bg-muted rounded-xl" />
          </div>
        ) : detailData ? (
          <div className="space-y-6 pb-safe">
            <div className="flex flex-col items-center py-4 bg-muted/20 rounded-xl border">
              <span className="text-xs text-muted-foreground mb-2">Outcome</span>
              <div className="scale-150 transform-gpu mb-1">
                <OutcomeBadge outcome={detailData.outcome} />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Signals Evaluated</h3>
              <div className="space-y-2">
                {detailData.signals.map((sig, idx) => (
                  <div key={idx} className="bg-card border rounded-xl overflow-hidden">
                    <div className="p-3 flex items-center justify-between border-b border-border/50 bg-muted/10">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">{sig.signalType.replace("-", " ")}</span>
                        <span className="text-sm font-medium">{sig.platform}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium capitalize text-muted-foreground">{sig.status}</span>
                        <StatusDot status={sig.status} />
                      </div>
                    </div>
                    <div className="p-3 bg-card overflow-x-auto">
                      <pre className="text-[10px] font-mono text-muted-foreground">
                        {JSON.stringify(sig.value, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Metadata</h3>
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <MetaRow label="Identity" value={detailData.identityId} />
                <MetaRow label="Device" value={detailData.deviceId} />
                <MetaRow label="Workflow" value={detailData.workflowId} />
                <MetaRow label="Latency" value={formatLatency(detailData.latencyMs)} />
                <MetaRow label="Time" value={new Date(detailData.evaluatedAt).toLocaleString()} />
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

function MetaRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono text-right break-all">{value}</span>
    </div>
  );
}
