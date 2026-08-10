import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { formatDate } from "@/lib/format";
import { getAuditV1 } from "@/lib/v1";

/**
 * The tamper-evident audit ledger from `/v1/audit` — the record a regulated
 * pilot is bought on. The chain banner is the server RE-VERIFYING every digest
 * on this request, not a stored flag.
 */
export function Audit() {
  const { data, isLoading, error } = useQuery({ queryKey: ["v1-audit"], queryFn: getAuditV1, refetchInterval: 30_000 });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          TAMPER-EVIDENT LEDGER · /v1 CORE · READ WITH THE DEMO AUDITOR KEY (audit:read) <AssuranceBadge />
        </p>
      </div>

      {data && (
        <div
          className={`border rounded p-4 font-mono text-sm flex items-center gap-3 ${
            data.chain.valid ? "border-border bg-card/50" : "border-destructive bg-destructive/10"
          }`}
        >
          <Badge
            variant="outline"
            className={`font-mono uppercase border-transparent ${data.chain.valid ? "bg-status-allow" : "bg-status-deny"}`}
          >
            {data.chain.valid ? "chain verified" : "CHAIN BROKEN"}
          </Badge>
          <span className="text-muted-foreground">
            {data.chain.length} events, every digest recomputed on this request
            {data.chain.brokenAtSeq !== null ? ` — broken at seq ${data.chain.brokenAtSeq}` : ""}
          </span>
        </div>
      )}

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[60px] font-mono text-xs">Seq</TableHead>
              <TableHead className="font-mono text-xs">Type</TableHead>
              <TableHead className="font-mono text-xs">Actor</TableHead>
              <TableHead className="font-mono text-xs">Summary</TableHead>
              <TableHead className="font-mono text-xs text-right">Recorded</TableHead>
              <TableHead className="font-mono text-xs text-right">Digest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm">
                  {String(error instanceof Error ? error.message : error)}
                </TableCell>
              </TableRow>
            ) : (
              (data?.events ?? [])
                .slice()
                .sort((a, b) => b.seq - a.seq)
                .map((e) => (
                  <TableRow key={e.id} className="border-border">
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.seq}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">{e.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[140px]" title={e.actor}>{e.actor}</TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[380px]" title={e.summary}>{e.summary}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">{formatDate(e.recordedAt)}</TableCell>
                    <TableCell className="font-mono text-[10px] text-right text-muted-foreground truncate max-w-[120px]" title={e.digest}>
                      {e.digest.slice(0, 12)}…
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
