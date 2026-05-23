import React, { useState } from "react";
import { useListLatestSignals, ListLatestSignalsSignalType } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SignalStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export function SignalList() {
  const [activeTab, setActiveTab] = useState<string>("all");
  
  const signalType = activeTab === "all" ? undefined : activeTab as ListLatestSignalsSignalType;
  
  const { data: signalsData, isLoading } = useListLatestSignals({ 
    limit: 50,
    signalType
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Signal Feed</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">REAL-TIME INGESTION STREAM</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="font-mono text-xs">
          <TabsTrigger value="all">ALL SIGNALS</TabsTrigger>
          <TabsTrigger value="identity">IDENTITY</TabsTrigger>
          <TabsTrigger value="device-posture">DEVICE POSTURE</TabsTrigger>
          <TabsTrigger value="session-context">SESSION CONTEXT</TabsTrigger>
          <TabsTrigger value="operational-signals">OPERATIONAL</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[120px] font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs">Type</TableHead>
              <TableHead className="font-mono text-xs">Platform</TableHead>
              <TableHead className="font-mono text-xs">Device ID</TableHead>
              <TableHead className="font-mono text-xs">Value Preview</TableHead>
              <TableHead className="font-mono text-xs text-right">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : signalsData?.signals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No signals found.</TableCell>
              </TableRow>
            ) : (
              signalsData?.signals.map(signal => (
                <TableRow key={signal.id} className="border-border hover:bg-muted/50">
                  <TableCell>
                    <SignalStatusBadge status={signal.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono bg-card">{signal.signalType}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{signal.platform}</TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-[150px]" title={signal.deviceId}>{signal.deviceId}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px] truncate" title={JSON.stringify(signal.value)}>
                    {JSON.stringify(signal.value)}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">
                    {formatTimeAgo(signal.receivedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
