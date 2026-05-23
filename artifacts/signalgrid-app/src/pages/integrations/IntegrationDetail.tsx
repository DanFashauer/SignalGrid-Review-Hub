import React from "react";
import { useParams, Link } from "wouter";
import { useGetIntegration } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { IntegrationStatusBadge, SignalStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

export function IntegrationDetail() {
  const { id } = useParams();
  const { data: integration, isLoading } = useGetIntegration(id || "");

  if (isLoading || !integration) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="mb-4">
        <Link href="/integrations" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 font-mono uppercase tracking-wider">
          <ArrowLeft className="w-4 h-4" /> Back to Integrations
        </Link>
      </div>

      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{integration.vendor} {integration.product}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm uppercase tracking-wider">{integration.category}</p>
        </div>
        <IntegrationStatusBadge status={integration.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Connection Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">SIGNALS INGESTED (24H)</div>
              <div className="font-mono text-2xl">{integration.signalsIngested24h.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">AVG LATENCY</div>
              <div className="font-mono text-2xl">{Math.round(integration.latencyMs)}ms</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">LAST SYNC</div>
              <div className="font-mono text-sm">{formatTimeAgo(integration.lastSync)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(integration.lastSync)}</div>
            </div>
            {integration.errorMessage && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-sm font-mono break-words">
                {integration.errorMessage}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Supported Signal Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {integration.signalTypes.map(st => (
                <div key={st} className="p-4 border border-border rounded bg-card/50 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="font-mono text-sm">{st}</span>
                </div>
              ))}
              {integration.signalTypes.length === 0 && (
                <div className="text-muted-foreground text-sm font-mono p-4 border border-dashed border-border rounded text-center col-span-full">
                  No signal types configured
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
