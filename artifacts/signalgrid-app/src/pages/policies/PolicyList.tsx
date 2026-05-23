import React from "react";
import { Link } from "wouter";
import { useListPolicies } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/format";

export function PolicyList() {
  const { data: policiesData, isLoading } = useListPolicies();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Policies</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">ENFORCEMENT RULES & WORKFLOW PATTERNS</p>
        </div>
        <Link href="/policies/new">
          <Button className="font-mono uppercase tracking-wider text-xs">
            <Plus className="w-4 h-4 mr-2" />
            New Policy
          </Button>
        </Link>
      </div>

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-card">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-xs w-[300px]">Name</TableHead>
              <TableHead className="font-mono text-xs">Pattern</TableHead>
              <TableHead className="font-mono text-xs text-center">Fail Mode</TableHead>
              <TableHead className="font-mono text-xs text-center">Status</TableHead>
              <TableHead className="font-mono text-xs text-right">Rules</TableHead>
              <TableHead className="font-mono text-xs text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : policiesData?.policies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No policies configured.</TableCell>
              </TableRow>
            ) : (
              policiesData?.policies.map(policy => (
                <TableRow key={policy.id} className="border-border hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/policies/${policy.id}`} className="font-semibold text-primary hover:underline">
                      {policy.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono font-normal bg-card">
                      {policy.workflowPattern}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge 
                      variant="outline" 
                      className={`font-mono text-[10px] uppercase ${
                        policy.failMode === 'fail-closed' 
                          ? 'border-destructive text-destructive' 
                          : 'border-green-500 text-green-500'
                      }`}
                    >
                      {policy.failMode}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {policy.active ? (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-500 hover:bg-green-500/20 font-mono text-[10px] uppercase">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-mono text-[10px] uppercase">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{policy.rules.length}</TableCell>
                  <TableCell className="text-right text-muted-foreground font-mono text-xs">
                    {formatDate(policy.updatedAt)}
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
