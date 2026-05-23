import React, { useState } from "react";
import { useListLatestSignals } from "@workspace/api-client-react";

const TYPES = [
  { value: undefined, label: "ALL" },
  { value: "identity" as const, label: "IDENTITY" },
  { value: "device-posture" as const, label: "DEVICE POSTURE" },
  { value: "physical-access" as const, label: "PHYSICAL ACCESS" },
  { value: "network-posture" as const, label: "NETWORK" },
  { value: "operational-signals" as const, label: "OPERATIONAL" },
];

const STATUS_COLOR: Record<string, string> = {
  nominal: "text-green-400 bg-green-400/10",
  anomalous: "text-orange-400 bg-orange-400/10",
  critical: "text-red-400 bg-red-400/10",
  unknown: "text-muted-foreground bg-muted/20",
};

export default function SignalsPage() {
  const [typeFilter, setTypeFilter] = useState<typeof TYPES[number]["value"]>(undefined);
  const { data, isLoading } = useListLatestSignals({ limit: 100, signalType: typeFilter });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Signals</h1>
        <p className="text-xs font-mono text-muted-foreground mt-0.5">LIVE TELEMETRY FEED</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TYPES.map(t => (
          <button
            key={t.label}
            onClick={() => setTypeFilter(t.value)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
              typeFilter === t.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[100px_160px_1fr_180px_120px] text-xs font-mono text-muted-foreground border-b border-border bg-background/50 px-3 py-2">
          <span>STATUS</span>
          <span>SIGNAL TYPE</span>
          <span>DEVICE</span>
          <span>PLATFORM</span>
          <span className="text-right">RECEIVED</span>
        </div>
        <div className="divide-y divide-border/50 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-9 bg-muted/10 animate-pulse mx-3 my-1 rounded" />
            ))
          ) : data?.signals.map(s => (
            <div key={s.id} className="grid grid-cols-[100px_160px_1fr_180px_120px] px-3 py-2 hover:bg-muted/20 transition-colors text-xs font-mono">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[s.status] ?? ""}`}>
                {s.status.toUpperCase()}
              </span>
              <span className="text-foreground/70 capitalize">{s.signalType.replace(/-/g, " ")}</span>
              <span className="text-muted-foreground truncate pr-2">{s.deviceId}</span>
              <span className="text-muted-foreground">{s.platform}</span>
              <span className="text-right text-muted-foreground">{new Date(s.receivedAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
