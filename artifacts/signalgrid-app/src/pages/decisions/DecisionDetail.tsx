import React from "react";
import { useParams } from "wouter";
import { useGetDecision } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { OutcomeBadge, SignalStatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function DecisionDetail() {
  const { id } = useParams();
  const { data: decision, isLoading } = useGetDecision(id || "");

  if (isLoading || !decision) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 border-b border-border pb-6">
        <OutcomeBadge outcome={decision.outcome} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">{decision.id}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{formatDate(decision.evaluatedAt)} • {Math.round(decision.latencyMs)}ms LATENCY</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">IDENTITY</div>
              <div className="font-mono break-all text-sm">{decision.identityId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">DEVICE ID</div>
              <div className="font-mono break-all text-sm">{decision.deviceId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">WORKFLOW</div>
              <Badge variant="secondary" className="font-mono">{decision.workflowId}</Badge>
            </div>
            {decision.policyId && (
              <div>
                <div className="text-xs text-muted-foreground font-mono mb-1">POLICY APPLIED</div>
                <div className="font-mono break-all text-sm text-primary">{decision.policyId}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Signal Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {decision.signals.map((sig, i) => (
                <div key={i} className="border border-border rounded bg-card/50 overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <SignalStatusBadge status={sig.status} />
                      <span className="font-mono font-bold text-sm">{sig.signalType}</span>
                      <Badge variant="secondary" className="font-mono text-xs">{sig.platform}</Badge>
                    </div>
                  </div>
                  <div className="p-4">
                    <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
                      {JSON.stringify(sig.value, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
              {decision.signals.length === 0 && (
                <div className="text-muted-foreground text-sm font-mono p-4 border border-dashed border-border rounded text-center">
                  No signals evaluated
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
