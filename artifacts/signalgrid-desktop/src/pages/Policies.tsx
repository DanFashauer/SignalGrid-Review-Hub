import React from "react";
import { useListPolicies } from "@workspace/api-client-react";

export default function PoliciesPage() {
  const { data, isLoading } = useListPolicies();

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Policies</h1>
        <p className="text-xs font-mono text-muted-foreground mt-0.5">ACCESS CONTROL POLICY ENGINE</p>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-card border border-border rounded animate-pulse" />
          ))
        ) : data?.policies.map(p => (
          <div key={p.id} className={`bg-card border rounded p-4 space-y-3 ${p.active ? "border-border" : "border-border/40 opacity-60"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-6 rounded-full ${p.active ? "bg-primary" : "bg-muted"}`} />
                <div>
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-0.5">{p.workflowPattern}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                  p.failMode === "fail-closed"
                    ? "border-red-500/20 bg-red-500/5 text-red-400"
                    : "border-green-500/20 bg-green-500/5 text-green-400"
                }`}>
                  {p.failMode.toUpperCase()}
                </span>
                <span className={`text-xs font-mono ${p.active ? "text-green-400" : "text-muted-foreground"}`}>
                  {p.active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
            </div>
            {p.description && (
              <p className="text-xs text-muted-foreground pl-4">{p.description}</p>
            )}
            <div className="flex gap-2 pl-4 flex-wrap">
              {p.rules.map((r, idx) => (
                <div key={idx} className="text-xs font-mono px-2 py-1 rounded border border-border bg-background/50 flex items-center gap-2">
                  <span className="text-muted-foreground capitalize">{r.signal.replace(/-/g, " ")}</span>
                  <span className="text-foreground/40">·</span>
                  <span className="text-foreground/70">{r.condition}</span>
                  <span className="text-foreground/40">→</span>
                  <span className={`font-semibold ${
                    r.outcome === "allow" ? "text-status-allow" :
                    r.outcome === "deny" ? "text-status-deny" :
                    r.outcome === "step-up" ? "text-status-step-up" : "text-status-restrict"
                  }`}>{r.outcome.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
