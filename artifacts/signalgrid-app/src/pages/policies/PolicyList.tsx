import React from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { listPoliciesV1 } from "@/lib/v1";

/**
 * The core's versioned policy inventory (launch wireframe screen 5) — read
 * from /v1, read-only at launch: policy changes ride the repository, not a UI.
 */
export function PolicyList() {
  const [, setLocation] = useLocation();
  const { data: policies, isLoading, error } = useQuery({ queryKey: ["v1-policies"], queryFn: listPoliciesV1 });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Policies</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          VERSIONED RULE SETS · /v1 CORE · READ-ONLY AT LAUNCH <AssuranceBadge />
        </p>
      </div>

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-xs">Policy</TableHead>
              <TableHead className="font-mono text-xs">Key</TableHead>
              <TableHead className="font-mono text-xs">Workflow binding</TableHead>
              <TableHead className="font-mono text-xs text-right">Active version</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground font-mono text-sm">{String(error instanceof Error ? error.message : error)}</TableCell></TableRow>
            ) : (
              (policies ?? []).map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50 border-border" onClick={() => setLocation(`/policies/${p.id}`)}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate max-w-[420px]">{p.description}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{p.key}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-mono">{p.workflowPattern}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-right text-muted-foreground">{p.activeVersionId}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
