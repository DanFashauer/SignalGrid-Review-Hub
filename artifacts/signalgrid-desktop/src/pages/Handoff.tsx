import React, { useState } from "react";
import { useListDecisions, useListLatestSignals } from "@workspace/api-client-react";
import { CheckCircle2, AlertTriangle, Clock, GitBranch } from "lucide-react";

const SHIFT_ZONES = ["ICU", "ZONE 3B", "ZONE 1A", "ER", "PHARMACY", "LAB", "FLOOR 4", "DOCK A"];
const DEVICE_IDS = [
  "SG-0847", "SG-0912", "SG-0334", "SG-1023", "SG-0765",
  "SG-0289", "SG-0441", "SG-0678", "SG-0123", "SG-0556",
];

function mockHandoffState() {
  return DEVICE_IDS.map((id, i) => ({
    deviceId: id,
    zone: SHIFT_ZONES[i % SHIFT_ZONES.length],
    status: i < 6 ? "checked-in" : i < 8 ? "overdue" : "in-progress",
    lastSeen: new Date(Date.now() - (i * 8 + 3) * 60_000).toISOString(),
    assignedTo: `USR${String(1000 + i).padStart(4, "0")}`,
    nextShift: `USR${String(2000 + i).padStart(4, "0")}`,
    badgeStatus: i < 7 ? "docked" : "field",
  }));
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ComponentType<{className?: string}> }> = {
  "checked-in": { label: "DOCKED", color: "text-green-400", icon: CheckCircle2 },
  "overdue": { label: "OVERDUE", color: "text-red-400", icon: AlertTriangle },
  "in-progress": { label: "HANDING OFF", color: "text-yellow-400", icon: Clock },
};

export default function HandoffPage() {
  const handoffs = mockHandoffState();
  const overdue = handoffs.filter(h => h.status === "overdue");
  const complete = handoffs.filter(h => h.status === "checked-in");
  const inProgress = handoffs.filter(h => h.status === "in-progress");

  const { data: recentDecisions } = useListDecisions({ limit: 5 });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <GitBranch className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Shift Handoff</h1>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">DEVICE CUSTODY TRANSITION · SHIFT 07:00–19:00</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "TOTAL DEVICES", value: handoffs.length, color: "text-foreground" },
          { label: "DOCKED / CHECKED IN", value: complete.length, color: "text-green-400" },
          { label: "HANDOFF IN PROGRESS", value: inProgress.length, color: "text-yellow-400" },
          { label: "OVERDUE", value: overdue.length, color: "text-red-400" },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border rounded p-4">
            <div className="text-xs font-mono text-muted-foreground mb-1">{m.label}</div>
            <div className={`text-2xl font-mono font-bold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {overdue.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded border border-red-500/20 bg-red-500/5">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-red-300">
              {overdue.length} device{overdue.length > 1 ? "s" : ""} overdue for checkout
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {overdue.map(h => h.deviceId).join(", ")} — shift ended, device not docked
            </div>
          </div>
        </div>
      )}

      {/* Device table */}
      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="text-xs font-mono text-muted-foreground border-b border-border bg-background/50 px-3 py-2 uppercase tracking-wider">
          Device Custody Status
        </div>
        <div className="grid grid-cols-[100px_80px_120px_120px_100px_100px] text-xs font-mono text-muted-foreground border-b border-border/50 bg-muted/10 px-3 py-1.5">
          <span>DEVICE</span>
          <span>ZONE</span>
          <span>CURRENT USER</span>
          <span>NEXT SHIFT</span>
          <span>BADGE</span>
          <span>STATUS</span>
        </div>
        <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
          {handoffs.map(h => {
            const meta = STATUS_META[h.status];
            const Icon = meta.icon;
            return (
              <div key={h.deviceId} className="grid grid-cols-[100px_80px_120px_120px_100px_100px] px-3 py-2 hover:bg-muted/20 transition-colors text-xs font-mono">
                <span className="font-semibold text-foreground">{h.deviceId}</span>
                <span className="text-muted-foreground">{h.zone}</span>
                <span className="text-foreground/70">{h.assignedTo}</span>
                <span className="text-foreground/70">{h.nextShift}</span>
                <span className={h.badgeStatus === "docked" ? "text-green-400" : "text-yellow-400"}>
                  {h.badgeStatus.toUpperCase()}
                </span>
                <span className={`flex items-center gap-1 ${meta.color}`}>
                  <Icon className="w-3 h-3 shrink-0" />
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent custody decisions */}
      <div>
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Recent Handoff Decisions</div>
        <div className="space-y-1.5">
          {recentDecisions?.decisions.slice(0, 4).map(d => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded text-xs font-mono">
              <span className={`font-semibold w-14 ${
                d.outcome === "allow" ? "text-green-400" :
                d.outcome === "deny" ? "text-red-400" : "text-yellow-400"
              }`}>{d.outcome.toUpperCase()}</span>
              <span className="text-foreground/70 flex-1">{d.identityId}</span>
              <span className="text-muted-foreground">{d.deviceId}</span>
              <span className="text-muted-foreground">{d.latencyMs}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
