import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListDecisions, ListDecisionsOutcome } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OutcomeBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type DecisionRow = { id: string; identityId: string; deviceId: string; workflowId: string; outcome: string; latencyMs: number; evaluatedAt: string; policyId?: string | null };

function exportCSV(decisions: DecisionRow[]) {
  if (!decisions.length) return;
  const header = ["id","identityId","deviceId","workflowId","outcome","latencyMs","evaluatedAt","policyId"];
  const rows = decisions.map(d =>
    [d.id, d.identityId, d.deviceId, d.workflowId, d.outcome, d.latencyMs, d.evaluatedAt, d.policyId ?? ""].join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `signalgrid-decisions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DecisionList() {
  const [, setLocation] = useLocation();
  const [outcomeFilter, setOutcomeFilter] = useState<ListDecisionsOutcome | "all">("all");
  
  const { data: decisionsData, isLoading } = useListDecisions({
    limit: 200,
    outcome: outcomeFilter === "all" ? undefined : outcomeFilter as ListDecisionsOutcome
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Decisions</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">RUNTIME ACCESS DECISION LOG</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={outcomeFilter} onValueChange={(v: any) => setOutcomeFilter(v)}>
            <SelectTrigger className="w-[180px] font-mono">
              <SelectValue placeholder="Filter by outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL OUTCOMES</SelectItem>
              <SelectItem value="allow">ALLOW</SelectItem>
              <SelectItem value="step-up">STEP-UP</SelectItem>
              <SelectItem value="restrict">RESTRICT</SelectItem>
              <SelectItem value="deny">DENY</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => exportCSV(decisionsData?.decisions ?? [])}
            disabled={!decisionsData?.decisions?.length}
            className="px-3 py-2 text-xs font-mono rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            EXPORT CSV
          </button>
        </div>
      </div>

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[120px] font-mono text-xs">Outcome</TableHead>
              <TableHead className="font-mono text-xs">Identity</TableHead>
              <TableHead className="font-mono text-xs">Device ID</TableHead>
              <TableHead className="font-mono text-xs">Workflow</TableHead>
              <TableHead className="font-mono text-xs text-right">Latency</TableHead>
              <TableHead className="font-mono text-xs text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : decisionsData?.decisions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No decisions found.</TableCell>
              </TableRow>
            ) : (
              (decisionsData?.decisions ?? []).map(d => (
                <TableRow 
                  key={d.id} 
                  className="cursor-pointer hover:bg-muted/50 border-border"
                  onClick={() => setLocation(`/decisions/${d.id}`)}
                >
                  <TableCell>
                    <OutcomeBadge outcome={d.outcome} />
                  </TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-[200px]" title={d.identityId}>{d.identityId}</TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-[200px]" title={d.deviceId}>{d.deviceId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">{d.workflowId}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{Math.round(d.latencyMs)}ms</TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{formatDate(d.evaluatedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
