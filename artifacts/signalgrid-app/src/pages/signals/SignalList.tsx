import React, { useState } from "react";
import { useListLatestSignals, ListLatestSignalsSignalType } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  "identity": "text-blue-400 bg-blue-400/10 border-blue-400/20",
  "device-posture": "text-green-400 bg-green-400/10 border-green-400/20",
  "session-context": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "operational-signals": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "network-posture": "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  "physical-access": "text-orange-400 bg-orange-400/10 border-orange-400/20",
};

const TABS = [
  { value: "all", label: "ALL SIGNALS" },
  { value: "identity", label: "IDENTITY" },
  { value: "device-posture", label: "DEVICE POSTURE" },
  { value: "session-context", label: "SESSION CONTEXT" },
  { value: "operational-signals", label: "OPERATIONAL" },
  { value: "network-posture", label: "NETWORK POSTURE" },
  { value: "physical-access", label: "PHYSICAL ACCESS" },
];

export function SignalList() {
  const [activeTab, setActiveTab] = useState<string>("all");

  const signalType = activeTab === "all" ? undefined : activeTab as ListLatestSignalsSignalType;

  const { data: signalsData, isLoading } = useListLatestSignals({
    limit: 100,
    signalType,
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Signal Feed</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">SIGNAL STREAM (FIXTURE) — {signalsData?.signals.length ?? 0} SIGNALS</p>
        <p className="text-xs text-amber-400/80 mt-2 max-w-2xl">
          Synthetic fixture data. This catalog view includes candidate signal categories
          (session, network, operational) that the decision core does not evaluate today —
          the core normalizes identity, device posture, DockBridge custody, and CIS baseline.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="font-mono text-[10px] flex-wrap h-auto gap-1 bg-card border border-border p-1">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-[10px] tracking-wider">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[110px] font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Type</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Platform</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Device ID</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Value Preview</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono">Loading signals...</TableCell>
              </TableRow>
            ) : signalsData?.signals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono">No signals found.</TableCell>
              </TableRow>
            ) : (
              signalsData?.signals.map((signal) => {
                const typeColor = SIGNAL_TYPE_COLORS[signal.signalType] ?? "text-muted-foreground bg-muted/20 border-border";
                return (
                  <TableRow key={signal.id} className="border-border hover:bg-muted/30">
                    <TableCell>
                      <SignalStatusBadge status={signal.status} />
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${typeColor}`}>
                        {signal.signalType}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{signal.platform}</TableCell>
                    <TableCell className="font-mono text-sm truncate max-w-[140px]" title={signal.deviceId}>
                      {signal.deviceId}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-[280px] truncate" title={JSON.stringify(signal.value)}>
                      {JSON.stringify(signal.value)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-right text-muted-foreground">
                      {formatTimeAgo(signal.receivedAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
