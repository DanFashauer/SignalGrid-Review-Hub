import React, { useState } from "react";
import { useListIntegrations, useGetIntegration } from "@workspace/api-client-react";
import { formatNumber, formatLatency, formatTimeAgo } from "@/lib/format";
import { StatusDot } from "@/components/StatusDot";
import { SignalBadge } from "@/components/SignalBadge";
import { BottomSheet } from "@/components/BottomSheet";

export default function Integrations() {
  const { data, isLoading } = useListIntegrations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: detailData, isLoading: detailLoading } = useGetIntegration(selectedId || "", {
    query: { enabled: !!selectedId, queryKey: ["integration", selectedId] },
  });

  // Group and sort
  const categories = ["IGA / IDP", "MDM / UEM", "EDR / XDR", "SIEM", "ITSM"];
  
  const sortedIntegrations = data?.integrations ? [...data.integrations].sort((a, b) => {
    const aBad = a.status === "degraded" || a.status === "not-configured";
    const bBad = b.status === "degraded" || b.status === "not-configured";
    if (aBad && !bBad) return -1;
    if (!aBad && bBad) return 1;
    return 0;
  }) : [];

  return (
    <div className="h-full w-full flex flex-col pt-safe bg-background">
      <header className="px-4 py-3 shrink-0 bg-background z-10 border-b border-border/50">
        <h1 className="text-lg font-bold">Integrations</h1>
      </header>
      
      <div className="flex-1 overflow-y-auto scroll-area bg-muted/10 pb-safe">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-card border rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="p-4 space-y-8">
            {categories.map(cat => {
              const items = sortedIntegrations.filter(i => i.category === cat);
              if (items.length === 0) return null;

              return (
                <div key={cat} className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pl-1">{cat}</h2>
                  <div className="space-y-3">
                    {items.map(int => {
                      const isWarning = int.status === "degraded";
                      
                      return (
                        <button
                          key={int.id}
                          onClick={() => setSelectedId(int.id)}
                          className={`w-full text-left bg-card border rounded-xl p-4 flex flex-col gap-3 active:scale-[0.98] transition-transform ${
                            isWarning ? "border-amber-500/50 bg-amber-500/5" : ""
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex flex-col">
                              <h3 className="text-sm font-bold">{int.vendor}</h3>
                              <p className="text-xs text-muted-foreground">{int.product}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-[10px] font-medium uppercase tracking-wider ${isWarning ? "text-amber-500" : "text-muted-foreground"}`}>
                                {int.status.replace("-", " ")}
                              </span>
                              <StatusDot status={int.status} />
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/50">
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Signals / 24h</span>
                              <span className="text-sm font-mono">{formatNumber(int.signalsIngested24h)}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Latency</span>
                              <span className="text-sm font-mono">{formatLatency(int.latencyMs)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        {detailLoading && !detailData ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-20 bg-muted rounded-xl" />
            <div className="h-32 bg-muted rounded-xl" />
          </div>
        ) : detailData ? (
          <div className="space-y-6 pb-safe">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{detailData.vendor}</h2>
                <p className="text-sm text-muted-foreground">{detailData.product}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusDot status={detailData.status} />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {detailData.status.replace("-", " ")}
                </span>
              </div>
            </div>

            {detailData.errorMessage && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive">
                <span className="font-bold uppercase tracking-wider block mb-1">Error</span>
                {detailData.errorMessage}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</h3>
              <p className="text-sm">{(detailData as unknown as { description?: string }).description ?? "No description available."}</p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Signal Types</h3>
              <div className="flex flex-wrap gap-2">
                {detailData.signalTypes.map(type => (
                  <SignalBadge key={type} type={type} />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Metrics</h3>
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-start gap-4">
                  <span className="text-xs text-muted-foreground">Signals (24h)</span>
                  <span className="text-sm font-mono">{formatNumber(detailData.signalsIngested24h)}</span>
                </div>
                <div className="flex justify-between items-start gap-4">
                  <span className="text-xs text-muted-foreground">Avg Latency</span>
                  <span className="text-sm font-mono">{formatLatency(detailData.latencyMs)}</span>
                </div>
                <div className="flex justify-between items-start gap-4">
                  <span className="text-xs text-muted-foreground">Last Sync</span>
                  <span className="text-sm font-mono">{formatTimeAgo(detailData.lastSync)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
