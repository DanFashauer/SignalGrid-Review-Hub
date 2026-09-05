import React, { useState } from "react";
import { useListIntegrations } from "@workspace/api-client-react";

const STATUS_COLOR: Record<string, string> = {
  connected: "text-green-400",
  degraded: "text-yellow-400",
  disconnected: "text-red-400",
  "not-configured": "text-muted-foreground",
};

// A status the map does not name is not a connected one. The bare lookup emitted
// the literal class `undefined` and the row rendered in the default foreground —
// indistinguishable from a healthy row at a glance. Unknown reads as
// disconnected, the restrictive arm.
const statusColor = (status: string) => STATUS_COLOR[status] ?? STATUS_COLOR.disconnected;

export default function IntegrationsPage() {
  const { data, isLoading, isError } = useListIntegrations();
  const [search, setSearch] = useState("");

  const filtered = data?.integrations.filter(i =>
    !search || i.vendor.toLowerCase().includes(search.toLowerCase()) ||
    i.product.toLowerCase().includes(search.toLowerCase()) ||
    i.category.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const connected = data?.integrations.filter(i => i.status === "connected").length ?? 0;
  const degraded = data?.integrations.filter(i => i.status === "degraded").length ?? 0;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Integrations</h1>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">TELEMETRY SOURCES · {data ? `${data.integrations.length} TOTAL` : "– TOTAL"}</p>
        </div>
        <div className="flex gap-4 text-xs font-mono">
          {/* "0 CONNECTED" in green for a catalog that never loaded is a measured
              zero wearing a reassuring face; the counts render only from data. */}
          {data ? (
            <>
              <span className="text-green-400">{connected} CONNECTED</span>
              {degraded > 0 && <span className="text-yellow-400">{degraded} DEGRADED</span>}
            </>
          ) : (
            <span className="text-muted-foreground">– CONNECTED</span>
          )}
        </div>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search vendor, product, or category..."
        className="w-full max-w-sm bg-card border border-border rounded px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
      />

      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_160px_80px_100px_100px] text-xs font-mono text-muted-foreground border-b border-border bg-background/50 px-3 py-2">
          <span>VENDOR</span>
          <span>PRODUCT</span>
          <span>CATEGORY</span>
          <span className="text-right">SIGNALS/24H</span>
          <span className="text-right">LATENCY</span>
          <span className="text-right">STATUS</span>
        </div>
        <div className="divide-y divide-border/50 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-9 bg-muted/10 animate-pulse mx-3 my-1 rounded" />
            ))
          ) : isError ? (
            <div className="px-3 py-6 text-xs font-mono text-status-restrict">
              INTEGRATION CATALOG UNREACHABLE — the state of every source below is unknown, not healthy.
            </div>
          ) : filtered.map(i => (
            <div key={i.id} className="grid grid-cols-[1fr_1fr_160px_80px_100px_100px] px-3 py-2 hover:bg-muted/20 transition-colors text-xs font-mono">
              <span className="font-semibold text-foreground truncate pr-2">{i.vendor}</span>
              <span className="text-muted-foreground truncate pr-2">{i.product}</span>
              <span className="text-muted-foreground/70 truncate pr-2">{i.category}</span>
              <span className="text-right text-muted-foreground">{i.signalsIngested24h.toLocaleString()}</span>
              <span className="text-right text-muted-foreground">{i.latencyMs > 0 ? `${i.latencyMs}ms` : "–"}</span>
              <span className={`text-right font-semibold ${statusColor(i.status)}`}>{i.status.replace("-", " ").toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
