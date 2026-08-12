import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OutcomeBadge } from "@/components/StatusBadge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { formatDate } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { listDecisionsV1, type V1DecisionRecord, type V1Outcome } from "@/lib/v1";

function exportCSV(decisions: V1DecisionRecord[]) {
  if (!decisions.length) return;
  const header = ["id", "identityId", "deviceId", "workflowId", "outcome", "reasonCodes", "latencyMs", "createdAt", "policyId", "policyVersion"];
  const rows = decisions.map((d) =>
    [d.id, d.identityId, d.deviceId, d.workflowId, d.outcome, d.reasonCodes.join("|"), d.latencyMs, d.createdAt, d.policyId, d.policyVersion].join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `signalgrid-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DecisionList() {
  const [, setLocation] = useLocation();
  const [outcomeFilter, setOutcomeFilter] = useState<V1Outcome | "all">("all");

  // The real /v1 decision ledger — every row was minted by the deterministic
  // core (evidence → policy → snapshot → audit), not a fixture generator.
  const { data: decisions, isLoading, error } = useQuery({
    queryKey: ["v1-decisions"],
    queryFn: listDecisionsV1,
    refetchInterval: 15_000,
  });

  const filtered = (decisions ?? []).filter((d) => outcomeFilter === "all" || d.outcome === outcomeFilter);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Decisions</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            RUNTIME ACCESS DECISION LOG · /v1 CORE <AssuranceBadge />
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={outcomeFilter} onValueChange={(v: any) => setOutcomeFilter(v)}>
            <SelectTrigger className="w-[180px] font-mono">
              <SelectValue placeholder="Filter by outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL OUTCOMES</SelectItem>
              <SelectItem value="allow">ALLOW</SelectItem>
              <SelectItem value="step_up">STEP-UP</SelectItem>
              <SelectItem value="restrict">RESTRICT</SelectItem>
              <SelectItem value="deny">DENY</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => exportCSV(filtered)}
            disabled={!filtered.length}
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
              <TableHead className="font-mono text-xs">Reason</TableHead>
              <TableHead className="font-mono text-xs text-right">Latency</TableHead>
              <TableHead className="font-mono text-xs text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground font-mono text-sm">
                  {String(error instanceof Error ? error.message : error)}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No decisions yet — evaluate one from the dashboard's live panel.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer hover:bg-muted/50 border-border"
                  onClick={() => setLocation(`/decisions/${d.id}`)}
                >
                  <TableCell>
                    <OutcomeBadge outcome={d.outcome} />
                  </TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-[180px]" title={d.identityId}>{d.identityId}</TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-[180px]" title={d.deviceId}>{d.deviceId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">{d.workflowId}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[220px]" title={d.reasonCodes.join(", ")}>
                    {d.reasonCodes[0] ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{Math.round(d.latencyMs)}ms</TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
