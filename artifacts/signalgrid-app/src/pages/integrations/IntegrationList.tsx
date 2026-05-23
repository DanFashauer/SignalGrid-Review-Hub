import React from "react";
import { Link } from "wouter";
import { useListIntegrations } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function IntegrationList() {
  const { data: integrationsData, isLoading } = useListIntegrations();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">TELEMETRY SOURCES & ENFORCEMENT POINTS</p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading integrations...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrationsData?.integrations.map(integration => (
            <Link key={integration.id} href={`/integrations/${integration.id}`}>
              <Card className="border-border hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{integration.vendor} {integration.product}</CardTitle>
                    <IntegrationStatusBadge status={integration.status} />
                  </div>
                  <p className="text-sm text-muted-foreground font-mono uppercase tracking-wider">{integration.category}</p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {integration.signalTypes.map(st => (
                      <Badge key={st} variant="secondary" className="font-mono text-[10px]">{st}</Badge>
                    ))}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mt-auto">
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">SIGNALS (24H)</div>
                      <div className="font-mono text-lg">{integration.signalsIngested24h.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">LATENCY</div>
                      <div className="font-mono text-lg">{Math.round(integration.latencyMs)}ms</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border flex justify-between items-center text-xs font-mono text-muted-foreground">
                    <span>LAST SYNC</span>
                    <span>{formatTimeAgo(integration.lastSync)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
