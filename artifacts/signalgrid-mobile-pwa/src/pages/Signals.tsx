import React, { useState } from "react";
import { useListLatestSignals, ListLatestSignalsSignalType } from "@workspace/api-client-react";
import { formatTimeAgo } from "@/lib/format";
import { StatusDot } from "@/components/StatusDot";
import { SignalBadge } from "@/components/SignalBadge";

export default function Signals() {
  const [filter, setFilter] = useState<ListLatestSignalsSignalType | "all">("all");

  const { data, isLoading } = useListLatestSignals({ 
    limit: 50,
    signalType: filter === "all" ? undefined : filter
  }, {
    query: { refetchInterval: 30_000, queryKey: ["signals", filter] },
  });

  const types = ["all", "identity", "device-posture", "session-context", "operational-signals"] as const;

  return (
    <div className="h-full w-full flex flex-col pt-safe bg-background">
      <header className="px-4 py-3 shrink-0 bg-background z-10 border-b border-border/50">
        <h1 className="text-lg font-bold">Live Signals</h1>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scroll-area -mx-4 px-4">
          {types.map(t => (
            <button
              key={t}
              onClick={() => setFilter(t as any)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider transition-colors border ${
                filter === t 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {t.replace("-", " ")}
            </button>
          ))}
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto scroll-area">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-card border rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="divide-y divide-border/50 pb-safe">
            {data?.signals.map(s => {
              const previewKey = Object.keys(s.value)[0];
              const previewValue = previewKey ? String(s.value[previewKey]) : "No data";

              return (
                <div key={s.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <SignalBadge type={s.signalType} />
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">{formatTimeAgo(s.receivedAt)}</span>
                      <StatusDot status={s.status} />
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-sm font-medium">{s.platform}</div>
                    <div className="text-xs font-mono text-muted-foreground truncate">{s.deviceId}</div>
                  </div>

                  <div className="bg-muted/30 border border-border/50 rounded-lg p-2 mt-1">
                    <div className="text-[10px] font-mono truncate text-muted-foreground">
                      <span className="text-primary/70">{previewKey}:</span> {previewValue}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
